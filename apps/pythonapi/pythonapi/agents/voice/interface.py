"""Interface contract for the Voice Agent.

This is the boundary Phase 3 builds behind: a standalone A2A service, reachable
at VOICE_AGENT_A2A_URL, that wraps the existing voice API and voice factory
(see _bmad-output/specs/spec-multi-agent-a2a/agent-contracts.md). It never
queries Qdrant, never owns RAG, and never becomes a second writer of
voice_runs.phase - VoiceRunReconciler stays the only writer.

The four skills below are the only way voice work is reached. There is no
model-driven tool path beside them. voice_review is the one skill the router
never selects from free text: approving a review stays a decision a person
makes in the browser. The skill exists so the Orchestrator can carry an
explicit approval through to the Voice Agent, not so a model can call it
unprompted.

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


class VoiceSearchSubject(StrEnum):
    """What a search asks for.

    Characters and videos are one skill because the question is the same one:
    what can I train on. Splitting them would add a skill that carries no new
    argument and no new failure mode.
    """

    VIDEOS = "videos"
    CHARACTERS = "characters"


class VoiceSearchRequest(BaseModel):
    """Find a source video to train on, or name the characters that exist.

    Downloads nothing. `query` is unused when the subject is characters, which
    the factory returns as a whole list.
    """

    query: str = ""
    limit: int = 10
    subject: VoiceSearchSubject = VoiceSearchSubject.VIDEOS


class VoiceSearchResult(BaseModel):
    videos: list[VideoResult] = []
    characters: list[str] = []


class VoiceRunSummary(BaseModel):
    """One row of a run listing.

    A summary, not the whole run. A full VoiceRun for every row would fill the
    reply with fields nobody asked for; naming a run then reads it in full.
    """

    id: str
    primary_character: str | None = None
    phase: str
    video_title: str | None = None
    error: str | None = None


class VoiceStatusRequest(BaseModel):
    """Read one run's state, or list the runs when no run is named.

    `run_id` is optional because "what is running" and "how is run 4f21" are
    the same question at two levels of detail.
    """

    run_id: str | None = None
    limit: int = 25


class VoiceStatusResult(BaseModel):
    """One run in full, or a listing when no run was named."""

    run: VoiceRun | None = None
    runs: list[VoiceRunSummary] = []


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
    dependencies routes/voice_runs.py already uses, so a skill call and a REST
    call cannot drift apart.
    """

    async def voice_search(self, request: VoiceSearchRequest) -> VoiceSearchResult: ...

    async def voice_run(self, request: VoiceRunRequest) -> VoiceRunResponse: ...

    async def voice_status(self, request: VoiceStatusRequest) -> VoiceStatusResult: ...

    async def voice_review(self, request: VoiceReviewRequest) -> VoiceRun: ...
