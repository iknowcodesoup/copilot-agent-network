"""The Voice Agent's published identity.

Four skills, one card. The Orchestrator reads the skill ids from here at
discovery time rather than carrying its own copy of the list.
"""

from __future__ import annotations

from a2a.types import AgentCard, AgentSkill

from pythonapi.a2a_support.cards import build_agent_card
from pythonapi.agents.voice.interface import VoiceSkill

AGENT_NAME = "Voice Agent"
AGENT_DESCRIPTION = (
    "Drives the voice training pipeline. Finds source videos, starts runs, "
    "reports run and training state, and carries a human review decision "
    "through to the factory."
)

_SKILLS = [
    AgentSkill(
        id=VoiceSkill.VOICE_SEARCH.value,
        name="Search videos",
        description="Find a source video to train on. Downloads nothing.",
        tags=["voice", "search", "video"],
        examples=["Find Star Trek interview videos with Patrick Stewart."],
    ),
    AgentSkill(
        id=VoiceSkill.VOICE_RUN.value,
        name="Start a run",
        description="Start an ingest run against one video.",
        tags=["voice", "run", "ingest"],
        examples=["Start a run for this video and assign it to Picard."],
    ),
    AgentSkill(
        id=VoiceSkill.VOICE_STATUS.value,
        name="Run status",
        description="Report one run's phase and training progress.",
        tags=["voice", "status", "progress"],
        examples=["What phase is run 4f21 in?", "Why is my training run slow?"],
    ),
    AgentSkill(
        id=VoiceSkill.VOICE_REVIEW.value,
        name="Approve a review",
        description=(
            "Carry a person's approval of a clip review through to the "
            "factory, and start training."
        ),
        tags=["voice", "review", "approval"],
        examples=["Approve the review for run 4f21 and map speaker 0 to Picard."],
    ),
]


def build_voice_agent_card(url: str) -> AgentCard:
    """Build the Voice Agent's card for a service reachable at `url`."""
    return build_agent_card(
        name=AGENT_NAME,
        description=AGENT_DESCRIPTION,
        url=url,
        skills=list(_SKILLS),
    )
