from cachetools import LRUCache

from pythonapi.core.embeddings import EmbeddingClient
from pythonapi.models.documents import SearchResultItem
from pythonapi.repositories.base import DocumentRepository
from pythonapi.repositories.qdrant import QdrantEmbeddingIndex


async def search_documents(
    repository: DocumentRepository,
    embedding_index: QdrantEmbeddingIndex,
    embedding_client: EmbeddingClient,
    cache: LRUCache,
    query: str,
    top_k: int,
) -> list[SearchResultItem]:
    cache_key = (query, top_k)
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    query_vector = await embedding_client.embed(query)
    hits = await embedding_index.search(query_vector, top_k)
    chunks_by_id = {
        chunk.id: chunk
        for chunk in await repository.get_chunks_by_ids(
            [chunk_id for chunk_id, _ in hits]
        )
    }

    results: list[SearchResultItem] = []
    titles: dict[str, str] = {}
    for chunk_id, score in hits:
        chunk = chunks_by_id.get(chunk_id)
        if chunk is None:
            continue  # index and metadata store briefly out of sync
        if chunk.document_id not in titles:
            document = await repository.get_document(chunk.document_id)
            titles[chunk.document_id] = document.title if document else "unknown"
        results.append(
            SearchResultItem(
                document_id=chunk.document_id,
                document_title=titles[chunk.document_id],
                chunk_index=chunk.index,
                text=chunk.text,
                score=score,
            )
        )

    cache[cache_key] = results
    return results
