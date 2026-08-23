"""Assemble the Research Agent as a mountable A2A service.

`build_research_app` returns a self-contained ASGI app. `mount_research_agent`
attaches it to pythonapi under a prefix for single-process development, and
`__main__.py` serves the same app on its own port when the agent runs
standalone. The agent is identical either way - only its address changes.
"""

from __future__ import annotations

from fastapi import FastAPI

from pythonapi.a2a_support.service import build_a2a_service
from pythonapi.agents.research.card import build_research_agent_card
from pythonapi.agents.research.executor import ResearchAgentExecutor
from pythonapi.agents.research.rag_research_agent import RagResearchAgent
from pythonapi.config import settings


def build_research_app(*, dependencies_provider) -> FastAPI:
    """Build the Research Agent's A2A app.

    `dependencies_provider` is called per request and returns the RAG
    dependencies (see `RagResearchAgent`), so this can be built before
    `lifespan()` has populated them.
    """
    agent = RagResearchAgent(dependencies_provider)
    return build_a2a_service(
        agent_card=build_research_agent_card(settings.research_agent_public_url),
        executor=ResearchAgentExecutor(agent),
    )


def mount_research_agent(parent_app: FastAPI) -> None:
    """Mount the Research Agent inside pythonapi.

    The provider closes over the parent's `app.state`, which is where
    `lifespan()` builds the RAG clients once. The mounted agent therefore
    shares the parent's Qdrant and Postgres connections rather than opening a
    second set of its own.
    """
    parent_app.mount(
        settings.RESEARCH_AGENT_MOUNT_PATH,
        build_research_app(dependencies_provider=lambda: parent_app.state),
    )
