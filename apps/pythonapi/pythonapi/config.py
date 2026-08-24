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

    # --- Multi-agent A2A -------------------------------------------------
    # The two specialists are mounted inside this process by default, so the
    # whole network runs with one `nx serve pythonapi` and no extra ports.
    # Turn a mount off only when that agent runs as its own process.
    RESEARCH_AGENT_MOUNTED: bool = True
    VOICE_AGENT_MOUNTED: bool = True

    # Where the mounted specialists answer. Each agent's card is published at
    # <mount path>/.well-known/agent-card.json.
    RESEARCH_AGENT_MOUNT_PATH: str = "/agents/research"
    VOICE_AGENT_MOUNT_PATH: str = "/agents/voice"

    # A remote specialist, when one runs separately. Unset, the Orchestrator
    # talks to the mounted agent over an in-process ASGI transport - still a
    # real A2A JSON-RPC exchange, just without a network hop. Set it and the
    # Orchestrator calls that URL over HTTP instead, with nothing else
    # changing. This is the whole of the in-process/remote switch.
    RESEARCH_AGENT_A2A_URL: str | None = None
    VOICE_AGENT_A2A_URL: str | None = None

    # Host and port for `python -m pythonapi.agents.research` (and .voice).
    # Unused while the agent is mounted.
    RESEARCH_AGENT_HOST: str = "0.0.0.0"
    RESEARCH_AGENT_PORT: int = 8001
    VOICE_AGENT_HOST: str = "0.0.0.0"
    VOICE_AGENT_PORT: int = 8002

    # The Orchestrator's own A2A surface. `/api/agent` (AG-UI) stays the
    # browser's front door; this is a second, separate one - a real A2A
    # `assist` skill another agent or tool can delegate into, publishing the
    # same delegation logic that route_request already gives the browser.
    ORCHESTRATOR_AGENT_MOUNTED: bool = True
    ORCHESTRATOR_AGENT_MOUNT_PATH: str = "/agents/orchestrator"
    ORCHESTRATOR_AGENT_A2A_URL: str | None = None
    ORCHESTRATOR_AGENT_HOST: str = "0.0.0.0"
    ORCHESTRATOR_AGENT_PORT: int = 8003

    # This service's own base URL, used to build the `url` a mounted agent
    # publishes in its card. A card must advertise where a caller can reach
    # the agent, which this process cannot infer from a request it has not
    # received yet.
    PUBLIC_BASE_URL: str = "http://localhost:8000"

    # How many chunks the research skill retrieves per question. Matches the
    # /search route's own default so both read the corpus the same way.
    RESEARCH_AGENT_TOP_K: int = 5

    # A delegated task that has not reached a terminal state by now is
    # treated as a specialist failure, so one hung agent cannot hold an AG-UI
    # stream open indefinitely (CAP-5: failures stay isolated).
    A2A_TASK_TIMEOUT_SECONDS: float = 60.0

    # --- Agentic Resource Discovery (ARD) --------------------------------
    # This service is both an ARD publisher (a static manifest at
    # /.well-known/ai-catalog.json) and an ARD registry (search over it).
    # Turn it off and those routes disappear; delegation is unaffected,
    # because the Orchestrator resolves specialists from configured URLs.
    ARD_ENABLED: bool = True

    # ARD identifiers are domain-anchored, and a real one needs a domain we
    # can prove we own. This is a placeholder, so the `did:web:` it produces
    # asserts nothing. The docs say so rather than implying a trust binding
    # that does not exist.
    ARD_PUBLISHER_DOMAIN: str = "agents.localhost"
    ARD_PUBLISHER_DISPLAY_NAME: str = "Copilot Agent Network"

    # Spec defaults: /search returns 10 per page, /explore 20, both capped
    # at 100.
    ARD_SEARCH_PAGE_SIZE_DEFAULT: int = 10
    ARD_EXPLORE_PAGE_SIZE_DEFAULT: int = 20

    # --- MCP RAG server ---------------------------------------------------
    # Read-only RAG tools over the Model Context Protocol, for any
    # MCP-capable client - not only the agents in this network. Mounted
    # inside pythonapi the same way the two A2A specialists are, and listed
    # in the ARD catalog as a second resource type.
    RAG_MCP_SERVER_MOUNTED: bool = True
    RAG_MCP_MOUNT_PATH: str = "/mcp/rag"

    @property
    def research_agent_public_url(self) -> str:
        """Where the Research Agent's card says it can be reached."""
        return _rpc_endpoint(
            self.RESEARCH_AGENT_A2A_URL
            or f"{self.PUBLIC_BASE_URL.rstrip('/')}{self.RESEARCH_AGENT_MOUNT_PATH}"
        )

    @property
    def voice_agent_public_url(self) -> str:
        """Where the Voice Agent's card says it can be reached."""
        return _rpc_endpoint(
            self.VOICE_AGENT_A2A_URL
            or f"{self.PUBLIC_BASE_URL.rstrip('/')}{self.VOICE_AGENT_MOUNT_PATH}"
        )

    @property
    def orchestrator_agent_public_url(self) -> str:
        """Where the Orchestrator's own Agent Card says it can be reached."""
        return _rpc_endpoint(
            self.ORCHESTRATOR_AGENT_A2A_URL
            or f"{self.PUBLIC_BASE_URL.rstrip('/')}{self.ORCHESTRATOR_AGENT_MOUNT_PATH}"
        )

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

    # No env_file: this service reads real process environment variables only
    # (docker-compose.yml injects them directly). A dotenv path here would
    # resolve relative to the process's CWD, not this package, and could
    # silently pick up an unrelated .env from wherever the process happens
    # to be launched from.
    model_config = SettingsConfigDict(extra="ignore")


def _rpc_endpoint(url: str) -> str:
    """Normalize an agent's base URL to the exact JSON-RPC endpoint.

    The trailing slash is load-bearing. The SDK serves JSON-RPC at the mount
    root, and Starlette answers the slashless form with a 307 to the slashed
    one. The A2A client does not follow redirects, so a card advertising
    ".../agents/research" makes every delegated call fail on the redirect.
    """
    return url.rstrip("/") + "/"


settings = Settings()
