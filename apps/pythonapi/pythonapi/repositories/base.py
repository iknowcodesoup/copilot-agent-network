from typing import Protocol

from pythonapi.models.documents import Chunk, Document


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
