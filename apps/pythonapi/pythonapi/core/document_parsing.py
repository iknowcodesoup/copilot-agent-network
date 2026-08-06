"""Layout-aware document parsing via Docling.

DocumentConverter/HybridChunker load real model weights and are expensive to
construct - build them ONCE at startup (main.py lifespan) via
build_document_converter()/build_hybrid_chunker() and reuse across every
upload. parse_document_bytes() itself is synchronous/CPU-bound; callers must
run it through asyncio.to_thread (see workers/embedding_worker.py).
"""

import io
from dataclasses import dataclass

from docling.chunking import HybridChunker
from docling.datamodel.base_models import DocumentStream, InputFormat
from docling.datamodel.pipeline_options import PdfPipelineOptions
from docling.document_converter import DocumentConverter, PdfFormatOption
from docling_core.transforms.chunker.tokenizer.base import BaseTokenizer


class DoclingParseError(Exception):
    """Raised when Docling fails to convert or chunk an uploaded document."""


class _ApproximateTokenizer(BaseTokenizer):
    """HybridChunker's default tokenizer downloads a real HF tokenizer at
    construction time (sentence-transformers/all-MiniLM-L6-v2), which would
    make every app startup - including every pytest run - require network
    access. This is a zero-dependency stand-in: a character-count heuristic
    is more than accurate enough for chunk-size budgeting."""

    max_tokens: int = 512

    def count_tokens(self, text: str) -> int:
        return max(1, len(text) // 4)

    def get_max_tokens(self) -> int:
        return self.max_tokens

    def get_tokenizer(self) -> None:
        return None


@dataclass(frozen=True)
class ParsedChunk:
    text: str  # headings-contextualized (chunker.contextualize()), pre-PII-masking
    headings: list[str]
    page_no: int | None


@dataclass(frozen=True)
class ParsedDocument:
    full_text: str
    chunks: list[ParsedChunk]


def build_document_converter() -> DocumentConverter:
    pipeline_options = PdfPipelineOptions(generate_picture_images=True)
    pdf_option = PdfFormatOption(pipeline_options=pipeline_options)
    return DocumentConverter(format_options={InputFormat.PDF: pdf_option})


def build_hybrid_chunker() -> HybridChunker:
    return HybridChunker(tokenizer=_ApproximateTokenizer())


def parse_document_bytes(
    converter: DocumentConverter,
    chunker: HybridChunker,
    raw: bytes,
    filename: str,
) -> ParsedDocument:
    """Synchronous, CPU-bound. Callers MUST run this via asyncio.to_thread."""
    try:
        source = DocumentStream(name=filename, stream=io.BytesIO(raw))
        document = converter.convert(source).document
        chunks = [
            ParsedChunk(
                text=chunker.contextualize(chunk),
                headings=list(chunk.meta.headings or []),
                page_no=_first_page_no(chunk),
            )
            for chunk in chunker.chunk(document)
        ]
        return ParsedDocument(full_text=document.export_to_text(), chunks=chunks)
    except Exception as exc:
        raise DoclingParseError(str(exc)) from exc


def _first_page_no(chunk) -> int | None:
    for item in chunk.meta.doc_items:
        for prov in item.prov:
            return prov.page_no
    return None
