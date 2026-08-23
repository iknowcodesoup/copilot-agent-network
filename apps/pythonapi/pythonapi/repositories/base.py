from datetime import UTC, datetime
from typing import Protocol

from pythonapi.models.documents import Chunk, Document


def utc_now() -> datetime:
    """Now, as naive UTC.

    Every datetime in a lease-bearing repository comes from here. The
    Postgres columns are TIMESTAMP WITHOUT TIME ZONE, so a stored value is
    always naive, and Python refuses to compare a naive datetime against an
    aware one. One helper is what keeps a single aware value from reaching a
    comparison.
    """
    return datetime.now(UTC).replace(tzinfo=None)


def resting_phase_values(resting_phases) -> list[str]:
    return [phase.value for phase in resting_phases]


def lease_is_free(leased_until_column):
    """No one holds this row, or whoever did has gone away."""
    now = utc_now()
    return (leased_until_column.is_(None)) | (leased_until_column < now)


class DocumentRepository(Protocol):
    """Storage contract for document/chunk relational metadata.

    Chunk embedding vectors are out of scope here - they live only in Qdrant
    (see repositories/qdrant.py's QdrantEmbeddingIndex). Kept async so
    PostgresDocumentRepository is a drop-in swap for
    InMemoryDocumentRepository without touching call sites.
    """

    async def save_document(self, document: Document) -> None: ...

    async def update_document_if_exists(self, document: Document) -> bool:
        """Write only if the id is still present. Guards background workers
        against resurrecting a document that was deleted mid-processing."""
        ...

    async def get_document(self, document_id: str) -> Document | None: ...

    async def list_documents(
        self, limit: int = 50, offset: int = 0
    ) -> list[Document]: ...

    async def delete_document(self, document_id: str) -> bool: ...

    async def save_chunks(self, chunks: list[Chunk]) -> None: ...

    async def get_chunks_for_document(self, document_id: str) -> list[Chunk]: ...

    async def delete_chunks_for_document(self, document_id: str) -> None: ...

    async def get_chunks_by_ids(self, chunk_ids: list[str]) -> list[Chunk]:
        """Batch lookup used to hydrate Qdrant search hits (which carry only
        chunk ids and scores) back into full Chunk records."""
        ...
