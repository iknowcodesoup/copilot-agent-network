"""HTTP layer for run-scoped voice-pipeline actions.

Split out of routes/voice.py (Finding 5): this file, voice_videos.py,
voice_jobs.py, and voice_events.py each cover one resource under the
/api/voice prefix. A run is ingest and nothing else: assigning clips to a
voice is the Voice's own resource, in routes/voices.py.
"""

from contextlib import suppress

from fastapi import APIRouter, Depends, HTTPException, Query, status

from pythonapi.core.voice_factory_gateway import (
    VoiceFactoryError,
    VoiceFactoryGateway,
)
from pythonapi.core.voice_operations import load_run, start_voice_run
from pythonapi.dependencies import (
    get_required_voice_factory_gateway,
    get_required_voice_run_reconciler,
    get_required_voice_run_repository,
)
from pythonapi.models.voice_run import (
    JobLog,
    TrainingProgress,
    VoiceRun,
    VoiceRunPhase,
    VoiceRunRequest,
    VoiceRunResponse,
)
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
    keeps ingest_stage_index, which is what makes this a resume rather than a
    restart: a run that failed transcoding starts again at the download step,
    not at a fresh ingest. Only the dead job and the error go.
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
