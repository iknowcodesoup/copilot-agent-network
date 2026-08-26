"""Voice operations shared by the REST routes and the Voice Agent.

Both surfaces must do the same thing, so the work lives here once and each
transport calls it. Without this, a run started over A2A and a run started
over REST would drift apart the first time either side changed.

These raise HTTPException. The routes let it through unchanged; the Voice
Agent catches it and turns the status code into a task state.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from fastapi import HTTPException, status

from pythonapi.core.voice_factory_gateway import VoiceFactoryError, VoiceFactoryGateway
from pythonapi.models.voice_run import (
    VoiceRun,
    VoiceRunPhase,
    VoiceRunRequest,
    VoiceRunResponse,
)
from pythonapi.repositories.voice_runs import VoiceRunRepository

FACTORY_UNAVAILABLE = "The voice factory did not answer"


async def load_run(repository: VoiceRunRepository, run_id: str) -> VoiceRun:
    """One run, or a 404. Here rather than in each route, so every surface
    that names a run by id reports an unknown one the same way."""
    run = await repository.get_run(run_id)
    if run is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Voice run not found")
    return run


def factory_unavailable(error: Exception) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_502_BAD_GATEWAY,
        detail=f"{FACTORY_UNAVAILABLE}: {error}",
    )


async def start_voice_run(
    run_request: VoiceRunRequest,
    gateway: VoiceFactoryGateway,
    repository: VoiceRunRepository,
) -> VoiceRunResponse:
    """Start a run and return at once.

    Resolving the video id is the only thing done inline: it costs one
    request, downloads nothing, and every later call needs the id to find the
    run's directory. Everything after this is the reconciler's job.
    """
    try:
        video_id = await gateway.resolve_video_id(run_request.source_url)
    except VoiceFactoryError as error:
        raise factory_unavailable(error) from error

    now = datetime.now(UTC)
    run = VoiceRun(
        id=uuid.uuid4().hex,
        primary_character=run_request.primary_character,
        source_url=run_request.source_url,
        video_id=video_id,
        phase=VoiceRunPhase.DOWNLOADING,
        diarize=run_request.diarize,
        num_speakers=run_request.num_speakers,
        created_at=now,
        updated_at=now,
    )
    await repository.create_run(run)
    return VoiceRunResponse(id=run.id, phase=run.phase)
