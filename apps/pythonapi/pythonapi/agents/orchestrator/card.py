"""The Orchestrator's published identity, for its own `assist` skill.

Separate from `agents/orchestrator/chat_agent.py`, which speaks AG-UI to the
browser. This card is what makes the Orchestrator itself a discoverable ARD
entry with an honest `application/a2a-agent-card+json` type: the type is
only true because this module - and the A2A app it is served from - actually
exist.
"""

from __future__ import annotations

from a2a.types import AgentCard, AgentSkill

from pythonapi.a2a_support.cards import build_agent_card

ORCHESTRATOR_SKILL_ID = "assist"

AGENT_NAME = "Orchestrator Agent"
AGENT_DESCRIPTION = (
    "Routes a request to the Research Agent, the Voice Agent, or both, and "
    "combines what they find into one answer. Answers a general request "
    "directly when no specialist applies."
)


def build_orchestrator_agent_card(url: str) -> AgentCard:
    """Build the Orchestrator's card for a service reachable at `url`."""
    return build_agent_card(
        name=AGENT_NAME,
        description=AGENT_DESCRIPTION,
        url=url,
        skills=[
            AgentSkill(
                id=ORCHESTRATOR_SKILL_ID,
                name="Assist",
                description=(
                    "Delegate to the Research and/or Voice specialists as "
                    "the request needs, or answer directly for a general "
                    "question."
                ),
                tags=["orchestrator", "delegation", "assist"],
                examples=[
                    "Why is this voice training run taking so long?",
                    "Find Star Trek interview videos with Patrick Stewart.",
                    "What does the troubleshooting guide say about diarization?",
                ],
            )
        ],
    )
