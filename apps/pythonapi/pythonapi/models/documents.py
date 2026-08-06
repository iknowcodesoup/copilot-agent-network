"""Domain models for the document upload / chunk / search pipeline."""

from datetime import datetime, timezone
from enum import StrEnum

from pydantic import BaseModel, Field


class DocumentStatus(StrEnum):
    PENDING = "pending"
    PROCESSING = "processing"
    READY = "ready"
    FAILED = "failed"


class SparseVectorPayload(BaseModel):
    indices: list[int] = Field(default_factory=list)
    values: list[float] = Field(default_factory=list)


class Chunk(BaseModel):
    id: str
    document_id: str
    index: int
    text: str  # PII-masked; never raw PII
    headings: list[str] = Field(default_factory=list)
    page_no: int | None = None
    embedding: list[float] = Field(default_factory=list)
    sparse_embedding: SparseVectorPayload = Field(
        default_factory=lambda: SparseVectorPayload(indices=[], values=[])
    )


class Document(BaseModel):
    id: str
    title: str
    filename: str
    raw_content: bytes  # original upload bytes, kept for deferred Docling parse
    content: str = ""  # Docling full text, PII-masked, empty until PROCESSING completes
    status: DocumentStatus = DocumentStatus.PENDING
    chunk_count: int = 0
    error: str | None = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class DocumentSummary(BaseModel):
    id: str
    title: str
    status: DocumentStatus
    chunk_count: int
    error: str | None
    created_at: datetime

    @classmethod
    def from_document(cls, document: Document) -> "DocumentSummary":
        return cls(
            id=document.id,
            title=document.title,
            status=document.status,
            chunk_count=document.chunk_count,
            error=document.error,
            created_at=document.created_at,
        )


class DocumentUploadResponse(BaseModel):
    id: str
    status: DocumentStatus


class SearchRequest(BaseModel):
    query: str = Field(min_length=1)
    top_k: int = Field(default=5, ge=1, le=50)


class RagAnswer(BaseModel):
    is_answerable: bool
    answer: str
    confidence: float = Field(ge=0.0, le=1.0)


class SearchResultItem(BaseModel):
    document_id: str
    document_title: str
    chunk_index: int
    text: str  # PII-reconstituted before being returned
    score: float  # cross-encoder rerank score, not raw cosine similarity


class SearchResponse(BaseModel):
    query: str
    answer: RagAnswer
    results: list[SearchResultItem]
