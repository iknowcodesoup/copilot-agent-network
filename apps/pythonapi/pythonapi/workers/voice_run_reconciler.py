"""Background loop that advances voice runs.

Follows EmbeddingWorkerPool's lifecycle (start/shutdown, an asyncio task, a
catch-all around each unit of work) but reconciles instead of consuming a queue.
Every pass reads the active runs out of Postgres and walks each one forward by a
single graph node.

That difference is deliberate. A voice run outlives this process - training
takes hours and a human review can sit for days - so the work to do has to be
derivable from the database alone. A restart resumes every run exactly where it
was, and nothing is lost with an in-memory queue.

Two things drive a pass:

- `wake(run_id)`, which the factory webhook calls the moment something changes.
  This is the fast path and it reconciles that one run.
- the interval timer, which sweeps every active run. This is the backstop for a
  webhook that never arrived, and the only reason the factory is still polled
  at all.

This class stays the single writer of run phases. The webhook reports; it never
decides. Every phase change is published to the voice event stream, which is how
it reaches a browser.
"""

import asyncio
import logging
import uuid

from pythonapi.core.voice_events import VoiceEventStream
from pythonapi.core.voice_factory_gateway import VoiceFactoryError, VoiceFactoryGateway
from pythonapi.core.voice_pipeline_graph import VoiceRunState
from pythonapi.models.voice import VoiceRun, VoiceRunPhase
from pythonapi.repositories.voice_runs import VoiceRunRepository

logger = logging.getLogger(__name__)


