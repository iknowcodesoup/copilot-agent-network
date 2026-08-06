import asyncio
import hashlib
import math
import random
import re

from tenacity import (
    AsyncRetrying,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential_jitter,
)


class EmbeddingAPIError(Exception):
    """Raised when the (simulated) embedding provider fails."""


def embed_text(text: str, dim: int) -> list[float]:
    """Deterministic mock embedding via the hashing trick (feature hashing).

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


class EmbeddingClient:
    """Simulates a flaky remote embedding API, retried with backoff+jitter."""

    def __init__(
        self,
        dim: int,
        failure_rate: float = 0.0,
        max_retries: int = 3,
        base_delay: float = 0.05,
        max_delay: float = 1.0,
    ) -> None:
        self.dim = dim
        self.failure_rate = failure_rate
        self._retrying = AsyncRetrying(
            stop=stop_after_attempt(max_retries),
            wait=wait_exponential_jitter(initial=base_delay, max=max_delay),
            retry=retry_if_exception_type(EmbeddingAPIError),
            reraise=True,
        )

    async def _call_provider(self, text: str) -> list[float]:
        await asyncio.sleep(0.001)  # simulated network latency
        if random.random() < self.failure_rate:
            raise EmbeddingAPIError("embedding provider timed out")
        return embed_text(text, self.dim)

    async def embed(self, text: str) -> list[float]:
        return await self._retrying(self._call_provider, text)
