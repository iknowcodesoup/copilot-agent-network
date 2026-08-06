from sqlalchemy import delete, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from pythonapi.models.documents import Chunk, Document, DocumentStatus
from pythonapi.models.orm import ChunkRow, DocumentRow


class PostgresDocumentRepository:
    """Postgres-backed DocumentRepository: the system of record for document
    and chunk metadata. Chunk embedding vectors are not stored here - see
    QdrantEmbeddingIndex - so rows never carry an embedding column."""

    def __init__(self, engine: AsyncEngine) -> None:
        self._engine = engine

    async def save_document(self, document: Document) -> None:
        stmt = insert(DocumentRow).values(
            id=document.id,
            title=document.title,
            filename=document.filename,
            raw_content=document.raw_content,
            content=document.content,
            status=document.status.value,
            chunk_count=document.chunk_count,
            error=document.error,
            created_at=document.created_at,
        )
        stmt = stmt.on_conflict_do_update(
            index_elements=[DocumentRow.id],
            set_={
                "title": stmt.excluded.title,
                # raw_content/filename intentionally excluded: immutable post-upload.
                "content": stmt.excluded.content,
                "status": stmt.excluded.status,
                "chunk_count": stmt.excluded.chunk_count,
                "error": stmt.excluded.error,
            },
        )
        async with AsyncSession(self._engine) as session:
            await session.execute(stmt)
            await session.commit()

    async def update_document_if_exists(self, document: Document) -> bool:
        stmt = (
            update(DocumentRow)
            .where(DocumentRow.id == document.id)
            .values(
                title=document.title,
                content=document.content,
                status=document.status.value,
                chunk_count=document.chunk_count,
                error=document.error,
            )
        )
        async with AsyncSession(self._engine) as session:
            result = await session.execute(stmt)
            await session.commit()
        return result.rowcount > 0

    async def get_document(self, document_id: str) -> Document | None:
        stmt = select(DocumentRow).where(DocumentRow.id == document_id)
        async with AsyncSession(self._engine) as session:
            row = (await session.execute(stmt)).scalar_one_or_none()
        return self._document_from_row(row) if row else None

    async def list_documents(self, limit: int = 50, offset: int = 0) -> list[Document]:
        stmt = (
            select(DocumentRow)
            .order_by(DocumentRow.created_at.desc())
            .limit(limit)
            .offset(offset)
        )
        async with AsyncSession(self._engine) as session:
            rows = (await session.execute(stmt)).scalars().all()
        return [self._document_from_row(row) for row in rows]

    async def delete_document(self, document_id: str) -> bool:
        stmt = delete(DocumentRow).where(DocumentRow.id == document_id)
        async with AsyncSession(self._engine) as session:
            result = await session.execute(stmt)
            await session.commit()
        return result.rowcount > 0

    async def save_chunks(self, chunks: list[Chunk]) -> None:
        if not chunks:
            return
        stmt = insert(ChunkRow).values(
            [
                {
                    "id": chunk.id,
                    "document_id": chunk.document_id,
                    "chunk_index": chunk.index,
                    "text": chunk.text,
                    "headings": chunk.headings,
                    "page_no": chunk.page_no,
                }
                for chunk in chunks
            ]
        )
        stmt = stmt.on_conflict_do_update(
            index_elements=[ChunkRow.id],
            set_={
                "text": stmt.excluded.text,
                "headings": stmt.excluded.headings,
                "page_no": stmt.excluded.page_no,
            },
        )
        async with AsyncSession(self._engine) as session:
            await session.execute(stmt)
            await session.commit()

    async def get_chunks_for_document(self, document_id: str) -> list[Chunk]:
        stmt = (
            select(ChunkRow)
            .where(ChunkRow.document_id == document_id)
            .order_by(ChunkRow.chunk_index)
        )
        async with AsyncSession(self._engine) as session:
            rows = (await session.execute(stmt)).scalars().all()
        return [self._chunk_from_row(row) for row in rows]

    async def delete_chunks_for_document(self, document_id: str) -> None:
        stmt = delete(ChunkRow).where(ChunkRow.document_id == document_id)
        async with AsyncSession(self._engine) as session:
            await session.execute(stmt)
            await session.commit()

    async def get_chunks_by_ids(self, chunk_ids: list[str]) -> list[Chunk]:
        if not chunk_ids:
            return []
        stmt = select(ChunkRow).where(ChunkRow.id.in_(chunk_ids))
        async with AsyncSession(self._engine) as session:
            rows = (await session.execute(stmt)).scalars().all()
        return [self._chunk_from_row(row) for row in rows]

    @staticmethod
    def _document_from_row(row: DocumentRow) -> Document:
        return Document(
            id=row.id,
            title=row.title,
            filename=row.filename,
            raw_content=row.raw_content,
            content=row.content,
            status=DocumentStatus(row.status),
            chunk_count=row.chunk_count,
            error=row.error,
            created_at=row.created_at,
        )

    @staticmethod
    def _chunk_from_row(row: ChunkRow) -> Chunk:
        return Chunk(
            id=row.id,
            document_id=row.document_id,
            index=row.chunk_index,
            text=row.text,
            headings=row.headings or [],
            page_no=row.page_no,
        )
