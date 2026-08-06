from fastapi import APIRouter, Depends
from langfuse import Langfuse
from qdrant_client import AsyncQdrantClient
from redis.asyncio import Redis
from redis.exceptions import RedisError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncEngine

from pythonapi.dependencies import (
    get_langfuse,
    get_postgres_engine,
    get_qdrant_client,
    get_redis,
)

router = APIRouter(tags=["Health"])


@router.get("/health")
async def get_health(
    redis_client: Redis | None = Depends(get_redis),
    langfuse_client: Langfuse | None = Depends(get_langfuse),
    postgres_engine: AsyncEngine | None = Depends(get_postgres_engine),
    qdrant_client: AsyncQdrantClient = Depends(get_qdrant_client),
) -> dict:
    """Report service health and the status of optional integrations."""
    response: dict = {"status": "ok"}

    if redis_client is not None:
        try:
            await redis_client.ping()
            connected = True
        except RedisError:
            connected = False
        response["redis"] = {"configured": True, "connected": connected}

    if langfuse_client is not None:
        response["langfuse"] = {"configured": True}

    if postgres_engine is not None:
        try:
            async with postgres_engine.connect() as conn:
                await conn.execute(select(1))
            connected = True
        except Exception:
            connected = False
        response["postgres"] = {"configured": True, "connected": connected}

    try:
        await qdrant_client.info()
        qdrant_connected = True
    except Exception:
        qdrant_connected = False
    response["qdrant"] = {"connected": qdrant_connected}

    return response
