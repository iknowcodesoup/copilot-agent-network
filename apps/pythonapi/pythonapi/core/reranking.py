"""Cross-encoder reranking of retrieved candidates.

Two providers behind a Protocol (mirroring DocumentRepository's Postgres/
InMemory split, since the mock/real paths share essentially no state or
logic): LexicalOverlapReranker is the default (RERANK_PROVIDER=mock) so
pytest never downloads or loads a real HF model via the lifespan-run
TestClient fixture; CrossEncoderReranker is the real sentence-transformers
model, only constructed when RERANK_PROVIDER=cross_encoder.
"""

import asyncio
import re
from typing import TYPE_CHECKING, Protocol

if TYPE_CHECKING:
    from sentence_transformers import CrossEncoder


class Reranker(Protocol):
    async def rerank(self, query: str, candidates: list[str]) -> list[float]: ...


class CrossEncoderReranker:
    def __init__(self, model_name: str) -> None:
        from sentence_transformers import CrossEncoder as _CrossEncoder

        self._model: CrossEncoder = _CrossEncoder(model_name)

    async def rerank(self, query: str, candidates: list[str]) -> list[float]:
        if not candidates:
            return []
        pairs = [(query, candidate) for candidate in candidates]
        scores = await asyncio.to_thread(self._model.predict, pairs)
        return [float(score) for score in scores]


class LexicalOverlapReranker:
    """Deterministic, offline stand-in for CrossEncoderReranker: scores by
    query/candidate token overlap."""

    async def rerank(self, query: str, candidates: list[str]) -> list[float]:
        query_tokens = set(re.findall(r"[a-z0-9]+", query.lower()))
        return [
            float(len(query_tokens & set(re.findall(r"[a-z0-9]+", candidate.lower()))))
            for candidate in candidates
        ]
