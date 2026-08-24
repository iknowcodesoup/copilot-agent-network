"""A2A transport for the `assist` skill.

Same shape as `ResearchAgentExecutor`: read the request out of the incoming
message, call the skill, and publish the result as a task that reaches a
terminal state. The protocol stays out of `delegating_agent.py` entirely.
"""

from __future__ import annotations

import logging

from a2a.server.agent_execution import RequestContext
from a2a.server.agent_execution.agent_executor import AgentExecutor
from a2a.server.events import EventQueue
from a2a.server.tasks import TaskUpdater
from a2a.types import Part

from pythonapi.a2a_support.execution import start_task
from pythonapi.agents.orchestrator.interface import (
    OrchestratorAgentInterface,
    OrchestratorRequest,
)

logger = logging.getLogger(__name__)

EMPTY_REQUEST_MESSAGE = "Send a request as the text of the message."


class OrchestratorAgentExecutor(AgentExecutor):
    """Runs the `assist` skill for one A2A task."""

    def __init__(self, agent: OrchestratorAgentInterface) -> None:
        self._agent = agent

    async def execute(self, context: RequestContext, event_queue: EventQueue) -> None:
        updater = await start_task(context, event_queue)

        text = (context.get_user_input() or "").strip()
        if not text:
            await updater.reject(
                message=updater.new_agent_message(
                    parts=[_text_part(EMPTY_REQUEST_MESSAGE)]
                )
            )
            return

        logger.info(
            "orchestrator assist task started",
            extra={"a2a_task_id": context.task_id, "context_id": context.context_id},
        )

        answer = await self._agent.assist(OrchestratorRequest(text=text))

        await updater.complete(
            message=updater.new_agent_message(parts=[_text_part(answer.answer)])
        )

        logger.info(
            "orchestrator assist task completed",
            extra={"a2a_task_id": context.task_id, "context_id": context.context_id},
        )

    async def cancel(self, context: RequestContext, event_queue: EventQueue) -> None:
        """One non-resumable call, so there is nothing to stop - only a
        terminal state to report."""
        updater = TaskUpdater(event_queue, context.task_id, context.context_id)
        await updater.cancel()


def _text_part(text: str) -> Part:
    return Part(text=text)
