import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, status

from pythonapi.dependencies import (
    get_document_repository,
    get_embedding_index,
    get_worker_pool,
)
from pythonapi.models.documents import (
    Document,
    DocumentStatus,
    DocumentSummary,
    DocumentUploadResponse,
)
from pythonapi.repositories.base import DocumentRepository
from pythonapi.repositories.qdrant import QdrantEmbeddingIndex
from pythonapi.workers.embedding_worker import EmbeddingWorkerPool

router = APIRouter(prefix="/documents", tags=["Documents"])


@router.post(
    "/upload",
    response_model=DocumentUploadResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
async def upload_document(
    file: UploadFile,
    repository: DocumentRepository = Depends(get_document_repository),
    worker_pool: EmbeddingWorkerPool = Depends(get_worker_pool),
):
    raw = await file.read()
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise HTTPException(
            status_code=400, detail="File must be UTF-8 encoded text"
        ) from exc

    if not text.strip():
        raise HTTPException(status_code=400, detail="File is empty")

    document_id = uuid.uuid4().hex
    document = Document(
        id=document_id,
        title=file.filename or document_id,
        content=text,
        status=DocumentStatus.PENDING,
    )
    await repository.save_document(document)
    await worker_pool.submit(document_id)

    return DocumentUploadResponse(id=document_id, status=document.status)


@router.get("", response_model=list[DocumentSummary])
async def list_documents(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    repository: DocumentRepository = Depends(get_document_repository),
):
    documents = await repository.list_documents(limit=limit, offset=offset)
    return [DocumentSummary.from_document(document) for document in documents]


@router.get("/{document_id}", response_model=DocumentSummary)
async def get_document(
    document_id: str,
    repository: DocumentRepository = Depends(get_document_repository),
):
    document = await repository.get_document(document_id)
    if document is None:
        raise HTTPException(status_code=404, detail="Document not found")
    return DocumentSummary.from_document(document)


@router.delete("/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_document(
    document_id: str,
    repository: DocumentRepository = Depends(get_document_repository),
    embedding_index: QdrantEmbeddingIndex = Depends(get_embedding_index),
):
    existed = await repository.delete_document(document_id)
    if not existed:
        raise HTTPException(status_code=404, detail="Document not found")
    await repository.delete_chunks_for_document(document_id)
    await embedding_index.delete_for_document(document_id)
