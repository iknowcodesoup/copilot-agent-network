"""HTTP layer for the voice run SSE stream.

Split out of routes/voice.py (Finding 5): this file, voice_videos.py,
voice_runs.py, and voice_jobs.py each cover one resource under the
/api/voice prefix.
"""

from ag_ui.core import CustomEvent, EventType, StateSnapshotEvent
from ag_ui.encoder import EventEncoder
from fastapi import APIRouter, Depends, Header, Request
from fastapi.responses import StreamingResponse

from pythonapi.config import settings
from pythonapi.core.voice_events import (
    EVENT_RUN_LOG,
    EVENT_RUN_UPDATED,
    VoiceEvent,
    VoiceEventStream,
)
from pythonapi.dependencies import (
    get_required_voice_event_stream,
    get_required_voice_run_repository,
)
from pythonapi.models.voice_run import VoiceLogChunk
from pythonapi.repositories.voice_runs import VoiceRunRepository

router = APIRouter(prefix="/voice", tags=["Voice"])

# How many replayed events one reconnect may catch up on. The stream is bounded
# well below this, so the cap only guards against a pathological Last-Event-ID.
REPLAY_LIMIT = 500


@router.get("/events")
async def get_voice_events(
    request: Request,
    repository: VoiceRunRepository = Depends(get_required_voice_run_repository),
    event_stream: VoiceEventStream = Depends(get_required_voice_event_stream),
    last_event_id: str | None = Header(default=None, alias="Last-Event-ID"),
) -> StreamingResponse:
    """Stream voice run state to the browser, over one connection for the page.

    Reuses the AG-UI encoder the agent endpoint already speaks, so the browser
    has one event grammar rather than two. Every event carries an SSE `id:`,
    which is the Redis Stream ID, so a reconnecting EventSource sends back
    Last-Event-ID on its own and picks up exactly where it stopped.
    """
    encoder = EventEncoder(accept=request.headers.get("accept"))
    heartbeat_milliseconds = int(settings.VOICE_EVENT_HEARTBEAT_SECONDS * 1000)

    async def event_stream_body():
        if last_event_id:
            # A reconnect. The client already has state, so replay rather than
            # start over, and only fall back to a snapshot if nothing replays.
            position = last_event_id
            replayed = await event_stream.read_after(position, REPLAY_LIMIT)
            for event in replayed:
                yield _encode_voice_event(encoder, event)
            if replayed:
                position = replayed[-1].event_id
        else:
            # A fresh connection. Capture the stream position first, then read
            # the snapshot: anything published while the snapshot is being
            # built then arrives as a replayed event rather than being lost.
            position = await event_stream.current_position()
            runs = await repository.list_runs(limit=200)
            yield encoder.encode(
                StateSnapshotEvent(
                    type=EventType.STATE_SNAPSHOT,
                    snapshot={"runs": [run.model_dump(mode="json") for run in runs]},
                )
            )
            for event in await event_stream.read_after(position, REPLAY_LIMIT):
                yield _encode_voice_event(encoder, event)
                position = event.event_id

        async for batch in event_stream.follow(position, heartbeat_milliseconds):
            if not batch:
                # An SSE comment. Keeps a proxy in the middle from deciding the
                # connection went idle and closing it.
                yield ": ping\n\n"
                continue
            for event in batch:
                yield _encode_voice_event(encoder, event)

    return StreamingResponse(
        event_stream_body(),
        media_type=encoder.get_content_type(),
        headers={
            "Cache-Control": "no-cache",
            # Tells nginx-style reverse proxies not to buffer the stream, which
            # would hold every update back until the connection closed.
            "X-Accel-Buffering": "no",
        },
    )


def _encode_voice_event(encoder: EventEncoder, event: VoiceEvent) -> str:
    """One run update or log chunk, with the SSE id the browser replays from.

    The AG-UI encoder writes the `data:` line only, so the `id:` line goes on
    the front here. That is what makes EventSource send Last-Event-ID for us.
    """
    name = EVENT_RUN_LOG if isinstance(event.data, VoiceLogChunk) else EVENT_RUN_UPDATED
    encoded = encoder.encode(
        CustomEvent(
            type=EventType.CUSTOM,
            name=name,
            value=event.data.model_dump(mode="json"),
        )
    )
    return f"id: {event.event_id}\n{encoded}"