class VoiceRunReconciler:
    def __init__(
        self,
        repository: VoiceRunRepository,
        graph,
        interval_seconds: float,
        event_stream: VoiceEventStream,
        lease_seconds: float,
        max_consecutive_errors: int,
        gateway: VoiceFactoryGateway,
    ) -> None:
        self.repository = repository
        self.graph = graph
        self.interval_seconds = interval_seconds
        self.event_stream = event_stream
        self.lease_seconds = lease_seconds
        self.max_consecutive_errors = max_consecutive_errors
        self.gateway = gateway
        # Which instance a lease belongs to. New every start, because a lease
        # held by a previous incarnation of this process is nobody's.
        self.instance_id = uuid.uuid4().hex
        self._task: asyncio.Task | None = None
        self._stopping = asyncio.Event()
        # A set, not a queue: a burst of webhooks for one run is one wake.
        self._pending_wakes: set[str] = set()
        # Set by both wake() and shutdown(), so the idle wait ends for either.
        self._signal = asyncio.Event()
        # Last log offset sent per job. In memory only: losing it on a restart
        # just re-sends a bit of tail, harmless for a log view.
        self._log_offsets: dict[str, int] = {}

    def start(self) -> None:
        self._task = asyncio.create_task(self._loop())

    async def shutdown(self) -> None:
        self._stopping.set()
        self._signal.set()
        if self._task is not None:
            await asyncio.gather(self._task, return_exceptions=True)
            self._task = None

    def wake(self, run_id: str) -> None:
        """Ask for one run to be reconciled now.

        Synchronous and never fails, because the webhook route calls it and a
        webhook must not be able to hold up the factory.
        """
        self._pending_wakes.add(run_id)
        self._signal.set()

    async def _loop(self) -> None:
        while not self._stopping.is_set():
            try:
                await self.tick()
            except Exception:
                # one bad tick must not kill the loop: the next pass re-reads
                # every run from Postgres and tries again
                logger.exception("Voice run reconcile tick failed")
            await self._wait_for_work()

    async def _wait_for_work(self) -> None:
        """Sleep out the interval, handling any wake that arrives meanwhile."""
        loop = asyncio.get_running_loop()
        deadline = loop.time() + self.interval_seconds
        while not self._stopping.is_set():
            remaining = deadline - loop.time()
            if remaining <= 0:
                return
            try:
                await asyncio.wait_for(self._signal.wait(), timeout=remaining)
            except TimeoutError:
                return
            self._signal.clear()
            if self._stopping.is_set():
                return
            await self._handle_wakes()

    async def _handle_wakes(self) -> None:
        pending = self._pending_wakes
        self._pending_wakes = set()
        for run_id in pending:
            try:
                await self.reconcile_run(run_id)
            except Exception:
                logger.exception("Voice run %s could not be reconciled on wake", run_id)

    async def tick(self) -> int:
        """Advance every active run by one step. Returns how many changed.

        Public so tests can drive it directly instead of waiting on the timer.
        """
        runs = await self.repository.claim_runs(self.instance_id, self.lease_seconds)
        changed_count = 0
        for run in runs:
            try:
                if await self._advance(run):
                    changed_count += 1
            finally:
                await self.repository.release_run(run.id)
        return changed_count

    async def reconcile_run(self, run_id: str) -> bool:
        """Advance one run, because something told us it moved.

        Publishes the run's state even when the phase did not change: a wake
        only arrives after the factory reported something, and progress written
        by the webhook is a real change the browser wants. Duplicate states are
        harmless, since every event carries the complete run.
        """
        run = await self.repository.claim_run(
            run_id, self.instance_id, self.lease_seconds
        )
        if run is None:
            # resting, gone, or another instance already has it
            return False
        try:
            if await self._advance(run):
                return True
            # Nothing moved, so publish what the run looks like now. Re-read it
            # rather than reuse the claimed copy: the webhook may have written
            # progress since, and a run deleted mid-tick must not be published.
            current = await self.repository.get_run(run_id)
            if current is not None:
                await self._publish(current)
            return False
        finally:
            await self.repository.release_run(run_id)

    async def _advance(self, run: VoiceRun) -> bool:
        try:
            result: VoiceRunState = await self.graph.ainvoke({"run": run})
        except Exception as error:
            # the graph turns every factory failure into either a deferral or a
            # FAILED run, so reaching here means a bug rather than an
            # unreachable host. Record it on the run instead of retrying forever.
            logger.exception("Voice run %s could not be advanced", run.id)
            run.failed_from_phase = run.phase
            run.phase = VoiceRunPhase.FAILED
            run.error = f"Pipeline error: {error}"
            return await self._persist(run)

        ticked_run = result.get("run")
        if ticked_run is not None:
            await self._tail_log(ticked_run)

        transient_error = result.get("transient_error")
        if transient_error:
            return await self._record_transient_error(result["run"], transient_error)

        updated = result["run"]
        if not result.get("changed"):
            # the factory answered, so any earlier trouble is over
            return await self._clear_errors(updated)

        updated.error_count = 0
        if updated.phase is not VoiceRunPhase.FAILED:
            updated.error = None
        if not await self._persist(updated):
            return False
        logger.info("Voice run %s advanced to %s", updated.id, updated.phase)
        return True

    async def _record_transient_error(self, run: VoiceRun, message: str) -> bool:
        """Count one unreachable-factory tick. Fail the run only at the limit."""
        run.error_count += 1
        run.error = message
        if run.error_count >= self.max_consecutive_errors:
            logger.warning(
                "Voice run %s failed after %s consecutive factory errors",
                run.id,
                run.error_count,
            )
            run.failed_from_phase = run.phase
            run.phase = VoiceRunPhase.FAILED
        else:
            logger.info(
                "Voice run %s deferred, factory error %s of %s: %s",
                run.id,
                run.error_count,
                self.max_consecutive_errors,
                message,
            )
        return await self._persist(run)

    async def _clear_errors(self, run: VoiceRun) -> bool:
        """Reset the error count after a clean pass. No-op when it is already 0."""
        if run.error_count == 0 and run.error is None:
            return False
        run.error_count = 0
        run.error = None
        return await self._persist(run)

    async def _persist(self, run: VoiceRun) -> bool:
        # False means the run was deleted while this tick was in flight, the
        # same guard embedding_worker uses around update_document_if_exists
        if not await self.repository.update_run(run):
            logger.info("Voice run %s vanished mid-tick, dropping the update", run.id)
            return False
        await self._publish(run)
        return True

    async def _publish(self, run: VoiceRun) -> None:
        """Send the run's current state out to every browser.

        Postgres already has it, so a publishing failure is logged inside the
        stream and never raised. Losing Redis costs live updates, nothing more.
        """
        await self.event_stream.publish(run)

    async def _tail_log(self, run: VoiceRun) -> None:
        """Forward any new job-log content onto the event stream.

        Rides the same tick that already runs on every wake and on the
        interval backstop, so there is no separate poll loop for this. A log
        fetch is best-effort: a failure here must never touch the run's state.
        """
        job_id = run.voyicer_job_id
        if job_id is None:
            return
        offset = self._log_offsets.get(job_id, 0)
        try:
            payload = await self.gateway.get_job_logs(job_id, offset)
        except VoiceFactoryError as error:
            logger.info("Could not tail log for job %s: %s", job_id, error)
            return
        content = payload.get("content", "")
        if not content:
            return
        self._log_offsets[job_id] = payload.get("offset", offset)
        await self.event_stream.publish_log(
            run.id, job_id, self._log_offsets[job_id], content
        )
