"""The Research Agent's published identity.

Built here rather than inline in the app so a test can assert the card's
contents without starting a server, and so the Orchestrator's discovery test
has one place to check its expectations against.
"""

from __future__ import annotations

from a2a.types import AgentCard, AgentSkill

from pythonapi.a2a_support.cards import build_agent_card

RESEARCH_SKILL_ID = "research"

AGENT_NAME = "Research Agent"
AGENT_DESCRIPTION = (
    "Answers questions about the project's documentation using retrieval over "
    "the indexed corpus. Returns an answer with the sources it drew on."
)


def build_research_agent_card(url: str) -> AgentCard:
    """Build the Research Agent's card for a service reachable at `url`."""
    return build_agent_card(
        name=AGENT_NAME,
        description=AGENT_DESCRIPTION,
        url=url,
        skills=[
            AgentSkill(
                id=RESEARCH_SKILL_ID,
                name="Research",
                description=(
                    "Answer a question from the project documentation corpus "
                    "and cite the documents the answer came from."
                ),
                tags=["research", "documentation", "retrieval", "rag"],
                examples=[
                    "Research the repository documentation for the "
                    "requirements for voice training.",
                    "What does the troubleshooting guide say about a slow "
                    "training run?",
                ],
            )
        ],
    )
