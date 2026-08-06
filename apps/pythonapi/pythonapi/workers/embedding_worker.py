import asyncio
import logging

from docling.chunking import HybridChunker
from docling.document_converter import DocumentConverter

from pythonapi.core.document_parsing import DoclingParseError, parse_document_bytes
from pythonapi.core.embeddings import EmbeddingAPIError, EmbeddingClient
from pythonapi.core.pii import PiiMasker, PiiMaskingError
from pythonapi.models.documents import Chunk, DocumentStatus
from pythonapi.repositories.base import DocumentRepository
from pythonapi.repositories.qdrant import QdrantEmbeddingIndex

logger = logging.getLogger("uvicorn")


class EmbeddingWorkerPool:
    """Decouples upload (fast, synchronous ack) from parse+mask+embed (slow,
    async).

    A pool of asyncio tasks consumes document ids from a queue, producer/consumer
    style, so /documents can return 202 immediately while work happens in the
    background.
    """

    def __init__(
        self,
        repository: DocumentRepository,
        embedding_client: EmbeddingClient,
        embedding_index: QdrantEmbeddingIndex,
        document_converter: DocumentConverter,
        hybrid_chunker: HybridChunker,
        pii_masker: PiiMasker | None,
        num_workers: int,
    ) -> None:
        self.repository = repository
        self.embedding_client = embedding_client
        self.embedding_index = embedding_index
        self.document_converter = document_converter
        self.hybrid_chunker = hybrid_chunker
        self.pii_masker = pii_masker
        self.num_workers = num_workers
        # Docling's thread-safety under concurrent calls from multiple worker
        # tasks against a shared converter/chunker instance is unconfirmed;
        # serialize parsing across workers as a safe default (it's the rare/
        # slow step anyway).
        self._docling_lock = asyncio.Lock()
        self._queue: asyncio.Queue[str | None] = asyncio.Queue()
        self._tasks: list[asyncio.Task] = []

    def start(self) -> None:
        self._tasks = [
            asyncio.create_task(self._worker_loop()) for _ in range(self.num_workers)
        ]

    async def submit(self, document_id: str) -> None:
        await self._queue.put(document_id)

    async def wait_idle(self) -> None:
        """Block until every submitted job so far has been processed. Handy in tests."""
        await self._queue.join()

    async def shutdown(self) -> None:
        await self._queue.join()
        for _ in self._tasks:
            await self._queue.put(None)  # poison pill per worker
        await asyncio.gather(*self._tasks)
        self._tasks = []

    async def _worker_loop(self) -> None:
        while True:
            document_id = await self._queue.get()
            if document_id is None:
                self._queue.task_done()
                break
            try:
                await self._process(document_id)
            except Exception:
                logger.exception("Unhandled error processing document %s", document_id)
            finally:
                self._queue.task_done()

    async def _process(self, document_id: str) -> None:
        document = await self.repository.get_document(document_id)
        if document is None:
            return

        document.status = DocumentStatus.PROCESSING
        if not await self.repository.update_document_if_exists(document):
            return  # deleted before processing could start

        try:
            async with self._docling_lock:
                parsed = await asyncio.to_thread(
                    parse_document_bytes,
                    self.document_converter,
                    self.hybrid_chunker,
                    document.raw_content,
                    document.filename,
                )

            full_text = parsed.full_text
            if self.pii_masker is not None:
                full_text = await self.pii_masker.mask(full_text)
            document.content = full_text

            chunks: list[Chunk] = []
            for index, parsed_chunk in enumerate(parsed.chunks):
                text = parsed_chunk.text
                if self.pii_masker is not None:
                    text = await self.pii_masker.mask(text)

                embedding = await self.embedding_client.embed(text)
                sparse_embedding = await self.embedding_client.embed_sparse(text)
                chunks.append(
                    Chunk(
                        id=f"{document_id}:{index}",
                        document_id=document_id,
                        index=index,
                        text=text,
                        headings=parsed_chunk.headings,
                        page_no=parsed_chunk.page_no,
                        embedding=embedding,
                        sparse_embedding=sparse_embedding,
                    )
                )
            await self.repository.save_chunks(chunks)
            await self.embedding_index.upsert(chunks)
            document.status = DocumentStatus.READY
            document.chunk_count = len(chunks)
            document.error = None
        except EmbeddingAPIError as exc:
            # Expected provider failure after retries are exhausted: a legitimate
            # "failed" document state, not a bug. Anything else propagates to
            # _worker_loop's catch-all instead of being mislabeled as this.
            document.status = DocumentStatus.FAILED
            document.error = str(exc)
        except DoclingParseError as exc:
            document.status = DocumentStatus.FAILED
            document.error = f"document parsing failed: {exc}"
        except PiiMaskingError as exc:
            document.status = DocumentStatus.FAILED
            document.error = f"PII masking failed: {exc}"

        await self.repository.update_document_if_exists(document)
