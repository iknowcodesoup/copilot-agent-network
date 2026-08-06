"""Postgres engine construction. See redis_client.py for the DI rationale.

Postgres is the system of record for relational data: document/chunk
metadata and orders. Chunk embedding vectors are not part of this schema -
those live in Qdrant exclusively (see qdrant_client.py).
"""

from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine

from pythonapi.config import Settings
from pythonapi.models.orm import Base


def _asyncpg_url(url: str) -> str:
    """POSTGRES_URL is a plain postgresql:// DSN (see docker-compose.yml);
    SQLAlchemy's async engine needs the asyncpg dialect spelled out."""
    if url.startswith("postgresql://"):
        return url.replace("postgresql://", "postgresql+asyncpg://", 1)
    return url


async def build_postgres_engine(settings: Settings) -> AsyncEngine | None:
    """Build an engine and apply schema when POSTGRES_URL is configured, else None."""
    if not settings.POSTGRES_URL:
        return None
    engine = create_async_engine(_asyncpg_url(settings.POSTGRES_URL))
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    return engine


async def close_postgres_engine(engine: AsyncEngine) -> None:
    await engine.dispose()
