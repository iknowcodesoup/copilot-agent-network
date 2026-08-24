"""HTTP layer for run-scoped voice-pipeline actions.

Split out of routes/voice.py (Finding 5): this file, voice_videos.py,
voice_jobs.py, and voice_events.py each cover one resource under the
/api/voice prefix. assign_run and commit_run delegate their orchestration to
core/voice_run_assignment.py rather than carrying it inline.
"""

from contextlib import suppress

from fastapi import APIRouter, Depends, HTTPException, Query, status

from pythonapi.core.voice_factory_gateway import (
    VoiceFactoryError,
    VoiceFactoryGateway,
)
from pythonapi.core.voice_operations import approve_voice_review, start_voice_run
from pythonapi.core.voice_run_assignment import (
    assign_run_speakers,
    commit_reviewed_run,
    load_run,
)
from pythonapi.dependencies import (
    get_required_voice_contribution_repository,
    get_required_voice_factory_gateway,
    get_required_voice_repository,
    get_required_voice_run_reconciler,
    get_required_voice_run_repository,
    get_voice_factory_gateway,
)
from pythonapi.models.voice import RunAssignRequest, RunAssignResponse
from pythonapi.models.voice_run import (
    JobLog,
    SpeakerAssignmentRequest,
    TrainingProgress,
    VoiceRun,
    VoiceRunPhase,
    VoiceRunRequest,
    VoiceRunResponse,
)
from pythonapi.repositories.voice_contributions import VoiceContributionRepository
from pythonapi.repositories.voice_repository import VoiceRepository
from pythonapi.repositories.voice_runs import VoiceRunRepository
from pythonapi.routes.voice_route_support import unavailable
from pythonapi.workers.voice_run_reconciler import VoiceRunReconciler

router = APIRouter(prefix="/voice", tags=["Voice"])


@router.post(
    "/runs",
    response_model=VoiceRunResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
async def start_run(
    run_request: VoiceRunRequest,
    gateway: VoiceFactoryGateway = Depends(get_required_voice_factory_gateway),
    repository: VoiceRunRepository = Depends(get_required_voice_run_repository),
):
    """Start a run and return at once. See core.voice_operations."""
    return await start_voice_run(run_request, gateway, repository)


@router.get("/runs", response_model=list[VoiceRun])
async def list_runs(
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    repository: VoiceRunRepository = Depends(get_required_voice_run_repository),
):
    return await repository.list_runs(limit=limit, offset=offset)


@router.get("/runs/{run_id}", response_model=VoiceRun)
async def get_run(
    run_id: str,
    repository: VoiceRunRepository = Depends(get_required_voice_run_repository),
):
    return await load_run(repository, run_id)


@router.delete("/runs/{run_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_run(
    run_id: str,
    gateway: VoiceFactoryGateway = Depends(get_required_voice_factory_gateway),
    repository: VoiceRunRepository = Depends(get_required_voice_run_repository),
):
    """Delete a run. Cancels its job first so nothing keeps running headless."""
    run = await load_run(repository, run_id)
    if run.voyicer_job_id:
        # the run goes away either way; a stale job is the lesser problem
        with suppress(VoiceFactoryError):
            await gateway.cancel_job(run.voyicer_job_id)
    await repository.delete_run(run_id)


@router.post("/runs/{run_id}/approve", response_model=VoiceRun)
async def approve_run(
    run_id: str,
    assignment: SpeakerAssignmentRequest,
    gateway: VoiceFactoryGateway = Depends(get_required_voice_factory_gateway),
    repository: VoiceRunRepository = Depends(get_required_voice_run_repository),
):
    """End the review and start training. See core.voice_operations."""
    return await approve_voice_review(run_id, assignment, gateway, repository)


@router.post(
    "/runs/{run_id}/assign",
    response_model=RunAssignResponse,
    status_code=status.HTTP_201_CREATED,
)
async def assign_run(
    run_id: str,
    assign_request: RunAssignRequest,
    repository: VoiceRunRepository = Depends(get_required_voice_run_repository),
    voice_repository: VoiceRepository = Depends(get_required_voice_repository),
    contribution_repository: VoiceContributionRepository = Depends(
        get_required_voice_contribution_repository
    ),
    gateway: VoiceFactoryGateway | None = Depends(get_voice_factory_gateway),
):
    """Map a run's speaker labels to Voices. See
    core.voice_run_assignment.assign_run_speakers for the orchestration."""
    return await assign_run_speakers(
        run_id,
        assign_request.assignments,
        repository,
        voice_repository,
        contribution_repository,
        gateway,
    )


@router.post(
    "/runs/{run_id}/commit",
    response_model=VoiceRun,
    status_code=status.HTTP_200_OK,
)
async def commit_run(
    run_id: str,
    repository: VoiceRunRepository = Depends(get_required_voice_run_repository),
    voice_repository: VoiceRepository = Depends(get_required_voice_repository),
    gateway: VoiceFactoryGateway = Depends(get_required_voice_factory_gateway),
):
    """End review once every speaker the operator cares about is assigned.
    See core.voice_run_assignment.commit_reviewed_run for the orchestration."""
    return await commit_reviewed_run(repository, voice_repository, gateway, run_id)


@router.get("/runs/{run_id}/logs", response_model=JobLog)
async def get_run_logs(
    run_id: str,
    offset: int = Query(default=0, ge=0),
    gateway: VoiceFactoryGateway = Depends(get_required_voice_factory_gateway),
    repository: VoiceRunRepository = Depends(get_required_voice_run_repository),
):
    run = await load_run(repository, run_id)
    # A failed run has no running job, and its log is exactly what a person
    # opens the run to read. So fall back to the job that failed.
    job_id = run.voyicer_job_id or run.failed_job_id
    if not job_id:
        return JobLog(offset=0, content="", state=run.phase.value)
    try:
        payload = await gateway.get_job_logs(job_id, offset)
    except VoiceFactoryError as error:
        raise unavailable(error) from error
    return JobLog(**payload)


@router.get("/runs/{run_id}/training", response_model=TrainingProgress)
async def get_training_progress(
    run_id: str,
    gateway: VoiceFactoryGateway = Depends(get_required_voice_factory_gateway),
    repository: VoiceRunRepository = Depends(get_required_voice_run_repository),
):
    run = await load_run(repository, run_id)
    try:
        return await gateway.get_training_progress(run.primary_character)
    except VoiceFactoryError as error:
        raise unavailable(error) from error


@router.post("/runs/{run_id}/retry", response_model=VoiceRun)
async def retry_run(
    run_id: str,
    repository: VoiceRunRepository = Depends(get_required_voice_run_repository),
    reconciler: VoiceRunReconciler = Depends(get_required_voice_run_reconciler),
):
    """Put a failed run back on the step it fell over on.

    The run keeps everything it already produced - clips, review decisions,
    checkpoints - because all of that lives on the voice factory host. It also
    keeps ingest_stage_index and commit_stage_index, which is what makes this a
    resume rather than a restart: a run that failed transcoding starts again at
    the download step, not at a fresh ingest. Only the dead job and the error go.
    """
    run = await load_run(repository, run_id)
    if run.phase is not VoiceRunPhase.FAILED:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"This run is {run.phase}, so there is nothing to retry",
        )

    run.phase = run.failed_from_phase or VoiceRunPhase.DOWNLOADING
    run.failed_from_phase = None
    run.failed_job_id = None
    run.voyicer_job_id = None
    run.error = None
    run.error_count = 0
    await repository.update_run(run)
    reconciler.wake(run.id)
    return run
