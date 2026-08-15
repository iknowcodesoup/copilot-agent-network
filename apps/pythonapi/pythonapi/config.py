"""Application settings, sourced from environment variables."""

from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration for the pythonapi service.

    Every field that can carry a default carries one, so the service boots with
    no environment file. A variable is an override, never a requirement. Never
    add a bare `= None`: the value then reaches its consumer as None and fails
    at the call site, far from the cause. tests/test_config.py enforces this.

    None is correct in two cases only. Secrets, which have no safe default. And
    optional integrations, where None means "off" - Redis, Langfuse, Postgres,
    and the voice factory all stay unset in local dev, and every consumer must
    tolerate that. Qdrant is the exception: it defaults to the client library's
    embedded ":memory:" mode, so the vector index is always available.
    """

    REDIS_URL: str | None = None
    # How long one Redis command may wait for its reply. Set here rather than
    # left to redis-py, whose default changed from "block forever" to 5s and
    # silently broke every blocking read. See build_redis_client.
    REDIS_SOCKET_TIMEOUT_SECONDS: float = 5.0
    IDEMPOTENCY_TTL_SECONDS: int = 86400

    LANGFUSE_HOST: str | None = None
    LANGFUSE_PUBLIC_KEY: str | None = None
    LANGFUSE_SECRET_KEY: str | None = None
    LANGFUSE_ENV: str = "development"
    LANGFUSE_RELEASE: str | None = None

    # Relational data (document/chunk metadata, orders). None disables the
    # routes and endpoints that require it (see get_required_order_repository)
    # and falls back to an in-memory document repository for local dev/tests.
    POSTGRES_URL: str | None = None

    # The jeanlucrecord control API in the star-trek-voyicer repo. It runs on
    # the host, not in this compose stack, because the TTS training stage needs
    # an NVIDIA GPU and Docker. None disables every /api/voice route.
    # From inside a container the host is reachable as host.docker.internal.
    VOICE_FACTORY_URL: str | None = None
    VOICE_FACTORY_TIMEOUT_SECONDS: float = 30.0
    # How often the reconciler advances each active voice run. The factory
    # webhook is the fast path; this timer is only the backstop for a webhook
    # that never arrived.
    VOICE_RECONCILE_INTERVAL_SECONDS: float = 15.0
    # Retry budget for a factory call that failed for a transient reason
    # (connection refused, timeout, 5xx). Permanent 4xx contract errors are
    # never retried.
    VOICE_FACTORY_RETRY_ATTEMPTS: int = 3
    VOICE_FACTORY_RETRY_BASE_DELAY: float = 0.5
    VOICE_FACTORY_RETRY_MAX_DELAY: float = 8.0

    # Shared secret the voice factory sends as X-Voice-Factory-Token. A secret,
    # so it has no default. Unset, the webhook route answers 503 rather than
    # accepting unauthenticated writes, and the reconcile timer carries the
    # pipeline on its own.
    VOICE_WEBHOOK_TOKEN: str | None = None
    # A run fails only after this many consecutive transient factory errors.
    # At the 15s reconcile interval that is five minutes of an unreachable
    # factory, which a restart of the GPU host easily fits inside.
    VOICE_MAX_CONSECUTIVE_ERRORS: int = 20
    # How long one API instance owns a run while it reconciles it. The lease
    # expires on its own, so an instance that dies never strands a run.
    VOICE_LEASE_SECONDS: float = 60.0
    # Same two knobs as above, for VoiceTrainingReconciler. A separate pair
    # rather than reusing VOICE_RECONCILE_INTERVAL_SECONDS/VOICE_LEASE_SECONDS
    # because training and ingest are independent pipelines (FR21) that may
    # need different cadences in practice.
    VOICE_TRAINING_RECONCILE_INTERVAL_SECONDS: float = 15.0
    VOICE_TRAINING_LEASE_SECONDS: float = 60.0
    # Redis Stream carrying voice run events out to every API instance, and
    # from there to the browser over SSE. Bounded: Redis is a delivery and
    # replay buffer here, never the state store.
    VOICE_EVENT_STREAM_KEY: str = "voice:events"
    VOICE_EVENT_STREAM_MAX_LENGTH: int = 1000
    # Idle gap after which an open SSE connection gets a comment heartbeat, so
    # a proxy in the middle does not close it.
    VOICE_EVENT_HEARTBEAT_SECONDS: float = 15.0

    # Vector store for chunk embeddings only - no document/order metadata
    # lives here. ":memory:" runs Qdrant embedded, in-process.
    QDRANT_URL: str = ":memory:"
    QDRANT_API_KEY: str | None = None
    QDRANT_COLLECTION: str = "chunk_embeddings"

    # Dense/sparse embedding backend. "mock" keeps tests and local dev fully
    # offline via the deterministic feature-hashing provider in
    # core/embeddings.py; "openai_compatible" calls an OpenAI-compatible
    # gateway at LLM_BASE_URL (LiteLLM by default), which can then route to
    # LM Studio/Ollama/OpenAI/etc for dense vectors, plus fastembed
    # (in-process, no network) for sparse BM25 vectors. Qdrant's collection
    # vector size is fixed at creation time, so EMBEDDING_DIM must match
    # whichever provider is active - the default pair here is the mock and its
    # 64 dimensions; nomic-embed-text needs 768. Override both together.
    EMBEDDING_PROVIDER: Literal["mock", "openai_compatible"] = "mock"
    LLM_BASE_URL: str = "http://localhost:4000/v1"
    LLM_API_KEY: str | None = None
    LLM_MODEL: str = "chat-default"
    # How many times one run may call tools before the agent stops asking the
    # model again. A model that keeps calling tools would otherwise loop until
    # the browser gives up, and every step costs a real call to the gateway.
    AGENT_MAX_TOOL_STEPS: int = 6
    EMBEDDING_MODEL: str = "embedding-default"
    EMBEDDING_SPARSE_MODEL: str = "Qdrant/bm25"

    EMBEDDING_DIM: int = 64
    # Failure injection for the retry path. Only the mock provider reads it.
    EMBEDDING_FAILURE_RATE: float = 0.0
    EMBEDDING_MAX_RETRIES: int = 3
    EMBEDDING_RETRY_BASE_DELAY: float = 0.05
    EMBEDDING_RETRY_MAX_DELAY: float = 1.0
    EMBEDDING_WORKER_COUNT: int = 2

    # Cross-encoder reranking of retrieved candidates. "mock" uses a
    # deterministic token-overlap scorer so pytest never downloads a real
    # HF model; "cross_encoder" loads sentence-transformers' CrossEncoder.
    RERANK_PROVIDER: Literal["mock", "cross_encoder"] = "mock"
    RERANK_MODEL: str = "cross-encoder/ms-marco-MiniLM-L-6-v2"

    # Candidates fetched per dense/sparse leg before RRF fusion + reranking.
    RETRIEVAL_PREFETCH_LIMIT: int = 20

    # Structured answer generation. "mock" returns a deterministic answer with
    # no LLM call; "baml" calls the generated BAML client, which talks to the
    # same gateway configured by LLM_BASE_URL/LLM_MODEL above.
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
    CORS_ALLOW_ORIGINS: str = "http://localhost:4001"

    @property
    def gateway_api_key(self) -> str:
        """LLM_API_KEY as the OpenAI client requires it: a non-empty string.

        The client refuses to build without one, but a local LiteLLM with no
        master key accepts any value. So a keyless stack sends a placeholder
        rather than making the key a deployment requirement it is not.
        """
        return self.LLM_API_KEY or "no-key-required"

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
