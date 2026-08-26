"""Typed access to the jeanlucrecord control API.

Gateway, not client: it translates this service's domain models into the control
API's wire format and back. The raw httpx.AsyncClient it wraps is built once in
main.py's lifespan (see infrastructure/voice_factory_client.py).

Every method raises VoiceFactoryError on a transport or status failure. Callers
turn that into either a FAILED run or a 502, depending on where they sit.

Failures come in two kinds and the difference matters, because training runs for
days on a host that can reboot. A VoiceFactoryTransientError means "ask again"
- a refused connection, a timeout, a 5xx - and this gateway retries it before
giving up. A plain VoiceFactoryError means the request itself was wrong, so
retrying it would only repeat the mistake.
"""

import logging
from contextlib import AbstractAsyncContextManager
from typing import Any

import httpx
from tenacity import (
    AsyncRetrying,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

from pythonapi.config import settings
from pythonapi.models.voice_run import (
    ClipSummary,
    TrainingProgress,
    VideoClips,
    VideoResult,
)

logger = logging.getLogger(__name__)

# Below this the factory answered but the request was wrong; at or above it the
# factory itself is having trouble and the same request may yet succeed.
FIRST_SERVER_ERROR_STATUS = 500

# Stage names the control API accepts. They mirror main.py's --stage choices.
#
# The five youtube-* steps below are what youtube-ingest runs in order. This
# service starts them one job at a time rather than calling youtube-ingest,
# because retry granularity can never be finer than the unit of work: a failed
# transcode must cost the download step alone, not the whole ingest.
STAGE_YOUTUBE_DOWNLOAD = "youtube-download"
STAGE_YOUTUBE_TRANSCRIBE = "youtube-transcribe"
STAGE_YOUTUBE_CHUNK = "youtube-chunk"
STAGE_YOUTUBE_DIARIZE = "youtube-diarize"
STAGE_YOUTUBE_REVIEW = "youtube-review"
# Rebuilds one voice's dataset from every kept clip assigned to it, across
# every video. Replaces the folder rather than adding to it, so a clip the
# reviewer un-kept or moved is gone from the next training run's audio.
STAGE_COMPILE_DATASET = "compile-dataset"
STAGE_RESAMPLE = "resample"
STAGE_PREPROCESS = "preprocess"
STAGE_TRAIN = "train"
STAGE_EXPORT = "export"

# Job states the control API reports.
JOB_STATE_RUNNING = "running"
JOB_STATE_SUCCEEDED = "succeeded"
JOB_STATE_FAILED = "failed"
JOB_STATE_CANCELLED = "cancelled"


class VoiceFactoryError(RuntimeError):
    """The control API answered, and the answer says the request was wrong.

    Permanent: the same request will fail the same way, so nothing retries it.

    status_code is the control API's own HTTP status, when the failure came
    from a response rather than a transport error. Most callers only care
    that the call failed and turn any VoiceFactoryError into a 502 - but a
    caller that must preserve one specific status reads it off here instead
    of parsing message.
    """

    def __init__(self, message: str, status_code: int | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code


class VoiceFactoryTransientError(VoiceFactoryError):
    """The control API could not be reached, or it failed on its own side.

    A subclass so every existing `except VoiceFactoryError` still catches it.
    Callers that must tell the two apart catch this one first.
    """


class VoiceFactoryGateway:
    def __init__(self, client: httpx.AsyncClient) -> None:
        self._client = client

    async def _request(self, method: str, url: str, **kwargs: Any) -> Any:
        """Send one request, retrying only what is worth retrying."""
        retrying = AsyncRetrying(
            stop=stop_after_attempt(settings.VOICE_FACTORY_RETRY_ATTEMPTS),
            wait=wait_exponential(
                multiplier=settings.VOICE_FACTORY_RETRY_BASE_DELAY,
                max=settings.VOICE_FACTORY_RETRY_MAX_DELAY,
            ),
            retry=retry_if_exception_type(VoiceFactoryTransientError),
            reraise=True,
        )
        async for attempt in retrying:
            with attempt:
                return await self._send(method, url, **kwargs)

    async def _send(self, method: str, url: str, **kwargs: Any) -> Any:
        try:
            response = await self._client.request(method, url, **kwargs)
            response.raise_for_status()
        except httpx.HTTPStatusError as error:
            status_code = error.response.status_code
            message = (
                f"{method} {url} failed with {status_code}: {error.response.text[:500]}"
            )
            if status_code >= FIRST_SERVER_ERROR_STATUS:
                raise VoiceFactoryTransientError(message, status_code) from error
            raise VoiceFactoryError(message, status_code) from error
        except httpx.HTTPError as error:
            # no response at all: refused, reset, timed out, DNS. All worth
            # asking again, because the GPU host can restart under us.
            raise VoiceFactoryTransientError(
                f"{method} {url} failed: {error}"
            ) from error
        if not response.content:
            return None
        return response.json()

    async def check_health(self) -> bool:
        try:
            await self._request("GET", "/health")
        except VoiceFactoryError:
            return False
        return True

    async def search_videos(self, query: str, limit: int) -> list[VideoResult]:
        payload = await self._request(
            "GET", "/search", params={"query": query, "limit": limit}
        )
        return [VideoResult(**video) for video in payload["videos"]]

    async def list_characters(self) -> list[str]:
        payload = await self._request("GET", "/characters")
        return payload["characters"]

    async def resolve_video_id(self, url: str) -> str:
        """Resolve a video URL to its id. Downloads nothing.

        The id names the directory every later call reads from, so a run needs
        it before ingest starts.
        """
        payload = await self._request("GET", "/resolve", params={"url": url})
        return payload["video_id"]

    async def start_job(self, **fields: Any) -> str:
        """Start one pipeline stage. Returns the control API's job id.

        Fields with a None value are dropped so the pipeline's own defaults
        stay in charge of anything the caller did not set.
        """
        body = {key: value for key, value in fields.items() if value is not None}
        payload = await self._request("POST", "/jobs", json=body)
        return payload["job_id"]

    async def get_job_state(self, job_id: str) -> str:
        payload = await self._request("GET", f"/jobs/{job_id}")
        return payload["state"]

    async def get_job_logs(self, job_id: str, offset: int = 0) -> dict:
        return await self._request(
            "GET", f"/jobs/{job_id}/logs", params={"offset": offset}
        )

    async def cancel_job(self, job_id: str) -> None:
        await self._request("DELETE", f"/jobs/{job_id}")

    async def list_videos(self) -> list[dict]:
        """Every ingested video, independent of any character (FR13).

        Lets the dashboard offer an already-ingested video to a second
        character without asking the factory to download or diarize it again.

        Returned unmodelled, because the factory owns the video: a field it
        adds must reach the browser with no edit here.
        """
        payload = await self._request("GET", "/videos")
        return list(payload["videos"])

    async def delete_video(self, video_id: str) -> None:
        """Remove a video's directory: audio, clips, review.csv. Irreversible."""
        await self._request("DELETE", f"/videos/{video_id}")

    async def get_video_speakers(self, video_id: str) -> list[dict]:
        """One video's speaker labels, unmodelled for the same reason as
        list_videos above."""
        payload = await self._request("GET", f"/videos/{video_id}/speakers")
        return list(payload["speakers"])

    async def get_clips(self, video_id: str) -> VideoClips:
        """What ingest cut out of one video.

        Read once, when a run finishes diarizing, and imported into
        voice_clips. There is no matching write: the review record is a table
        in this service, so a second path that edited the factory's copy
        would be a writer to a file nothing reads any more.
        """
        payload = await self._request("GET", f"/videos/{video_id}/clips")
        return VideoClips(
            video_id=payload.get("video_id", video_id),
            clips=[ClipSummary(**clip) for clip in payload["clips"]],
        )

    async def get_transcript_text(
        self, video_id: str, start_sec: float, end_sec: float
    ) -> str:
        """The video's own transcript, joined over one time window.

        Backs the resize-fills-the-text behaviour in update_clips: a clip's
        text tracks its transcript until a reviewer types over it. "" means
        no transcript.json yet on the factory side, same as the route itself
        answers - there is nothing to fill in with.
        """
        payload = await self._request(
            "GET",
            f"/videos/{video_id}/transcript_text",
            params={"start_sec": start_sec, "end_sec": end_sec},
        )
        return payload["text"]

    async def get_training_progress(self, character: str) -> TrainingProgress:
        # training has no video_id concept, so this stays character-scoped
        payload = await self._request("GET", f"/characters/{character}/training")
        return TrainingProgress(**payload)

    def stream_clip_audio(
        self, video_id: str, clip_id: str
    ) -> AbstractAsyncContextManager[httpx.Response]:
        """Open a streaming response for one clip's audio.

        Returns the raw httpx response so the route can forward bytes to the
        browser without buffering a whole wav in memory. The caller owns closing
        it - use it as an async context manager.
        """
        return self._client.stream(
            "GET",
            f"/videos/{video_id}/clips/{clip_id}/audio",
        )
