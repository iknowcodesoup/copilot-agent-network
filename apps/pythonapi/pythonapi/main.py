"""HTTP entrypoint for the pythonapi service.

Assembles the FastAPI app: builds every external client/resource once in
lifespan(), stores them on app.state, and wires up middleware and routers.
No business logic lives here - see dependencies.py, routes/, core/.
"""

import logging
from contextlib import asynccontextmanager

from cachetools import LRUCache
from fastapi import FastAPI
from limits import parse
from limits.aio.strategies import MovingWindowRateLimiter
from limits.storage import storage_from_string

from pythonapi.config import settings
from pythonapi.core.embeddings import EmbeddingClient
from pythonapi.infrastructure.langfuse_client import (
    build_langfuse_client,
    close_langfuse_client,
)
from pythonapi.infrastructure.postgres_client import (
    build_postgres_engine,
    close_postgres_engine,
)
from pythonapi.infrastructure.qdrant_client import (
    build_qdrant_client,
    close_qdrant_client,
    ensure_chunk_collection,
)
from pythonapi.infrastructure.redis_client import build_redis_client, close_redis_client
from pythonapi.middleware.idempotency import IdempotencyMiddleware
from pythonapi.repositories.memory import InMemoryDocumentRepository
from pythonapi.repositories.orders import PostgresOrderRepository
from pythonapi.repositories.postgres import PostgresDocumentRepository
from pythonapi.repositories.qdrant import QdrantEmbeddingIndex
from pythonapi.routes import documents, health, orders, search
from pythonapi.routes.copilotkit import register_copilotkit_endpoint
from pythonapi.workers.embedding_worker import EmbeddingWorkerPool

logger = logging.getLogger("uvicorn")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage runtime integrations and background resources."""
    app.state.redis = build_redis_client(settings)
    app.state.langfuse = build_langfuse_client(settings)

    if app.state.redis is not None:
        try:
            await app.state.redis.ping()
            logger.info("Successfully connected to Redis at startup.")
        except Exception as exc:
            logger.error("Redis was unreachable at startup: %s", exc)
            # App still starts; /health reports the failure.

    # Postgres is the system of record for document/chunk metadata and
    # orders. It's optional like Redis/Langfuse: without it, documents fall
    # back to an in-memory repository and /orders returns 503.
    app.state.postgres_engine = await build_postgres_engine(settings)
    app.state.document_repository = (
        PostgresDocumentRepository(app.state.postgres_engine)
        if app.state.postgres_engine is not None
        else InMemoryDocumentRepository()
    )
    app.state.order_repository = (
        PostgresOrderRepository(app.state.postgres_engine)
        if app.state.postgres_engine is not None
        else None
    )

    # Qdrant holds chunk embedding vectors only - never document/order
    # metadata - and is always available via its embedded ":memory:" mode.
    app.state.qdrant_client = build_qdrant_client(settings)
    await ensure_chunk_collection(
        app.state.qdrant_client, settings.QDRANT_COLLECTION, settings.EMBEDDING_DIM
    )
    app.state.embedding_index = QdrantEmbeddingIndex(
        app.state.qdrant_client, settings.QDRANT_COLLECTION
    )

    app.state.embedding_client = EmbeddingClient(
        dim=settings.EMBEDDING_DIM,
        failure_rate=settings.EMBEDDING_FAILURE_RATE,
        max_retries=settings.EMBEDDING_MAX_RETRIES,
        base_delay=settings.EMBEDDING_RETRY_BASE_DELAY,
        max_delay=settings.EMBEDDING_RETRY_MAX_DELAY,
    )
    app.state.search_cache = LRUCache(maxsize=settings.SEARCH_CACHE_CAPACITY)
    rate_limit_storage = storage_from_string(settings.RATE_LIMIT_STORAGE_URI)
    app.state.rate_limiter = MovingWindowRateLimiter(rate_limit_storage)
    app.state.search_rate_limit = parse(settings.SEARCH_RATE_LIMIT)
    app.state.worker_pool = EmbeddingWorkerPool(
        repository=app.state.document_repository,
        embedding_client=app.state.embedding_client,
        embedding_index=app.state.embedding_index,
        num_workers=settings.EMBEDDING_WORKER_COUNT,
        chunk_max_chars=settings.CHUNK_MAX_CHARS,
        chunk_overlap_chars=settings.CHUNK_OVERLAP_CHARS,
    )
    app.state.worker_pool.start()

    try:
        yield
    finally:
        await app.state.worker_pool.shutdown()
        await close_qdrant_client(app.state.qdrant_client)
        if app.state.postgres_engine is not None:
            await close_postgres_engine(app.state.postgres_engine)
        if app.state.redis is not None:
            await close_redis_client(app.state.redis)
        if app.state.langfuse is not None:
            close_langfuse_client(app.state.langfuse)


app = FastAPI(title="pythonapi", lifespan=lifespan)
app.add_middleware(IdempotencyMiddleware, ttl_seconds=settings.IDEMPOTENCY_TTL_SECONDS)

app.include_router(health.router)
app.include_router(orders.router)
app.include_router(documents.router)
app.include_router(search.router)
register_copilotkit_endpoint(app)
