"""Route one user request to the specialists and combine what comes back.

This is the Orchestrator's delegation layer. It classifies the request, asks
whichever specialists apply, and returns one piece of text for the chat agent
to speak. It never retrieves documents itself and never touches the voice
factory - that is the whole point of the boundary.

`research_and_voice` is the reference demonstration: ask why a run is slow,
and the answer must combine the Voice Agent's run data with the Research
Agent's troubleshooting content. That case is why A2A is here at all.
"""

from __future__ import annotations

import logging
import re

from pythonapi.a2a_support.delegation import DelegatedResult, delegate
from pythonapi.a2a_support.discovery import Specialist, SpecialistDirectory
from pythonapi.agents.orchestrator.routing import RoutingCategory, classify
from pythonapi.agents.research.card import RESEARCH_SKILL_ID
from pythonapi.agents.voice.interface import VoiceSkill

logger = logging.getLogger(__name__)

# A run id is a uuid4 hex, so it is unambiguous in free text.
RUN_ID = re.compile(r"\b[0-9a-f]{32}\b")

# Words that ask for a video to train on rather than for run state.
SEARCH_TERMS = frozenset({"video", "videos", "find", "search", "footage"})

# Words that ask which characters exist rather than for a video.
CHARACTER_TERMS = frozenset({"character", "characters", "voice", "voices"})

# Words that ask for a run to begin. Starting a run changes state, so it needs
# an explicit instruction, never a bare mention of a video.
START_TERMS = frozenset({"start", "begin", "launch", "create"})

_WORD = re.compile(r"[a-z]+")


async def route_request(
    directory: SpecialistDirectory, request_text: str
) -> str | None:
    """Delegate a request and return the combined answer.

    Returns None for a general request, which means the Orchestrator should
    answer it itself rather than involve a specialist.
    """
    category = classify(request_text)
    logger.info(
        "orchestrator routed a request",
        extra={"decision": category.value},
    )

    if category is RoutingCategory.GENERAL:
        return None
    if category is RoutingCategory.RESEARCH:
        return (await _ask_research(directory, request_text)).text
    if category is RoutingCategory.VOICE:
        return (await _ask_voice(directory, request_text)).text
    return await _diagnose(directory, request_text)


async def _ask_research(
    directory: SpecialistDirectory, request_text: str
) -> DelegatedResult:
    return await delegate(
        directory,
        Specialist.RESEARCH,
        skill=RESEARCH_SKILL_ID,
        text=request_text,
    )


async def _ask_voice(
    directory: SpecialistDirectory, request_text: str
) -> DelegatedResult:
    """Ask the Voice Agent, picking the skill the request actually asks for.

    Naming a run reads that run. Asking to start one starts it. Asking for
    videos searches, asking for characters lists them. Anything else lists the
    runs, because "what is running" is the question left when nothing is
    named.

    Approving a review stays unreachable from free text. That is the one
    transition the spec keeps with a person, so it remains a browser action
    rather than something the router can trigger by wording.
    """
    words = set(_WORD.findall(request_text.lower()))

    run_id = RUN_ID.search(request_text)
    if run_id is not None:
        return await delegate(
            directory,
            Specialist.VOICE,
            skill=VoiceSkill.VOICE_STATUS.value,
            text=request_text,
            arguments={"run_id": run_id.group()},
        )

    if words & START_TERMS:
        return await delegate(
            directory,
            Specialist.VOICE,
            skill=VoiceSkill.VOICE_RUN.value,
            text=request_text,
        )

    if words & SEARCH_TERMS:
        return await delegate(
            directory,
            Specialist.VOICE,
            skill=VoiceSkill.VOICE_SEARCH.value,
            text=request_text,
            arguments={"query": request_text, "subject": "videos"},
        )

    if words & CHARACTER_TERMS:
        return await delegate(
            directory,
            Specialist.VOICE,
            skill=VoiceSkill.VOICE_SEARCH.value,
            text=request_text,
            arguments={"subject": "characters"},
        )

    return await delegate(
        directory,
        Specialist.VOICE,
        skill=VoiceSkill.VOICE_STATUS.value,
        text=request_text,
    )


async def _diagnose(directory: SpecialistDirectory, request_text: str) -> str:
    """The reference workflow: combine run state with troubleshooting docs.

    The two calls are deliberately independent. If one specialist is down the
    other's answer still reaches the user, which is what CAP-5 requires.
    """
    voice_result = await _ask_voice(directory, request_text)
    research_result = await _ask_research(directory, request_text)

    return _combine(voice_result, research_result)


def _combine(voice_result: DelegatedResult, research_result: DelegatedResult) -> str:
    """Turn two specialist answers into one reply.

    A failed specialist becomes a short note rather than an error, so a
    partial answer still reaches the user.
    """
    parts: list[str] = []

    if voice_result.succeeded:
        parts.append(f"Run state: {voice_result.text}")
    else:
        parts.append(f"I could not read the run state. {voice_result.text}")

    if research_result.succeeded:
        parts.append(f"What the documentation says: {research_result.text}")
    else:
        parts.append(f"I could not reach the documentation. {research_result.text}")

    return "\n\n".join(parts)
