"""Run the Orchestrator's `assist` skill as its own process.

`python -m pythonapi.agents.orchestrator` serves the skill alone, with its
card at the standard well-known path. It reuses pythonapi's `lifespan` so
`specialist_directory` is built by the one wiring path that already exists.
"""

from __future__ import annotations

import uvicorn
from fastapi import FastAPI

from pythonapi.agents.orchestrator.app import build_orchestrator_app
from pythonapi.config import settings
from pythonapi.main import lifespan


def build_standalone_app() -> FastAPI:
    app = FastAPI(lifespan=lifespan)
    app.mount("/", build_orchestrator_app(dependencies_provider=lambda: app.state))
    return app


if __name__ == "__main__":
    uvicorn.run(
        build_standalone_app(),
        host=settings.ORCHESTRATOR_AGENT_HOST,
        port=settings.ORCHESTRATOR_AGENT_PORT,
    )
