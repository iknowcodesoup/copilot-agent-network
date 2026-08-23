"""Interface contract for the Research Agent.

This is the boundary Phase 2 builds behind: a standalone A2A service, reachable
at RESEARCH_AGENT_A2A_URL, that owns the `research` skill (see
_bmad-output/specs/spec-multi-agent-a2a/agent-contracts.md). It answers
questions using the existing RagPipeline and never touches voice run state.

Defined here, ahead of that service existing, so the Orchestrator's routing
work (Phase 4) and the Research Agent's own build (Phase 2) share one
request/response shape instead of drifting from independent guesses. Phase 2
moves this module into the new research-agent app as that service is built.
"""

from __future__ import annotations

from typing import Protocol

from pydantic import BaseModel


class ResearchQuestion(BaseModel):
    """One research request, as delegated by the Orchestrator."""

    question: str


class ResearchSource(BaseModel):
    """One document a research answer drew on.

    Mirrors SearchResultItem's identity fields (document_id, title) without
    its retrieval-internal ones (chunk_index, score) - a delegating caller
    gets a citation, not a debugging trace.
    """

    document_id: str
    title: str


class ResearchAnswer(BaseModel):
    """What the Research Agent returns for one question.

    sources is empty exactly when the corpus had no relevant content - the
    Research Agent MUST still answer in that case (agent-contracts.md), not
    fail the task, so an empty list rather than a null/omitted field is what
    a caller checks for "no results".
    """

    answer: str
    sources: list[ResearchSource]


class ResearchAgentInterface(Protocol):
    """What the Research Agent skill must do, independent of transport.

    The real implementation (Phase 2) wraps this in A2A task handling and
    calls pythonapi.core.rag_pipeline.search_and_generate; this Protocol is
    the seam a test can implement without either.
    """

    async def research(self, request: ResearchQuestion) -> ResearchAnswer: ...
