"""Qdrant client construction and collection bootstrap.

Unlike Redis/Langfuse/Postgres, Qdrant is not optional: QDRANT_URL defaults
to the client library's embedded ":memory:" mode, so the app - and its
tests - always have a real (if ephemeral) vector index without any external
service running. Only chunk embedding vectors live here; see
repositories/qdrant.py for what gets stored.
"""

from qdrant_client import AsyncQdrantClient
from qdrant_client.models import Distance, Modifier, SparseVectorParams, VectorParams

from pythonapi.config import Settings


def build_qdrant_client(settings: Settings) -> AsyncQdrantClient:
    return AsyncQdrantClient(
        location=settings.QDRANT_URL, api_key=settings.QDRANT_API_KEY
    )


async def ensure_chunk_collection(
    client: AsyncQdrantClient, collection_name: str, vector_size: int
) -> None:
    """Hybrid collection: a named "dense" vector (size must match the active
    embedding provider - see Settings.EMBEDDING_DIM) plus a named "sparse"
    BM25-style vector, fused via RRF at query time (repositories/qdrant.py's
    search_hybrid). collection_exists() short-circuits creation, so an
    existing collection from the old single-unnamed-vector schema will not
    be migrated automatically - the local qdrant-data volume must be
    recreated when this schema lands anywhere with existing data.
    """
    if not await client.collection_exists(collection_name):
        await client.create_collection(
            collection_name=collection_name,
            vectors_config={
                "dense": VectorParams(size=vector_size, distance=Distance.COSINE)
            },
            sparse_vectors_config={"sparse": SparseVectorParams(modifier=Modifier.IDF)},
        )


async def close_qdrant_client(client: AsyncQdrantClient) -> None:
    await client.close()
