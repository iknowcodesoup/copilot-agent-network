"""Classify one user request into a routing category.

Deterministic rules first, per agent-contracts.md. An LLM router is the
fallback for what the rules cannot classify safely, not the default: routing
must be predictable and cheap, and most requests here are plainly about one
side or the other.

The rules match on intent words, never on a specialist's skill list. Skills
come from the Agent Cards at delegation time, so adding a skill to an agent
does not mean editing this file.
"""

from __future__ import annotations

import re
from enum import StrEnum


class RoutingCategory(StrEnum):
    """The four categories agent-contracts.md defines."""

    RESEARCH = "research"
    VOICE = "voice"
    RESEARCH_AND_VOICE = "research_and_voice"
    GENERAL = "general"


# Words that put a request on the voice side. These name the pipeline's own
# vocabulary, so a match is a strong signal rather than a guess.
VOICE_TERMS = frozenset(
    {
        "voice",
        "voices",
        "run",
        "runs",
        "training",
        "train",
        "diarize",
        "diarization",
        "speaker",
        "speakers",
        "clip",
        "clips",
        "review",
        "video",
        "videos",
        "piper",
        "character",
        "checkpoint",
        "ingest",
    }
)

# Words that ask for an explanation rather than an action. "Why is my run
# slow" is the reference case: it names a run, so it is voice work, but "why"
# also asks for knowledge, which makes it both.
RESEARCH_TERMS = frozenset(
    {
        "why",
        "how",
        "what",
        "explain",
        "documentation",
        "docs",
        "guide",
        "requirements",
        "troubleshoot",
        "troubleshooting",
        "mean",
        "means",
        "difference",
        "recommend",
        "should",
    }
)

# Asking for a thing to happen, rather than for an explanation of it. A
# request that gives an instruction is voice work even when it also asks
# "how" - "how do I start a run" explains, "start a run" acts.
ACTION_TERMS = frozenset(
    {
        "start",
        "stop",
        "cancel",
        "approve",
        "retry",
        "delete",
        "assign",
        "commit",
        "search",
        "find",
        "list",
        "show",
    }
)

_WORD = re.compile(r"[a-z]+")


def classify(request_text: str) -> RoutingCategory:
    """Pick the category for one request.

    Returns GENERAL when no rule matches, which is the safe default: the
    Orchestrator answers those itself rather than guessing a specialist.
    """
    words = set(_WORD.findall(request_text.lower()))

    is_voice = bool(words & VOICE_TERMS)
    asks_for_knowledge = bool(words & RESEARCH_TERMS)
    asks_for_action = bool(words & ACTION_TERMS)

    if is_voice and asks_for_knowledge and not asks_for_action:
        # The reference case: a question about voice work needs the run data
        # and the documentation together.
        return RoutingCategory.RESEARCH_AND_VOICE
    if is_voice:
        return RoutingCategory.VOICE
    if asks_for_knowledge:
        return RoutingCategory.RESEARCH
    return RoutingCategory.GENERAL
