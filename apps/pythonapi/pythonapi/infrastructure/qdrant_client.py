"""Qdrant client construction and collection bootstrap.

Unlike Redis/Langfuse/Postgres, Qdrant is not optional: QDRANT_URL defaults
to the client library's embedded ":memory:" mode, so the app - and its
tests - always have a real (if ephemeral) vector index without any external
service running. Only chunk embedding vectors live here; see
repositories/qdrant.py for what gets stored.
"""

from qdrant_client import AsyncQdrantClient
from qdrant_client.models import Distance, VectorParams

from pythonapi.config import Settings


def build_qdrant_client(settings: Settings) -> AsyncQdrantClient:
    return AsyncQdrantClient(
        location=settings.QDRANT_URL, api_key=settings.QDRANT_API_KEY
    )


async def ensure_chunk_collection(
    client: AsyncQdrantClient, collection_name: str, vector_size: int
) -> None:
    if not await client.collection_exists(collection_name):
        await client.create_collection(
            collection_name=collection_name,
            vectors_config=VectorParams(size=vector_size, distance=Distance.COSINE),
        )


async def close_qdrant_client(client: AsyncQdrantClient) -> None:
    await client.close()
