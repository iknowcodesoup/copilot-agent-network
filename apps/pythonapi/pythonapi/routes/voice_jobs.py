"""HTTP layer for the voice factory's job webhook.

Split out of routes/voice.py (Finding 5): this file, voice_videos.py,
voice_runs.py, and voice_events.py each cover one resource under the
/api/voice prefix.
"""

from fastapi import APIRouter, Depends, Header, HTTPException, status

from pythonapi.config import settings
from pythonapi.dependencies import (
    get_required_voice_run_reconciler,
    get_required_voice_run_repository,
)
from pythonapi.models.voice_run import VoiceWebhookEvent
from pythonapi.repositories.voice_runs import VoiceRunRepository
from pythonapi.workers.voice_run_reconciler import VoiceRunReconciler

router = APIRouter(prefix="/voice", tags=["Voice"])

# Header the voice factory signs its webhooks with.
WEBHOOK_TOKEN_HEADER = "X-Voice-Factory-Token"


@router.post("/jobs/{job_id}/events", status_code=status.HTTP_204_NO_CONTENT)
async def post_job_event(
    job_id: str,
    event: VoiceWebhookEvent,
    repository: VoiceRunRepository = Depends(get_required_voice_run_repository),
    reconciler: VoiceRunReconciler = Depends(get_required_voice_run_reconciler),
    token: str | None = Header(default=None, alias=WEBHOOK_TOKEN_HEADER),
):
    """Accept one job event from the voice factory.

    This is a report, never a command. It records progress and wakes the
    reconciler, which then asks the factory what really happened and owns the
    phase change. So a lost webhook costs latency and nothing else: the
    reconcile timer catches the same change on its next pass.

    Answers 204 for a job no run claims. The factory runs jobs this service
    never started, and a webhook failure must not stop one.
    """
    if not settings.VOICE_WEBHOOK_TOKEN:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "Webhooks are not configured. Set VOICE_WEBHOOK_TOKEN.",
        )
    if token != settings.VOICE_WEBHOOK_TOKEN:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid webhook token")

    run = await repository.find_run_by_job_id(job_id)
    if run is None:
        return None

    if event.epoch is not None or event.loss is not None:
        await repository.record_progress(run.id, event.epoch, event.loss)
    reconciler.wake(run.id)
    return None
