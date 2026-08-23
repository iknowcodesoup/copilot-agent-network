"""HTTP layer for video-scoped voice-pipeline actions.

Split out of routes/voice.py (Finding 5): this file, voice_runs.py,
voice_jobs.py, and voice_events.py each cover one resource under the
/api/voice prefix.
"""

from contextlib import suppress

from fastapi import APIRouter, Depends, status

from pythonapi.core.speaker_board import build_speaker_board
from pythonapi.core.voice_factory_gateway import (
    VoiceFactoryError,
    VoiceFactoryGateway,
)
from pythonapi.dependencies import (
    get_required_voice_factory_gateway,
    get_required_voice_run_repository,
)
from pythonapi.models.voice_run import SpeakerBoard
from pythonapi.repositories.voice_runs import VoiceRunRepository
from pythonapi.routes.voice_route_support import unavailable

router = APIRouter(prefix="/voice", tags=["Voice"])

# Video search, characters, the video list, per-video speakers, clip
# decisions, clip audio, and commit all moved to
# routes/voice_factory_proxy.py. The factory owns every one of them and
# nothing here read their fields, so a typed route was a second definition
# of a shape this service does not own.


@router.get("/videos/{video_id}/clips", response_model=SpeakerBoard)
async def get_video_speaker_board(
    video_id: str,
    gateway: VoiceFactoryGateway = Depends(get_required_voice_factory_gateway),
):
    """Clips grouped by speaker, for the review screen.

    Keyed on the video, because the clips are: a video ingested for one
    character and claimed by another has one set of clips and one review, and
    no run has to exist for a person to read them.
    """
    try:
        video_clips = await gateway.get_clips(video_id)
    except VoiceFactoryError as error:
        raise unavailable(error) from error
    return build_speaker_board(video_clips)


@router.delete("/videos/{video_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_video(
    video_id: str,
    gateway: VoiceFactoryGateway = Depends(get_required_voice_factory_gateway),
    repository: VoiceRunRepository = Depends(get_required_voice_run_repository),
):
    """Delete a video and every run pointing at it.

    The video's files live on the factory host; its runs live in Postgres.
    Deleting only one side would either orphan a run or leave a video the
    operator can no longer act on, so this does both. Runs go first, the same
    way delete_run cancels a live job before dropping the row.
    """
    for run in await repository.list_runs_for_video(video_id):
        if run.voyicer_job_id:
            with suppress(VoiceFactoryError):
                await gateway.cancel_job(run.voyicer_job_id)
        await repository.delete_run(run.id)

    try:
        await gateway.delete_video(video_id)
    except VoiceFactoryError as error:
        raise unavailable(error) from error
