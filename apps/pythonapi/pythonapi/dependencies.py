"""FastAPI Depends() providers.

Every provider reads from request.app.state, which main.py's lifespan
populates exactly once at startup. Routes take these via Depends(...)
instead of importing a client module directly, so any provider can be
swapped out in tests with app.dependency_overrides.
"""

from collections.abc import Callable
from typing import TypeVar

from cachetools import LRUCache
from fastapi import HTTPException, Request, status
from langfuse import Langfuse
from limits.aio.strategies import MovingWindowRateLimiter
from qdrant_client import AsyncQdrantClient
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncEngine

from pythonapi.a2a_support.discovery import SpecialistDirectory
from pythonapi.core.embeddings import EmbeddingClient
from pythonapi.core.generation import AnswerGenerator
from pythonapi.core.pii import PiiMasker
from pythonapi.core.reranking import Reranker
from pythonapi.core.voice_events import VoiceEventStream
from pythonapi.core.voice_factory_gateway import VoiceFactoryGateway
from pythonapi.repositories.base import DocumentRepository
from pythonapi.repositories.qdrant import QdrantEmbeddingIndex
from pythonapi.repositories.voice_contributions import VoiceContributionRepository
from pythonapi.repositories.voice_repository import VoiceRepository
from pythonapi.repositories.voice_runs import VoiceRunRepository
from pythonapi.workers.embedding_worker import EmbeddingWorkerPool
from pythonapi.workers.voice_training_reconciler import VoiceTrainingReconciler


def get_redis(request: Request) -> Redis | None:
    return request.app.state.redis


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


StateT = TypeVar("StateT")


def require_state(attribute: str, detail: str) -> Callable[[Request], StateT]:
    """A Depends() provider reading app.state.<attribute>, for state that is
    only sometimes configured. Answers 503 with `detail` when it is None."""

    def provider(request: Request) -> StateT:
        value = getattr(request.app.state, attribute)
        if value is None:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=detail
            )
        return value

    return provider


get_required_order_repository = require_state(
    "order_repository", "Postgres is not configured."
)

get_required_voice_factory_gateway = require_state(
    "voice_factory_gateway",
    "The voice factory is not configured. Set VOICE_FACTORY_URL.",
)


def get_voice_factory_gateway(request: Request) -> VoiceFactoryGateway | None:
    """None without a voice factory.

    For a route that owns its answer in Postgres and asks the factory only for
    a name, such as assign_run or get_voice. Those must keep working with
    VOICE_FACTORY_URL unset, so they take this instead of the required one.
    """
    return request.app.state.voice_factory_gateway


def get_required_voice_run_repository(request: Request) -> VoiceRunRepository:
    return request.app.state.voice_run_repository


def get_required_voice_repository(request: Request) -> VoiceRepository:
    return request.app.state.voice_repository


def get_required_voice_contribution_repository(
    request: Request,
) -> VoiceContributionRepository:
    return request.app.state.voice_contribution_repository


def get_required_voice_event_stream(request: Request) -> VoiceEventStream:
    """Always present. Without Redis it publishes and replays nothing, so the
    SSE route still opens and still sends its snapshot."""
    return request.app.state.voice_event_stream


get_required_voice_run_reconciler = require_state(
    "voice_run_reconciler",
    "The voice factory is not configured. Set VOICE_FACTORY_URL.",
)

get_required_voice_training_reconciler = require_state(
    "voice_training_reconciler",
    "The voice factory is not configured. Set VOICE_FACTORY_URL.",
)


def get_voice_training_reconciler(request: Request) -> VoiceTrainingReconciler | None:
    """None without a voice factory. assign_run is DB-only and must keep
    working in that case - it just has nothing to wake."""
    return request.app.state.voice_training_reconciler


def get_search_cache(request: Request) -> LRUCache:
    return request.app.state.search_cache


def get_pii_masker(request: Request) -> PiiMasker | None:
    return request.app.state.pii_masker


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


def get_specialist_directory(request: Request) -> SpecialistDirectory | None:
    """The Orchestrator's specialist directory, or None before startup.

    None only happens outside a running lifespan, which is where the chat
    agent falls back to answering without delegation.
    """
    return getattr(request.app.state, "specialist_directory", None)
