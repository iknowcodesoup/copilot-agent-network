"""Run the Voice Agent as its own process.

`python -m pythonapi.agents.voice` serves the agent alone. It reuses
pythonapi's `lifespan` so the gateway, repository, and reconciler are built by
the one wiring path that already exists.
"""

from __future__ import annotations

import uvicorn
from fastapi import FastAPI

from pythonapi.agents.voice.app import build_voice_app
from pythonapi.config import settings
from pythonapi.main import lifespan


def build_standalone_app() -> FastAPI:
    app = FastAPI(lifespan=lifespan)
    app.mount("/", build_voice_app(dependencies_provider=lambda: app.state))
    return app


if __name__ == "__main__":
    uvicorn.run(
        build_standalone_app(),
        host=settings.VOICE_AGENT_HOST,
        port=settings.VOICE_AGENT_PORT,
    )
