"""The RAG MCP server's tool roster: one source of truth.

The same shape as `agents/voice/interface.py`'s `VoiceSkill` enum: defined
once, then read by both the code that registers the tools
(`mcp_support/rag_server.py`) and the code that describes them in the ARD
catalog (`core/ard_catalog.py`). Neither carries its own copy of a tool's
name or description.
"""

from __future__ import annotations

from enum import StrEnum


class RagMcpTool(StrEnum):
    """The four read-only tools the RAG MCP server exposes.

    Write and delete are left out of this first version. They are Postgres
    and Qdrant mutations that need a permission model an MCP client does not
    have here - an unauthenticated tool call must never be able to change
    the corpus.
    """

    SEARCH_DOCUMENTS = "search_documents"
    ANSWER_QUESTION = "answer_question"
    LIST_DOCUMENTS = "list_documents"
    GET_DOCUMENT = "get_document"


RAG_MCP_TOOL_DESCRIPTIONS: dict[RagMcpTool, str] = {
    RagMcpTool.SEARCH_DOCUMENTS: (
        "Retrieve and rerank the document chunks most relevant to a query, "
        "with their scores. Returns chunks, not a generated answer."
    ),
    RagMcpTool.ANSWER_QUESTION: (
        "Answer a question from the indexed document corpus and cite the "
        "documents the answer came from."
    ),
    RagMcpTool.LIST_DOCUMENTS: "List the documents in the corpus.",
    RagMcpTool.GET_DOCUMENT: "Read one document's summary by its id.",
}
