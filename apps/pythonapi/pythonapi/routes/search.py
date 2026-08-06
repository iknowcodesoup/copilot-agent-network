from cachetools import LRUCache
from fastapi import APIRouter, Depends

from pythonapi.core.embeddings import EmbeddingClient
from pythonapi.core.vector_search import search_documents
from pythonapi.dependencies import (
    enforce_search_rate_limit,
    get_document_repository,
    get_embedding_client,
    get_embedding_index,
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
    cache: LRUCache = Depends(get_search_cache),
):
    results = await search_documents(
        repository,
        embedding_index,
        embedding_client,
        cache,
        search_request.query,
        search_request.top_k,
    )
    return SearchResponse(query=search_request.query, results=results)
