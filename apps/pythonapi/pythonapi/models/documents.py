"""Domain models for the document upload / chunk / search pipeline."""

from datetime import datetime, timezone
from enum import StrEnum

from pydantic import BaseModel, Field


class DocumentStatus(StrEnum):
    PENDING = "pending"
    PROCESSING = "processing"
    READY = "ready"
    FAILED = "failed"


class Chunk(BaseModel):
    id: str
    document_id: str
    index: int
    text: str
    embedding: list[float] = Field(default_factory=list)


class Document(BaseModel):
    id: str
    title: str
    content: str
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


class SearchResultItem(BaseModel):
    document_id: str
    document_title: str
    chunk_index: int
    text: str
    score: float


class SearchResponse(BaseModel):
    query: str
    results: list[SearchResultItem]
