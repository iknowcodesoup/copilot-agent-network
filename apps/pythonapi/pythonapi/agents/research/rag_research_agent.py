"""The `research` skill, implemented over the existing RagPipeline.

This is the whole of the Research Agent's domain logic: take a question,
run the pipeline the /search route already runs, and shape the result into
the answer-plus-sources contract in `interface.py`. It holds no transport
concern - `executor.py` owns A2A - which is what lets a test exercise the
skill without a server.

The pipeline dependencies are resolved per call rather than captured in the
constructor. The agent is built while routes are being registered, and
`lifespan()` does not populate `app.state` until after that, so binding them
at construction would capture whatever was there at import time - nothing.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Protocol

from cachetools import LRUCache

from pythonapi.agents.research.interface import (
    ResearchAnswer,
    ResearchQuestion,
    ResearchSource,
)
from pythonapi.config import settings
from pythonapi.core.embeddings import EmbeddingClient
from pythonapi.core.generation import AnswerGenerator
from pythonapi.core.pii import PiiMasker
from pythonapi.core.rag_pipeline import search_and_generate
from pythonapi.core.reranking import Reranker
from pythonapi.repositories.base import DocumentRepository
from pythonapi.repositories.qdrant import QdrantEmbeddingIndex

# What the corpus returns when it holds nothing relevant. The spec requires a
# clear no-results answer rather than a failed task, so this is a normal
# result: the caller sees an empty `sources` list and this text.
NO_RESULTS_ANSWER = "The documentation corpus has no content relevant to that question."


class RagDependencies(Protocol):
    """The slice of `app.state` the research skill reads.

    Spelled out as a Protocol so the dependency set is visible at this
    boundary and a test can satisfy it with a simple stub, instead of every
    caller passing the real `app.state` around as an untyped object.
    """

    document_repository: DocumentRepository
    embedding_index: QdrantEmbeddingIndex
    embedding_client: EmbeddingClient
    reranker: Reranker
    pii_masker: PiiMasker | None
    answer_generator: AnswerGenerator
    search_cache: LRUCache


class RagResearchAgent:
    """Answers research questions from the indexed document corpus."""

    def __init__(self, dependencies_provider: Callable[[], RagDependencies]) -> None:
        self._dependencies_provider = dependencies_provider

    async def research(self, request: ResearchQuestion) -> ResearchAnswer:
        dependencies = self._dependencies_provider()
        response = await search_and_generate(
            repository=dependencies.document_repository,
            embedding_index=dependencies.embedding_index,
            embedding_client=dependencies.embedding_client,
            reranker=dependencies.reranker,
            pii_masker=dependencies.pii_masker,
            answer_generator=dependencies.answer_generator,
            cache=dependencies.search_cache,
            query=request.question,
            top_k=settings.RESEARCH_AGENT_TOP_K,
            prefetch_limit=max(
                settings.RESEARCH_AGENT_TOP_K, settings.RETRIEVAL_PREFETCH_LIMIT
            ),
        )

        # Two ways the corpus can come up empty: retrieval found no chunks,
        # or it found some and the generator judged them not to answer the
        # question. Both are a no-results answer, not a failed task.
        if not response.results or not response.answer.is_answerable:
            return ResearchAnswer(answer=NO_RESULTS_ANSWER, sources=[])

        return ResearchAnswer(
            answer=response.answer.answer,
            sources=[
                ResearchSource(
                    document_id=result.document_id,
                    title=result.document_title,
                )
                for result in _unique_by_document(response.results)
            ],
        )


def _unique_by_document(results):
    """One citation per document, in rank order.

    The pipeline returns chunks, and several chunks of one document is the
    normal case for a good match. A caller wants the document cited once.
    """
    seen: set[str] = set()
    for result in results:
        if result.document_id in seen:
            continue
        seen.add(result.document_id)
        yield result
