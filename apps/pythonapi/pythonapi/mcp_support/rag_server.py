"""The RAG MCP server: the tools, no transport.

Each tool wraps an existing, already-tested code path rather than adding a
new one. `answer_question` reuses `RagResearchAgent`, the same skill the
Research Agent runs over A2A - an MCP client and an A2A caller get the same
answer for the same question, from one implementation. `search_documents`
reuses `retrieve_documents`. `list_documents`/`get_document` read the
`DocumentRepository` directly, the same repository `routes/documents.py`
reads.

Dependencies are resolved per call, not captured at construction, for the
same reason `RagResearchAgent` does it: this is built while routes are being
registered, before `lifespan()` has populated `app.state`.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from mcp.server import MCPServer

from pythonapi.agents.research.interface import ResearchQuestion
from pythonapi.agents.research.rag_research_agent import (
    RagDependencies,
    RagResearchAgent,
)
from pythonapi.config import settings
from pythonapi.core.rag_pipeline import retrieve_documents
from pythonapi.mcp_support.tools import RAG_MCP_TOOL_DESCRIPTIONS, RagMcpTool
from pythonapi.models.documents import DocumentSummary

MCP_SERVER_NAME = "RAG MCP Server"
MCP_SERVER_DESCRIPTION = (
    "Read-only retrieval and generation over the indexed document corpus."
)


def build_rag_mcp_server(
    dependencies_provider: Callable[[], RagDependencies],
) -> MCPServer:
    """Build the RAG MCP server and register its four tools."""
    mcp = MCPServer(MCP_SERVER_NAME, instructions=MCP_SERVER_DESCRIPTION)
    research_agent = RagResearchAgent(dependencies_provider)

    @mcp.tool(
        name=RagMcpTool.SEARCH_DOCUMENTS.value,
        description=RAG_MCP_TOOL_DESCRIPTIONS[RagMcpTool.SEARCH_DOCUMENTS],
    )
    async def search_documents(query: str, top_k: int = 5) -> list[dict]:
        dependencies = dependencies_provider()
        results = await retrieve_documents(
            repository=dependencies.document_repository,
            embedding_index=dependencies.embedding_index,
            embedding_client=dependencies.embedding_client,
            reranker=dependencies.reranker,
            pii_masker=dependencies.pii_masker,
            query=query,
            top_k=top_k,
            prefetch_limit=max(top_k, settings.RETRIEVAL_PREFETCH_LIMIT),
        )
        return [result.model_dump() for result in results]

    @mcp.tool(
        name=RagMcpTool.ANSWER_QUESTION.value,
        description=RAG_MCP_TOOL_DESCRIPTIONS[RagMcpTool.ANSWER_QUESTION],
    )
    async def answer_question(question: str) -> dict[str, Any]:
        answer = await research_agent.research(ResearchQuestion(question=question))
        return answer.model_dump()

    @mcp.tool(
        name=RagMcpTool.LIST_DOCUMENTS.value,
        description=RAG_MCP_TOOL_DESCRIPTIONS[RagMcpTool.LIST_DOCUMENTS],
    )
    async def list_documents(limit: int = 50, offset: int = 0) -> list[dict]:
        repository = dependencies_provider().document_repository
        documents = await repository.list_documents(limit=limit, offset=offset)
        return [
            DocumentSummary.from_document(document).model_dump()
            for document in documents
        ]

    @mcp.tool(
        name=RagMcpTool.GET_DOCUMENT.value,
        description=RAG_MCP_TOOL_DESCRIPTIONS[RagMcpTool.GET_DOCUMENT],
    )
    async def get_document(document_id: str) -> dict | None:
        repository = dependencies_provider().document_repository
        document = await repository.get_document(document_id)
        if document is None:
            return None
        return DocumentSummary.from_document(document).model_dump()

    return mcp
