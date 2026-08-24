"""The `assist` skill, implemented over the existing delegation logic.

Reuses `specialist_router.route_request` - the same function the AG-UI chat
agent calls for the browser. A `research`, `voice`, or `research_and_voice`
request is answered by delegating to the specialists. A `general` request has
no specialist to delegate to, so it gets one plain, non-streaming completion
from the model gateway instead - `assist` has no browser tools to offer and
no token stream to render, so the AG-UI machinery in `chat_agent.py` would be
pure overhead here.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Protocol

from openai import AsyncOpenAI

from pythonapi.a2a_support.discovery import SpecialistDirectory
from pythonapi.agents.orchestrator.interface import (
    OrchestratorAnswer,
    OrchestratorRequest,
)
from pythonapi.agents.orchestrator.specialist_router import route_request
from pythonapi.config import settings


class OrchestratorDependencies(Protocol):
    """The slice of `app.state` the `assist` skill reads."""

    specialist_directory: SpecialistDirectory | None


class DelegatingOrchestratorAgent:
    """Answers one request the same way the AG-UI chat agent would."""

    def __init__(
        self, dependencies_provider: Callable[[], OrchestratorDependencies]
    ) -> None:
        self._dependencies_provider = dependencies_provider

    async def assist(self, request: OrchestratorRequest) -> OrchestratorAnswer:
        directory = self._dependencies_provider().specialist_directory
        delegated = (
            await route_request(directory, request.text)
            if directory is not None
            else None
        )
        if delegated is not None:
            return OrchestratorAnswer(answer=delegated)
        return OrchestratorAnswer(answer=await self._answer_directly(request.text))

    async def _answer_directly(self, text: str) -> str:
        """A general request, answered with no specialist and no tools."""
        client = AsyncOpenAI(
            base_url=settings.LLM_BASE_URL, api_key=settings.gateway_api_key
        )
        try:
            completion = await client.chat.completions.create(
                model=settings.LLM_MODEL,
                messages=[{"role": "user", "content": text}],
            )
        finally:
            await client.close()
        return completion.choices[0].message.content or ""
