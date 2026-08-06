"""SQLAlchemy ORM table definitions - the Postgres schema for document/chunk
metadata and orders. Chunk embedding vectors are out of scope here; those
live in Qdrant only (see repositories/qdrant.py).
"""

from datetime import datetime

from sqlalchemy import ForeignKey, Index, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class DocumentRow(Base):
    __tablename__ = "documents"

    id: Mapped[str] = mapped_column(primary_key=True)
    title: Mapped[str]
    content: Mapped[str]
    status: Mapped[str]
    chunk_count: Mapped[int] = mapped_column(default=0)
    error: Mapped[str | None]
    created_at: Mapped[datetime]


class ChunkRow(Base):
    __tablename__ = "chunks"
    __table_args__ = (Index("idx_chunks_document_id", "document_id"),)

    id: Mapped[str] = mapped_column(primary_key=True)
    document_id: Mapped[str] = mapped_column(
        ForeignKey("documents.id", ondelete="CASCADE")
    )
    chunk_index: Mapped[int]
    text: Mapped[str]


class OrderRow(Base):
    __tablename__ = "orders"

    id: Mapped[str] = mapped_column(primary_key=True)
    name: Mapped[str]
    item_id: Mapped[int]
    status: Mapped[str]
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
