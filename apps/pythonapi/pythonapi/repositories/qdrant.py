import uuid

from qdrant_client import AsyncQdrantClient
from qdrant_client.models import (
    FieldCondition,
    Filter,
    FilterSelector,
    Fusion,
    FusionQuery,
    MatchValue,
    PointStruct,
    Prefetch,
)
from qdrant_client.models import SparseVector as QdrantSparseVector

from pythonapi.models.documents import Chunk, SparseVectorPayload


def _point_id(chunk_id: str) -> str:
    """Qdrant point ids must be an unsigned int or a UUID; chunk ids look like
    f"{document_id}:{index}" and are neither, so every chunk id is mapped
    through a stable UUID5, with the original id kept in the payload."""
    return str(uuid.uuid5(uuid.NAMESPACE_OID, chunk_id))


class QdrantEmbeddingIndex:
    """Vector store for chunk embeddings only - no document/chunk text or
    order data lives here. Payload carries just enough (chunk_id,
    document_id, headings, page_no) to hydrate hits back into full records
    via DocumentRepository.get_chunks_by_ids and to scope deletes by
    document. Each point carries both a "dense" and a "sparse" named vector;
    search_hybrid fuses the two via Qdrant's native RRF.
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
                    vector={
                        "dense": chunk.embedding,
                        "sparse": QdrantSparseVector(
                            indices=chunk.sparse_embedding.indices,
                            values=chunk.sparse_embedding.values,
                        ),
                    },
                    payload={
                        "chunk_id": chunk.id,
                        "document_id": chunk.document_id,
                        "headings": chunk.headings,
                        "page_no": chunk.page_no,
                    },
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

    async def search_hybrid(
        self,
        dense_vector: list[float],
        sparse_vector: SparseVectorPayload,
        limit: int,
    ) -> list[tuple[str, float]]:
        """RRF-fused candidate retrieval over the dense+sparse named vectors.
        Returns (chunk_id, fusion_score) pairs - this is only a cheap
        candidate-narrowing step; core/rag_pipeline.py's cross-encoder
        rerank produces the score that actually reaches the caller.
        """
        result = await self._client.query_points(
            collection_name=self._collection_name,
            prefetch=[
                Prefetch(query=dense_vector, using="dense", limit=limit),
                Prefetch(
                    query=QdrantSparseVector(
                        indices=sparse_vector.indices, values=sparse_vector.values
                    ),
                    using="sparse",
                    limit=limit,
                ),
            ],
            query=FusionQuery(fusion=Fusion.RRF),
            limit=limit,
        )
        return [(point.payload["chunk_id"], point.score) for point in result.points]
