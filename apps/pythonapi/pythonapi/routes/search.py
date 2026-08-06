from cachetools import LRUCache
from fastapi import APIRouter, Depends

from pythonapi.config import settings
from pythonapi.core.embeddings import EmbeddingClient
from pythonapi.core.generation import AnswerGenerator
from pythonapi.core.pii import PiiMasker
from pythonapi.core.rag_pipeline import search_and_generate
from pythonapi.core.reranking import Reranker
from pythonapi.dependencies import (
    enforce_search_rate_limit,
    get_answer_generator,
    get_document_repository,
    get_embedding_client,
    get_embedding_index,
    get_pii_masker,
    get_reranker,
    get_search_cache,
)
from pythonapi.models.documents import SearchRequest, SearchResponse
from pythonapi.repositories.base import DocumentRepository
from pythonapi.repositories.qdrant import QdrantEmbeddingIndex

router = APIRouter(prefix="/search", tags=["Search"])


@router.post(
    "", response_model=SearchResponse, dependencies=[Depends(enforce_search_rate_limit)]
)
async def search(
    search_request: SearchRequest,
    repository: DocumentRepository = Depends(get_document_repository),
    embedding_client: EmbeddingClient = Depends(get_embedding_client),
    embedding_index: QdrantEmbeddingIndex = Depends(get_embedding_index),
    reranker: Reranker = Depends(get_reranker),
    pii_masker: PiiMasker | None = Depends(get_pii_masker),
    answer_generator: AnswerGenerator = Depends(get_answer_generator),
    cache: LRUCache = Depends(get_search_cache),
):
    return await search_and_generate(
        repository=repository,
        embedding_index=embedding_index,
        embedding_client=embedding_client,
        reranker=reranker,
        pii_masker=pii_masker,
        answer_generator=answer_generator,
        cache=cache,
        query=search_request.query,
        top_k=search_request.top_k,
        prefetch_limit=max(search_request.top_k, settings.RETRIEVAL_PREFETCH_LIMIT),
    )
