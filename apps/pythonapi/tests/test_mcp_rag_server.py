"""The RAG MCP server: tool roster and each tool's behavior.

Uses the SDK's in-memory `Client(server)` harness (see `mcp.client`), which
exercises the real MCP request/response shapes without a network port.
"""

import pytest
from mcp.client import Client

from pythonapi.mcp_support.rag_server import build_rag_mcp_server
from pythonapi.mcp_support.tools import RagMcpTool
from pythonapi.models.documents import (
    Document,
    DocumentStatus,
    RagAnswer,
    SearchResponse,
    SearchResultItem,
)
from pythonapi.repositories.memory import InMemoryDocumentRepository


class _StubDependencies:
    """Stands in for the slice of app.state the RAG MCP tools read.

    Every attribute goes straight through to whatever the test patches, the
    same shape `test_research_agent.py`'s `_StubDependencies` uses.
    """

    def __init__(self, *, document_repository=None):
        self.document_repository = document_repository or InMemoryDocumentRepository()
        self.embedding_index = None
        self.embedding_client = None
        self.reranker = None
        self.pii_masker = None
        self.answer_generator = None
        self.search_cache = None


@pytest.fixture
def dependencies():
    return _StubDependencies()


@pytest.fixture
def server(dependencies):
    return build_rag_mcp_server(lambda: dependencies)


@pytest.mark.asyncio
async def test_registers_exactly_the_declared_tool_roster(server):
    """The single source of truth is `RagMcpTool` - this guards against the
    registration in rag_server.py and the roster in tools.py drifting apart,
    which would silently break the ARD entry's `capabilities` list too."""
    tools = await server.list_tools()

    assert sorted(tool.name for tool in tools) == sorted(
        tool.value for tool in RagMcpTool
    )


@pytest.mark.asyncio
async def test_search_documents_returns_scored_chunks(server, monkeypatch):
    result = SearchResultItem(
        document_id="doc-1",
        document_title="piper-training.md",
        chunk_index=0,
        text="Voice training needs clean single-speaker clips.",
        score=0.9,
    )

    async def fake_retrieve_documents(**kwargs):
        fake_retrieve_documents.kwargs = kwargs
        return [result]

    monkeypatch.setattr(
        "pythonapi.mcp_support.rag_server.retrieve_documents",
        fake_retrieve_documents,
    )

    async with Client(server) as client:
        response = await client.call_tool(
            RagMcpTool.SEARCH_DOCUMENTS.value, {"query": "training needs", "top_k": 3}
        )

    chunks = response.structured_content["result"]
    assert chunks == [result.model_dump()]
    assert fake_retrieve_documents.kwargs["query"] == "training needs"
    assert fake_retrieve_documents.kwargs["top_k"] == 3


@pytest.mark.asyncio
async def test_answer_question_reuses_the_research_agent_pipeline(server, monkeypatch):
    """Same pipeline call the Research A2A agent makes - see
    `RagResearchAgent.research`, which this tool wraps rather than
    duplicates."""
    response = SearchResponse(
        query="anything",
        answer=RagAnswer(is_answerable=True, answer="Clean clips.", confidence=0.8),
        results=[
            SearchResultItem(
                document_id="doc-1",
                document_title="piper-training.md",
                chunk_index=0,
                text="...",
                score=0.9,
            )
        ],
    )

    async def fake_search_and_generate(**kwargs):
        return response

    monkeypatch.setattr(
        "pythonapi.agents.research.rag_research_agent.search_and_generate",
        fake_search_and_generate,
    )

    async with Client(server) as client:
        result = await client.call_tool(
            RagMcpTool.ANSWER_QUESTION.value, {"question": "training needs?"}
        )

    body = result.structured_content
    assert body["answer"] == "Clean clips."
    assert body["sources"] == [{"document_id": "doc-1", "title": "piper-training.md"}]


@pytest.mark.asyncio
async def test_list_documents_reads_the_repository(dependencies, server):
    await dependencies.document_repository.save_document(
        Document(
            id="doc-1",
            title="piper-training.md",
            filename="piper-training.md",
            raw_content=b"x",
            status=DocumentStatus.READY,
            chunk_count=3,
        )
    )

    async with Client(server) as client:
        result = await client.call_tool(RagMcpTool.LIST_DOCUMENTS.value, {})

    documents = result.structured_content["result"]
    assert [document["id"] for document in documents] == ["doc-1"]


@pytest.mark.asyncio
async def test_get_document_returns_none_when_the_document_is_missing(server):
    async with Client(server) as client:
        result = await client.call_tool(
            RagMcpTool.GET_DOCUMENT.value, {"document_id": "missing"}
        )

    assert result.structured_content["result"] is None
