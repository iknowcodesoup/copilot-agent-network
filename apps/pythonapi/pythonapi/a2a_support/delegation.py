"""Send one delegated task and read its result.

This is the Orchestrator's side of A2A. It sends a message, waits for the
task to reach a terminal state, and returns what came back. Every failure -
an agent that is down, a task that failed, a task that never finished - comes
back as a `DelegatedResult` with `succeeded` False rather than an exception,
because the Orchestrator must be able to carry on with whatever else it asked
for (CAP-5).
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field

from a2a.types import Message, Part, Role, SendMessageRequest, TaskState
from google.protobuf.json_format import MessageToDict

from pythonapi.a2a_support.discovery import (
    Specialist,
    SpecialistDirectory,
    SpecialistUnavailable,
)
from pythonapi.config import settings

logger = logging.getLogger(__name__)

TASK_PAYLOAD = "task"

TERMINAL_STATES = frozenset(
    {
        TaskState.TASK_STATE_COMPLETED,
        TaskState.TASK_STATE_FAILED,
        TaskState.TASK_STATE_CANCELED,
        TaskState.TASK_STATE_REJECTED,
    }
)


@dataclass
class DelegatedResult:
    """One delegated task, as the Orchestrator records it.

    These are exactly the fields agent-contracts.md requires per task. The
    specialist's reasoning is deliberately not among them - only its result.
    """

    specialist: Specialist
    skill: str
    succeeded: bool
    text: str
    task_id: str = ""
    context_id: str = ""
    metadata: dict = field(default_factory=dict)


async def delegate(
    directory: SpecialistDirectory,
    specialist: Specialist,
    *,
    skill: str,
    text: str,
    arguments: dict | None = None,
) -> DelegatedResult:
    """Ask one specialist to do one thing, and wait for its answer."""
    try:
        client = await directory.client_for(specialist)
    except SpecialistUnavailable as error:
        return DelegatedResult(
            specialist=specialist, skill=skill, succeeded=False, text=str(error)
        )

    metadata = {"skill": skill}
    if arguments is not None:
        metadata["arguments"] = arguments

    request = SendMessageRequest(
        message=Message(
            message_id=f"orchestrator-{specialist.value}",
            role=Role.ROLE_USER,
            parts=[Part(text=text)],
            metadata=metadata,
        )
    )

    try:
        task = await asyncio.wait_for(
            _final_task(client, request),
            timeout=settings.A2A_TASK_TIMEOUT_SECONDS,
        )
    except TimeoutError:
        logger.warning(
            "delegated task timed out",
            extra={"agent": specialist.value, "skill": skill},
        )
        return DelegatedResult(
            specialist=specialist,
            skill=skill,
            succeeded=False,
            text=f"The {specialist.value} agent did not answer in time.",
        )
    except Exception as error:
        logger.warning(
            "delegated task failed",
            extra={"agent": specialist.value, "skill": skill, "error": str(error)},
        )
        return DelegatedResult(
            specialist=specialist,
            skill=skill,
            succeeded=False,
            text=f"The {specialist.value} agent could not answer: {error}",
        )

    if task is None:
        return DelegatedResult(
            specialist=specialist,
            skill=skill,
            succeeded=False,
            text=f"The {specialist.value} agent returned no task.",
        )

    result = DelegatedResult(
        specialist=specialist,
        skill=skill,
        succeeded=task.status.state == TaskState.TASK_STATE_COMPLETED,
        text=_message_text(task),
        task_id=task.id,
        context_id=task.context_id,
        metadata=_message_metadata(task),
    )

    logger.info(
        "delegated task finished",
        extra={
            "agent": specialist.value,
            "skill": skill,
            "a2a_task_id": result.task_id,
            "context_id": result.context_id,
            "succeeded": result.succeeded,
        },
    )
    return result


async def _final_task(client, request):
    """The last task the specialist published for this message."""
    task = None
    async for event in client.send_message(request):
        if event.WhichOneof("payload") == TASK_PAYLOAD:
            task = event.task
            if task.status.state in TERMINAL_STATES:
                break
    return task


def _message_text(task) -> str:
    message = task.status.message
    return "".join(part.text for part in message.parts if part.text)


def _message_metadata(task) -> dict:
    message = task.status.message
    if not message.HasField("metadata"):
        return {}
    return MessageToDict(message.metadata)
