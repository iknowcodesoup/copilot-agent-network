"""Assemble the Voice Agent as a mountable A2A service.

Same shape as the Research Agent: one self-contained ASGI app, mounted inside
pythonapi by default or served alone on its own port.
"""

from __future__ import annotations

from fastapi import FastAPI

from pythonapi.a2a_support.service import build_a2a_service
from pythonapi.agents.voice.card import build_voice_agent_card
from pythonapi.agents.voice.executor import VoiceAgentExecutor
from pythonapi.agents.voice.pipeline_voice_agent import PipelineVoiceAgent
from pythonapi.config import settings


def build_voice_app(*, dependencies_provider) -> FastAPI:
    """Build the Voice Agent's A2A app."""
    agent = PipelineVoiceAgent(dependencies_provider)
    return build_a2a_service(
        agent_card=build_voice_agent_card(settings.voice_agent_public_url),
        executor=VoiceAgentExecutor(agent),
    )


def mount_voice_agent(parent_app: FastAPI) -> None:
    """Mount the Voice Agent inside pythonapi.

    The gateway and repository come from the parent's `app.state`, so the
    agent shares the connections `lifespan()` already built. It never opens
    its own, and it never becomes a second writer of run state.
    """
    parent_app.mount(
        settings.VOICE_AGENT_MOUNT_PATH,
        build_voice_app(dependencies_provider=lambda: parent_app.state),
    )
