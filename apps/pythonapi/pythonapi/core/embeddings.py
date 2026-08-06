import asyncio
import hashlib
import math
import random
import re
from typing import TYPE_CHECKING, Literal

from tenacity import (
    AsyncRetrying,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential_jitter,
)

from pythonapi.models.documents import SparseVectorPayload

if TYPE_CHECKING:
    from fastembed import SparseTextEmbedding
    from openai import AsyncOpenAI


class EmbeddingAPIError(Exception):
    """Raised when the (simulated or real) embedding provider fails."""


def embed_text(text: str, dim: int) -> list[float]:
    """Deterministic mock dense embedding via the hashing trick (feature
    hashing).

    Same text always maps to the same vector, and overlapping vocabulary
    between two texts produces non-trivial cosine similarity - good enough
    to demo real vector search without calling an actual model.
    """
    vector = [0.0] * dim
    tokens = re.findall(r"[a-z0-9]+", text.lower())
    for token in tokens:
        digest = int(hashlib.sha256(token.encode()).hexdigest(), 16)
        index = digest % dim
        sign = 1.0 if (digest // dim) % 2 == 0 else -1.0
        vector[index] += sign

    norm = math.sqrt(sum(v * v for v in vector))
    if norm > 0:
        vector = [v / norm for v in vector]
    return vector


def sparse_embed_text(text: str, vocab_size: int = 2**18) -> SparseVectorPayload:
    """Deterministic mock sparse embedding (hashed term frequency) - the
    sparse analog of embed_text's dense mock, so the hybrid RRF search path
    is genuinely exercised offline in tests, not silently degraded to
    dense-only.
    """
    counts: dict[int, float] = {}
    for token in re.findall(r"[a-z0-9]+", text.lower()):
        index = int(hashlib.sha256(token.encode()).hexdigest(), 16) % vocab_size
        counts[index] = counts.get(index, 0.0) + 1.0
    indices = sorted(counts)
    return SparseVectorPayload(indices=indices, values=[counts[i] for i in indices])


class EmbeddingClient:
    """Dense+sparse embedding provider. "mock" (default) simulates a flaky
    remote API and never touches the network, so tests stay offline;
    "openai_compatible" calls an OpenAI-compatible gateway (LiteLLM by
    default) for dense vectors (via AsyncOpenAI) and fastembed in-process
    for sparse vectors. embed()'s signature/retry behavior is unchanged
    from the original mock-only implementation.
    """

    def __init__(
        self,
        dim: int,
        failure_rate: float = 0.0,
        max_retries: int = 3,
        base_delay: float = 0.05,
        max_delay: float = 1.0,
        provider: Literal["mock", "openai_compatible"] = "mock",
        openai_client: "AsyncOpenAI | None" = None,
        embedding_model: str = "",
        sparse_model: "SparseTextEmbedding | None" = None,
    ) -> None:
        self.dim = dim
        self.failure_rate = failure_rate
        self.provider = provider
        self._openai_client = openai_client
        self._embedding_model = embedding_model
        self._sparse_model = sparse_model
        self._retrying = AsyncRetrying(
            stop=stop_after_attempt(max_retries),
            wait=wait_exponential_jitter(initial=base_delay, max=max_delay),
            retry=retry_if_exception_type(EmbeddingAPIError),
            reraise=True,
        )

    async def _call_provider(self, text: str) -> list[float]:
        if self.provider == "mock":
            await asyncio.sleep(0.001)  # simulated network latency
            if random.random() < self.failure_rate:
                raise EmbeddingAPIError("embedding provider timed out")
            return embed_text(text, self.dim)
        try:
            response = await self._openai_client.embeddings.create(
                model=self._embedding_model, input=text
            )
        except Exception as exc:
            raise EmbeddingAPIError(str(exc)) from exc
        return response.data[0].embedding

    async def embed(self, text: str) -> list[float]:
        return await self._retrying(self._call_provider, text)

    async def embed_sparse(self, text: str) -> SparseVectorPayload:
        """Not retried through the dense tenacity policy - fastembed runs
        fully local, so there's no network flakiness to retry against."""
        if self.provider == "mock" or self._sparse_model is None:
            return sparse_embed_text(text)
        embeddings = await asyncio.to_thread(
            lambda: list(self._sparse_model.embed([text]))
        )
        result = embeddings[0]
        return SparseVectorPayload(
            indices=result.indices.tolist(), values=result.values.tolist()
        )
