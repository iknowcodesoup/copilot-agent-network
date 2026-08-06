"""Hybrid retrieval + rerank + BAML-generated structured answer.

Replaces core/vector_search.py. This module is the concrete enforcement
point for the PII-exposure model: the query is masked before it is embedded
or handed to the answer generator, and reconstitution happens exactly once,
at the very end, on the response about to be returned to the caller. The
LLM call in answer_generator.generate() sits strictly between those two
steps and never sees real PII.
"""

from cachetools import LRUCache
from langfuse import observe

from pythonapi.core.embeddings import EmbeddingClient
from pythonapi.core.generation import AnswerGenerator
from pythonapi.core.pii import PiiMasker
from pythonapi.core.reranking import Reranker
from pythonapi.models.documents import SearchResponse, SearchResultItem
from pythonapi.repositories.base import DocumentRepository
from pythonapi.repositories.qdrant import QdrantEmbeddingIndex


@observe(as_type="retriever")
async def _retrieve_and_rerank(
    repository: DocumentRepository,
    embedding_index: QdrantEmbeddingIndex,
    embedding_client: EmbeddingClient,
    reranker: Reranker,
    masked_query: str,
    top_k: int,
    prefetch_limit: int,
) -> list[SearchResultItem]:
    dense_vector = await embedding_client.embed(masked_query)
    sparse_vector = await embedding_client.embed_sparse(masked_query)
    hits = await embedding_index.search_hybrid(
        dense_vector, sparse_vector, prefetch_limit
    )

    hit_ids = [chunk_id for chunk_id, _ in hits]
    chunks_by_id = {
        chunk.id: chunk for chunk in await repository.get_chunks_by_ids(hit_ids)
    }
    candidates = [chunks_by_id[cid] for cid, _ in hits if cid in chunks_by_id]
    if not candidates:
        return []

    scores = await reranker.rerank(masked_query, [chunk.text for chunk in candidates])
    ranked = sorted(
        zip(candidates, scores, strict=True), key=lambda pair: pair[1], reverse=True
    )
    ranked = ranked[:top_k]

    titles: dict[str, str] = {}
    results: list[SearchResultItem] = []
    for chunk, score in ranked:
        if chunk.document_id not in titles:
            document = await repository.get_document(chunk.document_id)
            titles[chunk.document_id] = document.title if document else "unknown"
        results.append(
            SearchResultItem(
                document_id=chunk.document_id,
                document_title=titles[chunk.document_id],
                chunk_index=chunk.index,
                text=chunk.text,  # still masked here
                score=score,
            )
        )
    return results


@observe()
async def search_and_generate(
    repository: DocumentRepository,
    embedding_index: QdrantEmbeddingIndex,
    embedding_client: EmbeddingClient,
    reranker: Reranker,
    pii_masker: PiiMasker | None,
    answer_generator: AnswerGenerator,
    cache: LRUCache,
    query: str,
    top_k: int,
    prefetch_limit: int = 20,
) -> SearchResponse:
    cache_key = (query, top_k)
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    masked_query = await pii_masker.mask(query) if pii_masker is not None else query
    results = await _retrieve_and_rerank(
        repository,
        embedding_index,
        embedding_client,
        reranker,
        masked_query,
        top_k,
        prefetch_limit,
    )

    context = "\n\n".join(result.text for result in results)  # masked chunk text only
    raw_answer = await answer_generator.generate(
        context=context, question=masked_query
    )

    if pii_masker is not None:
        results = [
            result.model_copy(
                update={"text": await pii_masker.reconstitute(result.text)}
            )
            for result in results
        ]
        answer = raw_answer.model_copy(
            update={"answer": await pii_masker.reconstitute(raw_answer.answer)}
        )
    else:
        answer = raw_answer

    response = SearchResponse(query=query, answer=answer, results=results)
    cache[cache_key] = response
    return response
