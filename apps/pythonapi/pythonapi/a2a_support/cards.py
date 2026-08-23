"""Agent Card construction, shared by both specialist agents.

One builder so the two cards cannot drift on the fields the spec requires
every card to declare: name, description, service URL, protocol version,
capabilities, skills, and input/output modes (agent-contracts.md § Agent
Card). The SDK's types are protobuf messages, so the card is built by
keyword, never parsed from hand-written JSON - a hand-rolled dict is exactly
the "custom JSON presented as A2A" the spec forbids.
"""

from __future__ import annotations

from a2a.types import AgentCapabilities, AgentCard, AgentInterface, AgentSkill
from a2a.utils.constants import PROTOCOL_VERSION_CURRENT, TransportProtocol

# Both specialists speak text in and text out. The Orchestrator sends a
# question and reads back an answer; structured payloads ride in the message
# metadata, not in a separate mode.
TEXT_MEDIA_TYPE = "text/plain"

# Card `version` is this deployment's version of the agent, not the protocol
# version - that is AgentInterface.protocol_version. Both are required.
AGENT_VERSION = "1.0.0"


def build_agent_card(
    *,
    name: str,
    description: str,
    url: str,
    skills: list[AgentSkill],
) -> AgentCard:
    """Build one specialist's Agent Card.

    Streaming and push notifications are both off. The spec allows streaming
    only where it reduces implementation complexity, and here it would add a
    second code path for no gain: a research answer and a voice status are
    each one result, not a token feed. Push notifications are ruled out for
    the first version outright.
    """
    return AgentCard(
        name=name,
        description=description,
        version=AGENT_VERSION,
        supported_interfaces=[
            AgentInterface(
                url=url,
                protocol_binding=TransportProtocol.JSONRPC.value,
                protocol_version=PROTOCOL_VERSION_CURRENT,
            )
        ],
        capabilities=AgentCapabilities(
            streaming=False,
            push_notifications=False,
        ),
        default_input_modes=[TEXT_MEDIA_TYPE],
        default_output_modes=[TEXT_MEDIA_TYPE],
        skills=skills,
    )
