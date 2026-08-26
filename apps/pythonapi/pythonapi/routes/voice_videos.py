"""HTTP layer for video-scoped voice-pipeline actions.

Split out of routes/voice.py (Finding 5): this file, voice_runs.py,
voice_jobs.py, and voice_events.py each cover one resource under the
/api/voice prefix.
"""

from contextlib import suppress

from fastapi import APIRouter, Depends, status

from pythonapi.core.speaker_board import build_speaker_board
from pythonapi.core.voice_clip_transcript import apply_decisions_with_transcript_fill
from pythonapi.core.voice_clip_view import name_assigned_voices
from pythonapi.core.voice_factory_gateway import (
    VoiceFactoryError,
    VoiceFactoryGateway,
)
from pythonapi.dependencies import (
    get_required_voice_clip_repository,
    get_required_voice_factory_gateway,
    get_required_voice_repository,
    get_required_voice_run_repository,
    get_voice_factory_gateway,
)
from pythonapi.models.voice_run import (
    ClipDecisionRequest,
    ClipSummary,
    SpeakerBoard,
)
from pythonapi.repositories.voice_clips import VoiceClipRepository
from pythonapi.repositories.voice_repository import VoiceRepository
from pythonapi.repositories.voice_runs import VoiceRunRepository
from pythonapi.routes.voice_route_support import unavailable

router = APIRouter(prefix="/voice", tags=["Voice"])

# Video search, characters, the video list, and clip audio moved to
# routes/voice_factory_proxy.py. The factory owns every one of them and
# nothing here reads their fields, so a typed route was a second definition
# of a shape this service does not own.
#
# Clip decisions came back. They are not the factory's any more: voice_clips
# in Postgres is the review record, so keeping and trimming a clip are writes
# this service owns and must type.


@router.get("/videos/{video_id}/clips", response_model=SpeakerBoard)
async def get_video_speaker_board(
    video_id: str,
    clip_repository: VoiceClipRepository = Depends(get_required_voice_clip_repository),
    voice_repository: VoiceRepository = Depends(get_required_voice_repository),
):
    """Clips grouped by speaker, for the review screen.

    Keyed on the video, because the clips are: a video ingested for one
    character and claimed by another has one set of clips and one review, and
    no run has to exist for a person to read them.

    The speaker grouping is a convenience for assigning several clips at
    once. What each clip trains is its own assignment, resolved to a name
    here rather than stored beside the id, so renaming a voice cannot leave
    a stale label on a clip.
    """
    clips = await clip_repository.list_clips_for_video(video_id)
    return build_speaker_board(
        video_id, await name_assigned_voices(clips, voice_repository)
    )


@router.patch("/videos/{video_id}/clips", response_model=list[ClipSummary])
async def update_clips(
    video_id: str,
    decisions_request: ClipDecisionRequest,
    clip_repository: VoiceClipRepository = Depends(get_required_voice_clip_repository),
    voice_repository: VoiceRepository = Depends(get_required_voice_repository),
    gateway: VoiceFactoryGateway | None = Depends(get_voice_factory_gateway),
):
    """Keep, exclude, retype or trim clips of one video.

    Which voice a clip trains is not here - see POST /api/voices/{id}/clips.
    Splitting them is what lets a reviewer assign a whole speaker at once and
    then cull it clip by clip, without either write undoing the other.

    A plain resize (bounds with no text) also refills text from the video's
    transcript, unless the clip's text was already hand-edited - see
    apply_decisions_with_transcript_fill. The gateway is optional, same as
    every other Postgres-owned write here: VOICE_FACTORY_URL unset just
    skips the fill.
    """
    changed = await apply_decisions_with_transcript_fill(
        video_id, decisions_request.decisions, clip_repository, gateway
    )
    return await name_assigned_voices(changed, voice_repository)


@router.delete("/videos/{video_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_video(
    video_id: str,
    gateway: VoiceFactoryGateway = Depends(get_required_voice_factory_gateway),
    repository: VoiceRunRepository = Depends(get_required_voice_run_repository),
    clip_repository: VoiceClipRepository = Depends(get_required_voice_clip_repository),
):
    """Delete a video, its clips, and every run pointing at it.

    The video's audio lives on the factory host; its runs and clips live in
    Postgres. Deleting only one side would either orphan a run or leave a
    video the operator can no longer act on, so this does all three. Runs go
    first, the same way delete_run cancels a live job before dropping the
    row.
    """
    for run in await repository.list_runs_for_video(video_id):
        if run.voyicer_job_id:
            with suppress(VoiceFactoryError):
                await gateway.cancel_job(run.voyicer_job_id)
        await repository.delete_run(run.id)

    await clip_repository.delete_clips_for_video(video_id)

    try:
        await gateway.delete_video(video_id)
    except VoiceFactoryError as error:
        raise unavailable(error) from error
