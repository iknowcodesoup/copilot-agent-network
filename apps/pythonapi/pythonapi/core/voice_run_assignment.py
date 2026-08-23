"""Orchestration for mapping a run's speakers to Voices and closing review.

Lifted out of routes/voice_runs.py: assigning speakers is validation plus a
write per assigned speaker plus a title lookup, which is business logic, not
HTTP shaping. The route stays a thin translation of request to response;
this is what it delegates to.
"""

import uuid
from datetime import UTC, datetime

from fastapi import HTTPException, status

from pythonapi.core.video_titles import resolve_video_titles
from pythonapi.core.voice_factory_gateway import VoiceFactoryGateway
from pythonapi.models.voice import RunAssignResponse, VoiceContribution
from pythonapi.models.voice_run import VoiceRun, VoiceRunPhase
from pythonapi.repositories.voice_contributions import VoiceContributionRepository
from pythonapi.repositories.voice_repository import VoiceRepository
from pythonapi.repositories.voice_runs import VoiceRunRepository


async def load_run(repository: VoiceRunRepository, run_id: str) -> VoiceRun:
    run = await repository.get_run(run_id)
    if run is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Voice run not found")
    return run


async def require_awaiting_review(
    repository: VoiceRunRepository, run_id: str
) -> VoiceRun:
    run = await load_run(repository, run_id)
    if run.phase is not VoiceRunPhase.AWAITING_REVIEW:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"This run is {run.phase}, so it is not waiting for review",
        )
    return run


async def assign_run_speakers(
    run_id: str,
    assignments: dict[str, str | None],
    repository: VoiceRunRepository,
    voice_repository: VoiceRepository,
    contribution_repository: VoiceContributionRepository,
    gateway: VoiceFactoryGateway | None,
) -> RunAssignResponse:
    """Map a run's speaker labels to Voices.

    Only assignment: it stores the mapping and writes one immutable
    voice_contributions row per assigned speaker. It does not commit the run
    or start training - those are commit_reviewed_run and
    POST /voices/{id}/train, called separately, so relabeling a clip's
    speaker never has a side effect beyond recording it.

    The contribution rows are the durable record and they are written from
    Postgres alone, so this keeps working without a voice factory
    configured. The gateway is optional and supplies one thing: the video's
    title, which the factory owns. Without it the rows are the same,
    unnamed.
    """
    run = await require_awaiting_review(repository, run_id)

    for voice_id in assignments.values():
        if voice_id is None:
            continue
        if await voice_repository.get_voice(voice_id) is None:
            raise HTTPException(
                status.HTTP_404_NOT_FOUND, f"Voice {voice_id!r} not found"
            )

    assigned_speakers = {
        speaker_label: voice_id
        for speaker_label, voice_id in assignments.items()
        if voice_id is not None
    }
    if not assigned_speakers:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Assign at least one speaker")

    titles = await resolve_video_titles(gateway, [run.video_id])

    now = datetime.now(UTC)
    contributions = []
    for speaker_label, voice_id in assigned_speakers.items():
        # The label is the factory's. Turning it into a speaker id here is
        # what keeps every stored association id to id - nothing below this
        # line joins on text.
        speaker_id = await contribution_repository.assign_speaker(
            run.id, speaker_label, voice_id
        )
        contributions.append(
            VoiceContribution(
                id=uuid.uuid4().hex,
                voice_id=voice_id,
                speaker_id=speaker_id,
                run_id=run.id,
                video_id=run.video_id,
                video_title=titles.get(run.video_id),
                speaker_label=speaker_label,
                created_at=now,
            )
        )
    for contribution in contributions:
        await contribution_repository.create_contribution(contribution)

    # The rows above are the record. This keeps the response and the
    # in-memory repository in step with what a Postgres read will project
    # back, which is the assigned speakers only - a discarded one has no
    # contribution row.
    run.voice_assignments = dict(assigned_speakers)
    await repository.update_run(run)
    return RunAssignResponse(
        run_id=run.id,
        voice_assignments=run.voice_assignments,
        contributions=contributions,
    )


async def commit_reviewed_run(repository: VoiceRunRepository, run_id: str) -> VoiceRun:
    """End review once every speaker the operator cares about is assigned.

    Separate from assign_run_speakers on purpose: assigning a speaker must
    not finish the run by itself. This is the one call that does, and it
    does only that - no voice phase change, no training. Training starts
    when the operator calls POST /voices/{id}/train, per voice, from the
    training panel.
    """
    run = await require_awaiting_review(repository, run_id)
    if not any(voice_id is not None for voice_id in run.voice_assignments.values()):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Assign at least one speaker before committing",
        )

    run.phase = VoiceRunPhase.COMMITTED
    await repository.update_run(run)
    return run
