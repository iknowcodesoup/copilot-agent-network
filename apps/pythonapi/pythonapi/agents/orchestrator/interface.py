"""Interface contract for the Orchestrator's own `assist` skill.

The Orchestrator's front door is AG-UI, for the browser (see
`agents/orchestrator/chat_agent.py`). This is its second, separate door: a
real A2A skill another agent or tool can delegate into, publishing the same
delegation logic over a standard agent-to-agent protocol instead of a
browser-streaming one. Both call `specialist_router.route_request`; neither
wraps the other.
"""

from __future__ import annotations

from typing import Protocol

from pydantic import BaseModel


class OrchestratorRequest(BaseModel):
    """One request delegated to the Orchestrator's `assist` skill."""

    text: str


class OrchestratorAnswer(BaseModel):
    """What the Orchestrator returns for one request.

    One combined answer, exactly like the AG-UI reply the browser gets for
    the same text - `assist` is a second address for the same behavior, not
    a different one.
    """

    answer: str


class OrchestratorAgentInterface(Protocol):
    """What the `assist` skill must do, independent of transport."""

    async def assist(self, request: OrchestratorRequest) -> OrchestratorAnswer: ...
