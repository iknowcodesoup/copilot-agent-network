"""A2A transport for the `research` skill.

The executor is the only place that knows about A2A. It reads the question
out of the incoming message, calls the skill, and publishes the result as a
task that reaches a terminal state. Keeping it this thin is what stops the
protocol from leaking into the RAG code, and what makes the skill testable
without a request context.
"""

from __future__ import annotations

import logging

from a2a.server.agent_execution import RequestContext
from a2a.server.agent_execution.agent_executor import AgentExecutor
from a2a.server.events import EventQueue
from a2a.server.tasks import TaskUpdater
from a2a.types import Part

from pythonapi.a2a_support.execution import start_task
from pythonapi.agents.research.card import RESEARCH_SKILL_ID
from pythonapi.agents.research.interface import (
    ResearchAgentInterface,
    ResearchAnswer,
    ResearchQuestion,
)

logger = logging.getLogger(__name__)

EMPTY_QUESTION_MESSAGE = "Send a question as the text of the message."


class ResearchAgentExecutor(AgentExecutor):
    """Runs the `research` skill for one A2A task."""

    def __init__(self, agent: ResearchAgentInterface) -> None:
        self._agent = agent

    async def execute(self, context: RequestContext, event_queue: EventQueue) -> None:
        updater = await start_task(context, event_queue)

        question = (context.get_user_input() or "").strip()
        if not question:
            # A rejected task is the honest terminal state for input that was
            # never runnable. Failing it would tell the caller the research
            # itself broke.
            await updater.reject(
                message=updater.new_agent_message(
                    parts=[_text_part(EMPTY_QUESTION_MESSAGE)]
                )
            )
            return

        logger.info(
            "research task started",
            extra={"a2a_task_id": context.task_id, "context_id": context.context_id},
        )

        answer = await self._agent.research(ResearchQuestion(question=question))

        # The answer text is the readable reply; the same result rides along
        # as JSON metadata so the Orchestrator can use the sources without
        # parsing prose back apart.
        await updater.complete(
            message=updater.new_agent_message(
                parts=[_text_part(answer.answer)],
                metadata=_result_metadata(answer),
            )
        )

        logger.info(
            "research task completed",
            extra={
                "a2a_task_id": context.task_id,
                "context_id": context.context_id,
                "source_count": len(answer.sources),
            },
        )

    async def cancel(self, context: RequestContext, event_queue: EventQueue) -> None:
        """Research is a single non-resumable call, so there is nothing to
        stop - only a terminal state to report."""
        updater = TaskUpdater(event_queue, context.task_id, context.context_id)
        await updater.cancel()


def _text_part(text: str) -> Part:
    return Part(text=text)


def _result_metadata(answer: ResearchAnswer) -> dict:
    """The structured half of the reply.

    `new_agent_message` converts a plain dict into the protobuf Struct the
    message carries, so the sources stay machine-readable for the caller
    without a second parse of the answer prose.
    """
    return {
        "skill": RESEARCH_SKILL_ID,
        "sources": [source.model_dump() for source in answer.sources],
    }
