"""A2A transport for the four voice skills.

The caller names the skill in the message metadata and puts the skill's
arguments there too. Nothing is inferred from the message text: the spec
requires every A2A input to be validated before execution, and a remote
caller must never be able to reach a function this agent did not publish.
An unknown skill id is rejected, not guessed at.
"""

from __future__ import annotations

import logging

from a2a.server.agent_execution import RequestContext
from a2a.server.agent_execution.agent_executor import AgentExecutor
from a2a.server.events import EventQueue
from a2a.server.tasks import TaskUpdater
from a2a.types import Part
from fastapi import HTTPException
from google.protobuf.json_format import MessageToDict
from pydantic import BaseModel, ValidationError

from pythonapi.a2a_support.execution import start_task
from pythonapi.agents.voice.interface import (
    VoiceAgentInterface,
    VoiceSearchRequest,
    VoiceSkill,
    VoiceStatusRequest,
)
from pythonapi.agents.voice.pipeline_voice_agent import VoiceFactoryNotConfigured
from pythonapi.models.voice_run import VoiceRunRequest

logger = logging.getLogger(__name__)

SKILL_KEY = "skill"
ARGUMENTS_KEY = "arguments"

MISSING_SKILL_MESSAGE = (
    f"Name the skill in the message metadata under '{SKILL_KEY}'. "
    f"One of: {', '.join(skill.value for skill in VoiceSkill)}."
)

# Each skill's argument model. The executor parses into these before calling
# anything, so a malformed payload fails validation rather than reaching the
# pipeline.
REQUEST_MODELS: dict[VoiceSkill, type[BaseModel]] = {
    VoiceSkill.VOICE_SEARCH: VoiceSearchRequest,
    VoiceSkill.VOICE_RUN: VoiceRunRequest,
    VoiceSkill.VOICE_STATUS: VoiceStatusRequest,
}


class VoiceAgentExecutor(AgentExecutor):
    """Runs one of the voice skills for one A2A task."""

    def __init__(self, agent: VoiceAgentInterface) -> None:
        self._agent = agent

    async def execute(self, context: RequestContext, event_queue: EventQueue) -> None:
        updater = await start_task(context, event_queue)
        metadata = _message_metadata(context)

        skill = _parse_skill(metadata.get(SKILL_KEY))
        if skill is None:
            await updater.reject(
                message=updater.new_agent_message(
                    parts=[Part(text=MISSING_SKILL_MESSAGE)]
                )
            )
            return

        try:
            request = REQUEST_MODELS[skill].model_validate(
                metadata.get(ARGUMENTS_KEY) or {}
            )
        except ValidationError as error:
            await updater.reject(
                message=updater.new_agent_message(
                    parts=[Part(text=f"Those arguments are not valid: {error}")]
                )
            )
            return

        logger.info(
            "voice task started",
            extra={
                "a2a_task_id": context.task_id,
                "context_id": context.context_id,
                "skill": skill.value,
            },
        )

        try:
            result = await getattr(self._agent, skill.value)(request)
        except VoiceFactoryNotConfigured as error:
            # The voice side being off is a real answer, not a crash. The
            # Orchestrator reports it and research still works.
            await updater.failed(
                message=updater.new_agent_message(parts=[Part(text=str(error))])
            )
            return
        except HTTPException as error:
            # The shared voice operations raise HTTPException. A 4xx is the
            # caller's fault and a 5xx is ours, but from A2A's side both end
            # the task the same way - with the reason the caller needs.
            await updater.failed(
                message=updater.new_agent_message(
                    parts=[Part(text=str(error.detail))],
                    metadata={"status_code": error.status_code},
                )
            )
            return

        await updater.complete(
            message=updater.new_agent_message(
                parts=[Part(text=_summarize(skill, result))],
                metadata={
                    SKILL_KEY: skill.value,
                    "result": result.model_dump(mode="json"),
                },
            )
        )

        logger.info(
            "voice task completed",
            extra={
                "a2a_task_id": context.task_id,
                "context_id": context.context_id,
                "skill": skill.value,
            },
        )

    async def cancel(self, context: RequestContext, event_queue: EventQueue) -> None:
        """A voice skill call is short. The long-running work it starts belongs
        to the reconciler, which a cancelled task must not stop."""
        updater = TaskUpdater(event_queue, context.task_id, context.context_id)
        await updater.cancel()


def _message_metadata(context: RequestContext) -> dict:
    message = context.message
    if message is None or not message.HasField("metadata"):
        return {}
    return MessageToDict(message.metadata)


def _parse_skill(value: object) -> VoiceSkill | None:
    try:
        return VoiceSkill(value)
    except ValueError:
        return None


def _summarize(skill: VoiceSkill, result: BaseModel) -> str:
    """A short readable line for the Orchestrator to quote.

    The full result travels as metadata, so this only has to be readable, not
    complete.
    """
    if skill is VoiceSkill.VOICE_SEARCH:
        if result.characters:
            return f"Found {len(result.characters)} characters."
        return f"Found {len(result.videos)} videos."
    if skill is VoiceSkill.VOICE_RUN:
        return f"Started run {result.id}, now {result.phase}."
    if skill is VoiceSkill.VOICE_STATUS:
        if result.run is not None:
            return f"Run {result.run.id} is {result.run.phase}."
        return f"Found {len(result.runs)} runs."
    return f"Run {result.id} is {result.phase}."
