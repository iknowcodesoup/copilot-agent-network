"""Application settings, sourced from environment variables."""

from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration for the pythonapi service.

    Redis, Langfuse, and Postgres are optional integrations: all three stay
    unset in local dev without the full docker-compose stack, and every
    consumer of these settings must tolerate that. Qdrant is the exception -
    QDRANT_URL defaults to the client library's embedded ":memory:" mode, so
    the vector index is always available, even with nothing else running.
    """

    REDIS_URL: str | None = None
    IDEMPOTENCY_TTL_SECONDS: int = 86400

    LANGFUSE_HOST: str | None = None
    LANGFUSE_PUBLIC_KEY: str | None = None
    LANGFUSE_SECRET_KEY: str | None = None
    LANGFUSE_ENV: str | None = None
    LANGFUSE_RELEASE: str | None = None

    # Relational data (document/chunk metadata, orders). None disables the
    # routes and endpoints that require it (see get_required_order_repository)
    # and falls back to an in-memory document repository for local dev/tests.
    POSTGRES_URL: str | None = None

    # Vector store for chunk embeddings only - no document/order metadata
    # lives here. ":memory:" runs Qdrant embedded, in-process.
    QDRANT_URL: str = ":memory:"
    QDRANT_API_KEY: str | None = None
    QDRANT_COLLECTION: str = "chunk_embeddings"

    # Dense/sparse embedding backend. "mock" (default) keeps tests and local
    # dev fully offline via the deterministic feature-hashing provider in
    # core/embeddings.py; "openai_compatible" calls an OpenAI-compatible
    # gateway at LLM_BASE_URL (LiteLLM by default), which can then route to
    # LM Studio/Ollama/OpenAI/etc for dense vectors, plus fastembed
    # (in-process, no network) for sparse BM25 vectors. Qdrant's collection
    # vector size is fixed at creation time, so EMBEDDING_DIM must match
    # whichever provider is active - the mock's default (64) does NOT match
    # a real nomic-embed-text model (768); set both together.
    EMBEDDING_PROVIDER: Literal["mock", "openai_compatible"] = "mock"
    LLM_BASE_URL: str = "http://localhost:4000/v1"
    LLM_API_KEY: str | None = None
    LLM_MODEL: str = "chat-default"
    EMBEDDING_MODEL: str = "embedding-default"
    EMBEDDING_SPARSE_MODEL: str = "Qdrant/bm25"

    EMBEDDING_DIM: int = 64
    EMBEDDING_FAILURE_RATE: float = 0.2
    EMBEDDING_MAX_RETRIES: int = 3
    EMBEDDING_RETRY_BASE_DELAY: float = 0.05
    EMBEDDING_RETRY_MAX_DELAY: float = 1.0
    EMBEDDING_WORKER_COUNT: int = 2

    # Cross-encoder reranking of retrieved candidates. "mock" (default) uses
    # a deterministic token-overlap scorer so pytest never downloads a real
    # HF model; "cross_encoder" loads sentence-transformers' CrossEncoder.
    RERANK_PROVIDER: Literal["mock", "cross_encoder"] = "mock"
    RERANK_MODEL: str = "cross-encoder/ms-marco-MiniLM-L-6-v2"

    # Candidates fetched per dense/sparse leg before RRF fusion + reranking.
    RETRIEVAL_PREFETCH_LIMIT: int = 20

    # Structured answer generation. "mock" (default) returns a deterministic
    # answer with no LLM call; "baml" calls the generated BAML client, which
    # talks to the same LiteLLM/OpenAI-compatible gateway configured by
    # LLM_BASE_URL/LLM_MODEL above.
    GENERATION_PROVIDER: Literal["mock", "baml"] = "mock"

    # PII vault (Presidio masking + encrypted, persisted reconstitution).
    # Unlike Redis/Langfuse/Postgres above, an unset key/salt here does not
    # degrade to reduced functionality - it disables masking entirely, so
    # raw PII flows through unmasked. main.py logs a loud warning on that
    # path given the higher stakes versus "no idempotency"/"no tracing".
    PII_VAULT_ENCRYPTION_KEY: str | None = None
    PII_VAULT_SALT: str | None = None
    PII_LANGUAGE: str = "en"

    # Browser origins allowed to call this service. The CopilotKit v2 frontend
    # talks to /api/agent directly from the browser rather than through a
    # server-side proxy, so its origin has to be listed here. Comma-separated
    # rather than a list so docker-compose can pass it as a plain string.
    CORS_ALLOW_ORIGINS: str = "http://localhost:4001,http://localhost:3000"

    @property
    def cors_allow_origins(self) -> list[str]:
        """CORS_ALLOW_ORIGINS split into the list CORSMiddleware expects."""
        return [
            origin.strip()
            for origin in self.CORS_ALLOW_ORIGINS.split(",")
            if origin.strip()
        ]

    RATE_LIMIT_STORAGE_URI: str = "async+memory://"
    SEARCH_RATE_LIMIT: str = "20/minute"
    SEARCH_CACHE_CAPACITY: int = 100
    SEARCH_DEFAULT_TOP_K: int = 5

    # No env_file: this service reads real process environment variables only
    # (docker-compose.yml injects them directly). A dotenv path here would
    # resolve relative to the process's CWD, not this package, and could
    # silently pick up an unrelated .env from wherever the process happens
    # to be launched from.
    model_config = SettingsConfigDict(extra="ignore")


settings = Settings()
