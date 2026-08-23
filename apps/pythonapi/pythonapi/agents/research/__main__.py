"""Run the Research Agent as its own process.

`python -m pythonapi.agents.research` serves the agent alone, with its card at
the standard well-known path and no pythonapi routes attached. It reuses
pythonapi's `lifespan` so the RAG clients are built by the one wiring path
that already exists, rather than a second copy that would drift from it.
"""

from __future__ import annotations

import uvicorn
from fastapi import FastAPI

from pythonapi.agents.research.app import build_research_app
from pythonapi.config import settings
from pythonapi.main import lifespan


def build_standalone_app() -> FastAPI:
    app = FastAPI(lifespan=lifespan)
    app.mount("/", build_research_app(dependencies_provider=lambda: app.state))
    return app


if __name__ == "__main__":
    uvicorn.run(
        build_standalone_app(),
        host=settings.RESEARCH_AGENT_HOST,
        port=settings.RESEARCH_AGENT_PORT,
    )
