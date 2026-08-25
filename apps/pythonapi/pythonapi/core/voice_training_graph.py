"""LangGraph that advances one voice by one phase, toward a trained model.

Mirrors voice_run_graph.py's shape exactly - stateless, one node per
tick, the durable state is the `voices.phase` column (and voyicer_job_id)
rather than a checkpointer - but it is its own graph, its own lease, and
its own failure domain (FR21): only the tick-bookkeeping mechanics that are
genuinely identical live in voice_graph_support.py. Ingestion tracks one
video through a VoiceRun; this tracks one voice's trained-model identity
through COMPILING, TRAINING and EXPORTING, which can outlive any single run
that contributed clips to it.

COMPILING is the first phase because a voice's training audio is built at
training start, not at review time: it gathers every kept clip assigned to
this voice, across every video, and rebuilds the dataset from scratch. That
is what makes every clip decision reversible without an un-merge step.

A node never fails a voice for an unreachable factory. Training runs for
days and the GPU host can reboot inside that, so a transient error comes
back as `transient_error` and the phase stays put - same contract as
voice_run_graph.py, decided by VoiceTrainingReconciler the same way.
"""

import logging
from typing import TypedDict

from langgraph.graph import END, StateGraph

from pythonapi.core.voice_factory_gateway import VoiceFactoryGateway
from pythonapi.core.voice_graph_support import (
    compiling_node_factory,
    exporting_node_factory,
    route_by_phase,
    training_node_factory,
)
from pythonapi.models.voice import Voice, VoicePhase

logger = logging.getLogger(__name__)


class VoiceTrainingState(TypedDict, total=False):
    """What one tick reads and writes. Mirrors the persisted Voice."""

    voice: Voice
    # set when the tick changed something worth writing back
    changed: bool
    # set when the factory could not answer. The phase is untouched and the
    # reconciler decides whether this voice has had too many of these.
    transient_error: str | None


_NODE_PHASES = frozenset(
    {VoicePhase.COMPILING, VoicePhase.TRAINING, VoicePhase.EXPORTING}
)


def build_voice_training_graph(gateway: VoiceFactoryGateway):
    """Compile the graph. Called once, in main.py's lifespan."""
    builder = StateGraph(VoiceTrainingState)

    builder.add_node(
        VoicePhase.COMPILING.value,
        compiling_node_factory(
            gateway, "voice", lambda voice: voice.name, _fail, VoicePhase.TRAINING
        ),
    )
    builder.add_node(
        VoicePhase.TRAINING.value,
        training_node_factory(
            gateway, "voice", lambda voice: voice.name, _fail, VoicePhase.EXPORTING
        ),
    )
    builder.add_node(
        VoicePhase.EXPORTING.value,
        exporting_node_factory(
            gateway, "voice", lambda voice: voice.name, _fail, VoicePhase.READY
        ),
    )

    builder.set_conditional_entry_point(
        _route_by_phase,
        {
            VoicePhase.COMPILING.value: VoicePhase.COMPILING.value,
            VoicePhase.TRAINING.value: VoicePhase.TRAINING.value,
            VoicePhase.EXPORTING.value: VoicePhase.EXPORTING.value,
            END: END,
        },
    )
    for phase in (VoicePhase.COMPILING, VoicePhase.TRAINING, VoicePhase.EXPORTING):
        builder.add_edge(phase.value, END)

    return builder.compile()


def _route_by_phase(state: VoiceTrainingState) -> str:
    # AWAITING_COMMIT waits on a contribution or an explicit train call;
    # READY and FAILED are terminal.
    return route_by_phase(state, "voice", _NODE_PHASES, END)


def _fail(voice: Voice, message: str) -> VoiceTrainingState:
    logger.warning("voice %s failed: %s", voice.id, message)
    voice.phase = VoicePhase.FAILED
    voice.voyicer_job_id = None
    return {"voice": voice, "changed": True}
