import asyncio
import logging

from pythonapi.core.chunking import chunk_text
from pythonapi.core.embeddings import EmbeddingAPIError, EmbeddingClient
from pythonapi.models.documents import Chunk, DocumentStatus
from pythonapi.repositories.base import DocumentRepository
from pythonapi.repositories.qdrant import QdrantEmbeddingIndex

logger = logging.getLogger("uvicorn")


class EmbeddingWorkerPool:
    """Decouples upload (fast, synchronous ack) from chunk+embed (slow, async).

    A pool of asyncio tasks consumes document ids from a queue, producer/consumer
    style, so /documents can return 202 immediately while work happens in the
    background.
    """

    def __init__(
        self,
        repository: DocumentRepository,
        embedding_client: EmbeddingClient,
        embedding_index: QdrantEmbeddingIndex,
        num_workers: int,
        chunk_max_chars: int,
        chunk_overlap_chars: int,
    ) -> None:
        self.repository = repository
        self.embedding_client = embedding_client
        self.embedding_index = embedding_index
        self.num_workers = num_workers
        self.chunk_max_chars = chunk_max_chars
        self.chunk_overlap_chars = chunk_overlap_chars
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
            texts = chunk_text(
                document.content, self.chunk_max_chars, self.chunk_overlap_chars
            )
            chunks = []
            for index, text in enumerate(texts):
                embedding = await self.embedding_client.embed(text)
                chunks.append(
                    Chunk(
                        id=f"{document_id}:{index}",
                        document_id=document_id,
                        index=index,
                        text=text,
                        embedding=embedding,
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

        await self.repository.update_document_if_exists(document)
