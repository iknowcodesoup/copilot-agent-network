"""Application settings, sourced from environment variables."""

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

    CHUNK_MAX_CHARS: int = 800
    CHUNK_OVERLAP_CHARS: int = 100

    EMBEDDING_DIM: int = 64
    EMBEDDING_FAILURE_RATE: float = 0.2
    EMBEDDING_MAX_RETRIES: int = 3
    EMBEDDING_RETRY_BASE_DELAY: float = 0.05
    EMBEDDING_RETRY_MAX_DELAY: float = 1.0
    EMBEDDING_WORKER_COUNT: int = 2

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
