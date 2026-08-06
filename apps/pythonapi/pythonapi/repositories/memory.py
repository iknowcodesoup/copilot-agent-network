import asyncio

from pythonapi.models.documents import Chunk, Document


class InMemoryDocumentRepository:
    """Dict-backed DocumentRepository. Swap for a SQLite-backed implementation later."""

    def __init__(self) -> None:
        self._documents: dict[str, Document] = {}
        self._chunks: dict[str, list[Chunk]] = {}
        self._lock = asyncio.Lock()

    async def save_document(self, document: Document) -> None:
        async with self._lock:
            self._documents[document.id] = document

    async def update_document_if_exists(self, document: Document) -> bool:
        async with self._lock:
            if document.id not in self._documents:
                return False
            self._documents[document.id] = document
            return True

    async def get_document(self, document_id: str) -> Document | None:
        return self._documents.get(document_id)

    async def list_documents(self, limit: int = 50, offset: int = 0) -> list[Document]:
        ordered = sorted(
            self._documents.values(), key=lambda d: d.created_at, reverse=True
        )
        return ordered[offset : offset + limit]

    async def delete_document(self, document_id: str) -> bool:
        async with self._lock:
            existed = self._documents.pop(document_id, None) is not None
            self._chunks.pop(document_id, None)
            return existed

    async def save_chunks(self, chunks: list[Chunk]) -> None:
        if not chunks:
            return
        async with self._lock:
            self._chunks.setdefault(chunks[0].document_id, [])
            self._chunks[chunks[0].document_id].extend(chunks)

    async def get_chunks_for_document(self, document_id: str) -> list[Chunk]:
        return list(self._chunks.get(document_id, []))

    async def delete_chunks_for_document(self, document_id: str) -> None:
        async with self._lock:
            self._chunks.pop(document_id, None)

    async def get_chunks_by_ids(self, chunk_ids: list[str]) -> list[Chunk]:
        wanted = set(chunk_ids)
        return [
            chunk
            for chunks in self._chunks.values()
            for chunk in chunks
            if chunk.id in wanted
        ]
