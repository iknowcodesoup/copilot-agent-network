"""LangGraph that advances one voice by one phase, toward a trained model.

Mirrors voice_pipeline_graph.py's shape exactly - stateless, one node per
tick, the durable state is the `voices.phase` column (and voyicer_job_id)
rather than a checkpointer - but it is its own graph with no shared node
code (FR21). Ingestion tracks one video through a VoiceRun; this tracks one
voice's trained-model identity through TRAINING and EXPORTING, which can
outlive any single run that contributed clips to it.

A node never fails a voice for an unreachable factory. Training runs for
days and the GPU host can reboot inside that, so a transient error comes
back as `transient_error` and the phase stays put - same contract as
voice_pipeline_graph.py, decided by VoiceTrainingReconciler the same way.
"""

import logging
from typing import TypedDict

from langgraph.graph import END, StateGraph

from pythonapi.core.voice_factory_gateway import (
    JOB_STATE_CANCELLED,
    JOB_STATE_FAILED,
    JOB_STATE_RUNNING,
    JOB_STATE_SUCCEEDED,
    STAGE_EXPORT,
    STAGE_TRAIN,
    VoiceFactoryError,
    VoiceFactoryGateway,
    VoiceFactoryTransientError,
)
from pythonapi.models.voices import Voice, VoicePhase

logger = logging.getLogger(__name__)


class VoiceTrainingState(TypedDict, total=False):
    """What one tick reads and writes. Mirrors the persisted Voice."""

    voice: Voice
    # set when the tick changed something worth writing back
    changed: bool
    # set when the factory could not answer. The phase is untouched and the
    # reconciler decides whether this voice has had too many of these.
    transient_error: str | None


_NODE_PHASES = frozenset({VoicePhase.TRAINING, VoicePhase.EXPORTING})


def build_voice_training_graph(gateway: VoiceFactoryGateway):
    """Compile the graph. Called once, in main.py's lifespan."""
    builder = StateGraph(VoiceTrainingState)

    builder.add_node(VoicePhase.TRAINING.value, _training_node_factory(gateway))
    builder.add_node(VoicePhase.EXPORTING.value, _exporting_node_factory(gateway))

    builder.set_conditional_entry_point(
        _route_by_phase,
        {
            VoicePhase.TRAINING.value: VoicePhase.TRAINING.value,
            VoicePhase.EXPORTING.value: VoicePhase.EXPORTING.value,
            END: END,
        },
    )
    for phase in (VoicePhase.TRAINING, VoicePhase.EXPORTING):
        builder.add_edge(phase.value, END)

    return builder.compile()


def _route_by_phase(state: VoiceTrainingState) -> str:
    phase = state["voice"].phase
    if phase in _NODE_PHASES:
        return phase.value
    # AWAITING_COMMIT waits on a contribution or an explicit train call;
    # READY and FAILED are terminal.
    return END


def _advance(voice: Voice, phase: VoicePhase) -> VoiceTrainingState:
    voice.phase = phase
    voice.voyicer_job_id = None
    return {"voice": voice, "changed": True}


def _hold(voice: Voice) -> VoiceTrainingState:
    """Nothing to do this tick. The phase and the job both stand."""
    return {"voice": voice, "changed": False}


def _fail(voice: Voice, message: str) -> VoiceTrainingState:
    logger.warning("voice %s failed: %s", voice.id, message)
    voice.phase = VoicePhase.FAILED
    voice.voyicer_job_id = None
    return {"voice": voice, "changed": True}


def _defer(voice: Voice, message: str) -> VoiceTrainingState:
    """The factory could not answer. Try the same thing again next tick."""
    return {"voice": voice, "changed": False, "transient_error": message}


async def _poll_job(
    gateway: VoiceFactoryGateway, voice: Voice, next_phase: VoicePhase
) -> VoiceTrainingState | None:
    """Check the running job. None means it is still going, so leave it
    alone."""
    try:
        state = await gateway.get_job_state(voice.voyicer_job_id)
    except VoiceFactoryTransientError as error:
        return _defer(voice, f"Could not read job {voice.voyicer_job_id}: {error}")
    except VoiceFactoryError as error:
        return _fail(voice, f"Could not read job {voice.voyicer_job_id}: {error}")

    if state == JOB_STATE_RUNNING:
        return None
    if state == JOB_STATE_SUCCEEDED:
        return _advance(voice, next_phase)
    if state in (JOB_STATE_FAILED, JOB_STATE_CANCELLED):
        return _fail(
            voice, f"Job {voice.voyicer_job_id} {state}. See its log for detail."
        )
    return _fail(voice, f"Job {voice.voyicer_job_id} reported unknown state {state!r}")


def _training_node_factory(gateway: VoiceFactoryGateway):
    """TRAINING: fine-tune the model. Takes hours to days.

    voice.name is the character key: get_voice_by_name already guarantees
    uniqueness, so no separate character field is needed here.
    """

    async def node(state: VoiceTrainingState) -> VoiceTrainingState:
        voice = state["voice"]
        if voice.voyicer_job_id is None:
            try:
                job_id = await gateway.start_job(
                    character=voice.name, stage=STAGE_TRAIN
                )
            except VoiceFactoryTransientError as error:
                return _defer(voice, f"Could not start training: {error}")
            except VoiceFactoryError as error:
                return _fail(voice, f"Could not start training: {error}")
            voice.voyicer_job_id = job_id
            return {"voice": voice, "changed": True}

        result = await _poll_job(gateway, voice, VoicePhase.EXPORTING)
        return result if result is not None else _hold(voice)

    return node


def _exporting_node_factory(gateway: VoiceFactoryGateway):
    """EXPORTING: write the ONNX model, then the voice is ready."""

    async def node(state: VoiceTrainingState) -> VoiceTrainingState:
        voice = state["voice"]
        if voice.voyicer_job_id is None:
            try:
                job_id = await gateway.start_job(
                    character=voice.name,
                    stage=STAGE_EXPORT,
                    # No voice ever wrote a checkpoint column - see Story
                    # 3.1's checkpoint_path, which nothing here reads from or
                    # writes to, matching what the ingest graph's export node
                    # already does for runs.
                    checkpoint=None,
                )
            except VoiceFactoryTransientError as error:
                return _defer(voice, f"Could not start export: {error}")
            except VoiceFactoryError as error:
                return _fail(voice, f"Could not start export: {error}")
            voice.voyicer_job_id = job_id
            return {"voice": voice, "changed": True}

        result = await _poll_job(gateway, voice, VoicePhase.READY)
        return result if result is not None else _hold(voice)

    return node
