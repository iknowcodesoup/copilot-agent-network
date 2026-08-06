"""FastAPI Depends() providers.

Every provider reads from request.app.state, which main.py's lifespan
populates exactly once at startup. Routes take these via Depends(...)
instead of importing a client module directly, so any provider can be
swapped out in tests with app.dependency_overrides.
"""

from cachetools import LRUCache
from fastapi import HTTPException, Request, status
from langfuse import Langfuse
from limits.aio.strategies import MovingWindowRateLimiter
from qdrant_client import AsyncQdrantClient
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncEngine

from pythonapi.core.embeddings import EmbeddingClient
from pythonapi.core.generation import AnswerGenerator
from pythonapi.core.pii import PiiMasker
from pythonapi.core.reranking import Reranker
from pythonapi.repositories.base import DocumentRepository
from pythonapi.repositories.orders import OrderRepository
from pythonapi.repositories.pii_vault import PiiVaultRepository
from pythonapi.repositories.qdrant import QdrantEmbeddingIndex
from pythonapi.workers.embedding_worker import EmbeddingWorkerPool


def get_redis(request: Request) -> Redis | None:
    return request.app.state.redis


def get_required_redis(request: Request) -> Redis:
    redis_client = request.app.state.redis
    if redis_client is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Redis is not configured.",
        )
    return redis_client


def get_langfuse(request: Request) -> Langfuse | None:
    return request.app.state.langfuse


def get_document_repository(request: Request) -> DocumentRepository:
    return request.app.state.document_repository


def get_embedding_client(request: Request) -> EmbeddingClient:
    return request.app.state.embedding_client


def get_embedding_index(request: Request) -> QdrantEmbeddingIndex:
    return request.app.state.embedding_index


def get_worker_pool(request: Request) -> EmbeddingWorkerPool:
    return request.app.state.worker_pool


def get_postgres_engine(request: Request) -> AsyncEngine | None:
    return request.app.state.postgres_engine


def get_qdrant_client(request: Request) -> AsyncQdrantClient:
    return request.app.state.qdrant_client


def get_required_order_repository(request: Request) -> OrderRepository:
    repository = request.app.state.order_repository
    if repository is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Postgres is not configured.",
        )
    return repository


def get_search_cache(request: Request) -> LRUCache:
    return request.app.state.search_cache


def get_pii_masker(request: Request) -> PiiMasker | None:
    return request.app.state.pii_masker


def get_pii_vault_repository(request: Request) -> PiiVaultRepository | None:
    return request.app.state.pii_vault_repository


def get_reranker(request: Request) -> Reranker:
    return request.app.state.reranker


def get_answer_generator(request: Request) -> AnswerGenerator:
    return request.app.state.answer_generator


async def enforce_search_rate_limit(request: Request) -> None:
    limiter: MovingWindowRateLimiter = request.app.state.rate_limiter
    identifier = request.client.host if request.client else "anonymous"
    if not await limiter.hit(request.app.state.search_rate_limit, "search", identifier):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Search rate limit exceeded, try again shortly.",
        )
