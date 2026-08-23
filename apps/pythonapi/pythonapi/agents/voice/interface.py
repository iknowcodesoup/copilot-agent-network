"""Interface contract for the Voice Agent.

This is the boundary Phase 3 builds behind: a standalone A2A service, reachable
at VOICE_AGENT_A2A_URL, that wraps the existing voice API and voice factory
(see _bmad-output/specs/spec-multi-agent-a2a/agent-contracts.md). It never
queries Qdrant, never owns RAG, and never becomes a second writer of
voice_runs.phase - VoiceRunReconciler stays the only writer.

The four skills below replace core/voice_agent_tools.py's model-driven tool
calls for everything routed through the Orchestrator as `voice`. One
exception: voice_review is reachable here even though the current
VoiceToolRegistry deliberately omits an approve-review tool - approving a
review stays a decision a person makes in the browser, not one the model
reaches for on its own. The skill exists for the Orchestrator to carry an
explicit user approval through to the Voice Agent, not for a model to call it
unprompted; Phase 4's routing must preserve that distinction.

Defined here, ahead of that service existing, so the Orchestrator's routing
work (Phase 4) and the Voice Agent's own build (Phase 3) share one
request/response shape instead of drifting from independent guesses. Phase 3
moves this module into the new voice-agent app as that service is built.
"""

from __future__ import annotations

from enum import StrEnum
from typing import Protocol

from pydantic import BaseModel

from pythonapi.models.voice_run import (
    SpeakerAssignmentRequest,
    VideoResult,
    VoiceRun,
    VoiceRunRequest,
    VoiceRunResponse,
)


class VoiceSkill(StrEnum):
    """The four skills agent-contracts.md assigns the Voice Agent."""

    VOICE_SEARCH = "voice_search"
    VOICE_RUN = "voice_run"
    VOICE_STATUS = "voice_status"
    VOICE_REVIEW = "voice_review"


class VoiceSearchRequest(BaseModel):
    """Find a source video to train on. Downloads nothing.

    Mirrors core/voice_agent_tools.py's search_voice_videos tool.
    """

    query: str
    limit: int = 10


class VoiceSearchResult(BaseModel):
    videos: list[VideoResult]


class VoiceStatusRequest(BaseModel):
    """Read one run's current phase and progress."""

    run_id: str


class VoiceReviewRequest(BaseModel):
    """Approve a run's clip review and start training.

    run_id plus the existing approve-run payload - see
    routes/voice_runs.py's approve_run, which this skill wraps rather than
    duplicates.
    """

    run_id: str
    assignment: SpeakerAssignmentRequest


class VoiceAgentInterface(Protocol):
    """What the Voice Agent's four skills must do, independent of transport.

    The real implementation (Phase 3) wraps this in A2A task handling and
    calls the existing VoiceFactoryGateway/VoiceRunRepository - the same
    dependencies core/voice_agent_tools.py and routes/voice_runs.py already
    share, so a skill call and a REST call cannot drift apart.
    """

    async def voice_search(self, request: VoiceSearchRequest) -> VoiceSearchResult: ...

    async def voice_run(self, request: VoiceRunRequest) -> VoiceRunResponse: ...

    async def voice_status(self, request: VoiceStatusRequest) -> VoiceRun: ...

    async def voice_review(self, request: VoiceReviewRequest) -> VoiceRun: ...
