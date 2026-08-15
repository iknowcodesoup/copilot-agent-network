"""Background loop that advances voices toward a trained model.

Mirrors voice_run_reconciler.py's shape: `wake()` is the fast path a route
calls the moment something changes, and the interval timer is the backstop
for a wake that never arrived. This class stays the single writer of voice
phases, on its own graph (voice_training_graph.py) with no shared node code
(FR21) - training a voice is independent of any one video's ingest run.

Same reason as VoiceRunReconciler: a voice's training can run for days and
outlive this process, so the work to do has to be derivable from the
database alone. A restart resumes every voice exactly where it was.
"""

import asyncio
import logging
import uuid

from pythonapi.core.voice_factory_gateway import VoiceFactoryGateway
from pythonapi.core.voice_training_graph import VoiceTrainingState
from pythonapi.models.voices import Voice, VoicePhase
from pythonapi.repositories.voices import VoiceRepository

logger = logging.getLogger(__name__)


class VoiceTrainingReconciler:
    def __init__(
        self,
        repository: VoiceRepository,
        graph,
        interval_seconds: float,
        lease_seconds: float,
        gateway: VoiceFactoryGateway,
    ) -> None:
        self.repository = repository
        self.graph = graph
        self.interval_seconds = interval_seconds
        self.lease_seconds = lease_seconds
        self.gateway = gateway
        # Which instance a lease belongs to. New every start, because a lease
        # held by a previous incarnation of this process is nobody's.
        self.instance_id = uuid.uuid4().hex
        self._task: asyncio.Task | None = None
        self._stopping = asyncio.Event()
        # A set, not a queue: a burst of wakes for one voice is one wake.
        self._pending_wakes: set[str] = set()
        # Set by both wake() and shutdown(), so the idle wait ends for either.
        self._signal = asyncio.Event()

    def start(self) -> None:
        self._task = asyncio.create_task(self._loop())

    async def shutdown(self) -> None:
        self._stopping.set()
        self._signal.set()
        if self._task is not None:
            await asyncio.gather(self._task, return_exceptions=True)
            self._task = None

    def wake(self, voice_id: str) -> None:
        """Ask for one voice to be reconciled now.

        Synchronous and never fails, because a route calls it and a request
        must not be able to hold up the factory.
        """
        self._pending_wakes.add(voice_id)
        self._signal.set()

    async def _loop(self) -> None:
        while not self._stopping.is_set():
            try:
                await self.tick()
            except Exception:
                # one bad tick must not kill the loop: the next pass re-reads
                # every voice from Postgres and tries again
                logger.exception("Voice training reconcile tick failed")
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
        for voice_id in pending:
            try:
                await self.reconcile_voice(voice_id)
            except Exception:
                logger.exception("Voice %s could not be reconciled on wake", voice_id)

    async def tick(self) -> int:
        """Advance every claimable voice by one step. Returns how many
        changed.

        Public so tests can drive it directly instead of waiting on the timer.
        """
        voices = await self.repository.claim_voices(
            self.instance_id, self.lease_seconds
        )
        changed_count = 0
        for voice in voices:
            try:
                if await self._advance(voice):
                    changed_count += 1
            finally:
                await self.repository.release_voice(voice.id)
        return changed_count

    async def reconcile_voice(self, voice_id: str) -> bool:
        """Advance one voice, because something told us it moved."""
        voice = await self.repository.claim_voice(
            voice_id, self.instance_id, self.lease_seconds
        )
        if voice is None:
            # resting, gone, or another instance already has it
            return False
        try:
            return await self._advance(voice)
        finally:
            await self.repository.release_voice(voice_id)

    async def _advance(self, voice: Voice) -> bool:
        try:
            result: VoiceTrainingState = await self.graph.ainvoke({"voice": voice})
        except Exception:
            # the graph turns every factory failure into either a deferral or
            # a FAILED voice, so reaching here means a bug rather than an
            # unreachable host. Record it instead of retrying forever.
            logger.exception("Voice %s could not be advanced", voice.id)
            voice.phase = VoicePhase.FAILED
            return await self._persist(voice)

        if result.get("transient_error"):
            # The factory could not answer this tick. Nothing to persist -
            # the phase and job id are untouched, and the next tick (wake or
            # interval) tries again.
            return False

        updated = result["voice"]
        if not result.get("changed"):
            return False

        if not await self._persist(updated):
            return False
        logger.info("Voice %s advanced to %s", updated.id, updated.phase)
        return True

    async def _persist(self, voice: Voice) -> bool:
        # False means the voice was deleted while this tick was in flight,
        # the same guard voice_run_reconciler.py uses around update_run.
        if not await self.repository.update_voice(voice):
            logger.info("Voice %s vanished mid-tick, dropping the update", voice.id)
            return False
        return True
