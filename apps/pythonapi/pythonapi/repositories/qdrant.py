import uuid

from qdrant_client import AsyncQdrantClient
from qdrant_client.models import (
    FieldCondition,
    Filter,
    FilterSelector,
    MatchValue,
    PointStruct,
)

from pythonapi.models.documents import Chunk


def _point_id(chunk_id: str) -> str:
    """Qdrant point ids must be an unsigned int or a UUID; chunk ids look like
    f"{document_id}:{index}" and are neither, so every chunk id is mapped
    through a stable UUID5, with the original id kept in the payload."""
    return str(uuid.uuid5(uuid.NAMESPACE_OID, chunk_id))


class QdrantEmbeddingIndex:
    """Vector store for chunk embeddings only - no document/chunk text or
    order data lives here. Payload carries just enough (chunk_id,
    document_id) to hydrate hits back into full records via
    DocumentRepository.get_chunks_by_ids and to scope deletes by document.
    """

    def __init__(self, client: AsyncQdrantClient, collection_name: str) -> None:
        self._client = client
        self._collection_name = collection_name

    async def upsert(self, chunks: list[Chunk]) -> None:
        if not chunks:
            return
        await self._client.upsert(
            collection_name=self._collection_name,
            points=[
                PointStruct(
                    id=_point_id(chunk.id),
                    vector=chunk.embedding,
                    payload={"chunk_id": chunk.id, "document_id": chunk.document_id},
                )
                for chunk in chunks
            ],
        )

    async def delete_for_document(self, document_id: str) -> None:
        await self._client.delete(
            collection_name=self._collection_name,
            points_selector=FilterSelector(
                filter=Filter(
                    must=[
                        FieldCondition(
                            key="document_id", match=MatchValue(value=document_id)
                        )
                    ]
                )
            ),
        )

    async def search(
        self, query_vector: list[float], top_k: int
    ) -> list[tuple[str, float]]:
        """Native ANN search. Returns (chunk_id, score) pairs, ranked."""
        result = await self._client.query_points(
            collection_name=self._collection_name,
            query=query_vector,
            limit=top_k,
        )
        return [(point.payload["chunk_id"], point.score) for point in result.points]
