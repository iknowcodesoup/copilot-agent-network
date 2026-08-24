"""Assemble the Orchestrator's `assist` skill as a mountable A2A service.

Same shape as `agents/research/app.py` and `agents/voice/app.py`: a
self-contained ASGI app, mounted inside pythonapi by default or served alone
on its own port. This is a second protocol surface for the Orchestrator, not
a replacement for `/api/agent` - the browser keeps talking AG-UI; this is
what a delegating agent or tool talks A2A to instead.
"""

from __future__ import annotations

from fastapi import FastAPI

from pythonapi.a2a_support.service import build_a2a_service
from pythonapi.agents.orchestrator.card import build_orchestrator_agent_card
from pythonapi.agents.orchestrator.delegating_agent import DelegatingOrchestratorAgent
from pythonapi.agents.orchestrator.executor import OrchestratorAgentExecutor
from pythonapi.config import settings


def build_orchestrator_app(*, dependencies_provider) -> FastAPI:
    """Build the Orchestrator's `assist` A2A app.

    `dependencies_provider` is called per request and returns the specialist
    directory (see `DelegatingOrchestratorAgent`), so this can be built
    before `lifespan()` has populated it.
    """
    agent = DelegatingOrchestratorAgent(dependencies_provider)
    return build_a2a_service(
        agent_card=build_orchestrator_agent_card(settings.orchestrator_agent_public_url),
        executor=OrchestratorAgentExecutor(agent),
    )


def mount_orchestrator_agent(parent_app: FastAPI) -> None:
    """Mount the Orchestrator's `assist` skill inside pythonapi.

    The provider closes over the parent's `app.state`, which is where
    `lifespan()` builds `specialist_directory`. The mounted skill therefore
    delegates through the same directory the AG-UI chat agent uses, rather
    than resolving the specialists a second time.
    """
    parent_app.mount(
        settings.ORCHESTRATOR_AGENT_MOUNT_PATH,
        build_orchestrator_app(dependencies_provider=lambda: parent_app.state),
    )
