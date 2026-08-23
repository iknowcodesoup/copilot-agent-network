"""Tick-bookkeeping helpers shared by the two voice LangGraph pipelines.

voice_pipeline_graph.py advances a VoiceRun; voice_training_graph.py advances
a Voice. Both walk one phase per tick with no LangGraph checkpointer - the
row is the durable state - and both build their tick's return dict under a
different key ("run" vs "voice"), which state_key threads through below.

The graphs stay independent on purpose: own graph, own lease, own failure
domain (main.py). _fail is not shared, because it is not actually the same
behavior - VoiceRun records failed_from_phase/error/failed_job_id for a
retry to resume from, and Voice has no such fields. Only the phase-advance
mechanics that really are identical live here.
"""

import logging
from collections.abc import Callable
from typing import Any, Protocol, TypeVar

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

logger = logging.getLogger(__name__)


class HasJob(Protocol):
    voyicer_job_id: str | None
    phase: Any


EntityT = TypeVar("EntityT", bound=HasJob)
Fail = Callable[[EntityT, str], dict]


def advance(entity: EntityT, phase: Any, state_key: str) -> dict:
    entity.phase = phase
    entity.voyicer_job_id = None
    return {state_key: entity, "changed": True}


def hold(entity: EntityT, state_key: str) -> dict:
    """Nothing to do this tick. The phase and the job both stand."""
    return {state_key: entity, "changed": False}


def defer(entity: EntityT, message: str, state_key: str) -> dict:
    """The factory could not answer. Try the same thing again next tick."""
    return {state_key: entity, "changed": False, "transient_error": message}


def route_by_phase(
    state: dict, state_key: str, node_phases: frozenset, end: Any
) -> str:
    phase = state[state_key].phase
    if phase in node_phases:
        return phase.value
    return end


async def poll_job(
    gateway: VoiceFactoryGateway,
    entity: EntityT,
    next_phase: Any,
    state_key: str,
    fail: Fail,
) -> dict | None:
    """Check the running job. None means it is still going, so leave it alone."""
    try:
        state = await gateway.get_job_state(entity.voyicer_job_id)
    except VoiceFactoryTransientError as error:
        return defer(
            entity, f"Could not read job {entity.voyicer_job_id}: {error}", state_key
        )
    except VoiceFactoryError as error:
        return fail(entity, f"Could not read job {entity.voyicer_job_id}: {error}")

    if state == JOB_STATE_RUNNING:
        return None
    if state == JOB_STATE_SUCCEEDED:
        return advance(entity, next_phase, state_key)
    if state in (JOB_STATE_FAILED, JOB_STATE_CANCELLED):
        return fail(
            entity, f"Job {entity.voyicer_job_id} {state}. See its log for detail."
        )
    return fail(entity, f"Job {entity.voyicer_job_id} reported unknown state {state!r}")


def training_node_factory(
    gateway: VoiceFactoryGateway,
    state_key: str,
    character_of: Callable[[EntityT], str],
    fail: Fail,
    next_phase: Any,
):
    """TRAINING: fine-tune the model. Takes hours to days."""

    async def node(state: dict) -> dict:
        entity = state[state_key]
        if entity.voyicer_job_id is None:
            try:
                job_id = await gateway.start_job(
                    character=character_of(entity), stage=STAGE_TRAIN
                )
            except VoiceFactoryTransientError as error:
                return defer(entity, f"Could not start training: {error}", state_key)
            except VoiceFactoryError as error:
                return fail(entity, f"Could not start training: {error}")
            entity.voyicer_job_id = job_id
            return {state_key: entity, "changed": True}

        result = await poll_job(gateway, entity, next_phase, state_key, fail)
        return result if result is not None else hold(entity, state_key)

    return node


def exporting_node_factory(
    gateway: VoiceFactoryGateway,
    state_key: str,
    character_of: Callable[[EntityT], str],
    fail: Fail,
    next_phase: Any,
):
    """EXPORTING: write the ONNX model, then the entity is done."""

    async def node(state: dict) -> dict:
        entity = state[state_key]
        if entity.voyicer_job_id is None:
            try:
                job_id = await gateway.start_job(
                    character=character_of(entity),
                    stage=STAGE_EXPORT,
                    # No entity ever wrote this column, so the value was
                    # already always None - see Story 3.1's checkpoint_path.
                    checkpoint=None,
                )
            except VoiceFactoryTransientError as error:
                return defer(entity, f"Could not start export: {error}", state_key)
            except VoiceFactoryError as error:
                return fail(entity, f"Could not start export: {error}")
            entity.voyicer_job_id = job_id
            return {state_key: entity, "changed": True}

        result = await poll_job(gateway, entity, next_phase, state_key, fail)
        return result if result is not None else hold(entity, state_key)

    return node
