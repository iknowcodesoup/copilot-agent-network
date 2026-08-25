"""Agentic Resource Discovery: the manifest, the registry, and the ranking.

The catalog now publishes both media types this deployment has: three A2A
agents (Orchestrator, Research, Voice) and one MCP server (RAG). That is what
makes the official conformance tool's `/search` probe - which filters for
`application/mcp-server-card+json` - a real check here instead of one that
matches nothing. See `test_search_filters_on_a_field_path`.

The ranking test is the CAP-8 success criterion, and it is a real comparison in
both directions: a voice question must rank the Voice Agent first, and a
documentation question must rank the Research Agent first. One direction alone
would pass with any constant ordering.
"""

import pytest

from pythonapi.config import settings
from pythonapi.core.ard_catalog import AgentCatalog, build_catalog
from pythonapi.core.embeddings import EmbeddingClient
from pythonapi.models.ard import (
    A2A_AGENT_CARD_MEDIA_TYPE,
    CATALOG_SPEC_VERSION,
    MAXIMUM_REPRESENTATIVE_QUERIES,
    MCP_SERVER_CARD_MEDIA_TYPE,
    MINIMUM_REPRESENTATIVE_QUERIES,
    CatalogQuery,
)

CATALOG_ENTRY_COUNT = 4

MANIFEST_PATH = "/.well-known/ai-catalog.json"
REGISTRY_PREFIX = "/api/ard"

VOICE_QUESTION = "why is my voice training slow"
RESEARCH_QUESTION = "search the documentation corpus for an answer with sources"


@pytest.fixture
def catalog():
    return AgentCatalog(embedding_client=EmbeddingClient(dim=settings.EMBEDDING_DIM))


def _entry_by_name(entries, display_name):
    return next(entry for entry in entries if entry.display_name == display_name)


def test_manifest_is_served_at_the_well_known_uri(client):
    response = client.get(MANIFEST_PATH)

    assert response.status_code == 200
    body = response.json()
    assert body["specVersion"] == CATALOG_SPEC_VERSION
    assert body["host"]["displayName"] == settings.ARD_PUBLISHER_DISPLAY_NAME
    assert len(body["entries"]) == CATALOG_ENTRY_COUNT


def test_manifest_has_only_the_three_root_properties(client):
    """The ai-catalog schema sets additionalProperties: false at the root."""
    body = client.get(MANIFEST_PATH).json()

    assert set(body) == {"specVersion", "host", "entries"}


def test_manifest_omits_the_deprecated_collections_property(client):
    """Top-level `collections` was removed in ADR-0003."""
    assert "collections" not in client.get(MANIFEST_PATH).json()


def test_every_entry_carries_exactly_one_of_url_or_data(client):
    """A serialized `"data": null` would read as present, so it must be absent."""
    for entry in client.get(MANIFEST_PATH).json()["entries"]:
        assert ("url" in entry) != ("data" in entry)


def test_entries_are_derived_from_the_agent_cards():
    """The catalog reads the cards; it never carries its own list of agents."""
    entries = build_catalog().entries
    voice = _entry_by_name(entries, "Voice Agent")

    assert voice.identifier == (
        f"urn:air:{settings.ARD_PUBLISHER_DOMAIN}:agent:voice-agent"
    )
    assert voice.type == A2A_AGENT_CARD_MEDIA_TYPE
    assert voice.url.endswith("/agents/voice/.well-known/agent-card.json")
    # Skill ids, straight off the card.
    assert "voice_status" in voice.capabilities


def test_orchestrator_entry_is_a_real_a2a_agent_marked_as_the_entry_point():
    """The Orchestrator's own A2A card, not a fabricated AG-UI stand-in."""
    entries = build_catalog().entries
    orchestrator = _entry_by_name(entries, "Orchestrator Agent")

    assert orchestrator.identifier == (
        f"urn:air:{settings.ARD_PUBLISHER_DOMAIN}:agent:orchestrator-agent"
    )
    assert orchestrator.type == A2A_AGENT_CARD_MEDIA_TYPE
    assert orchestrator.url.endswith("/agents/orchestrator/.well-known/agent-card.json")
    assert "assist" in orchestrator.capabilities
    assert orchestrator.metadata == {"role": "orchestrator"}


def test_mcp_server_entry_carries_data_instead_of_url():
    """No served card resource exists for `url` to point at - see the
    module docstring in core/ard_catalog.py."""
    entries = build_catalog().entries
    rag_server = _entry_by_name(entries, "RAG MCP Server")

    assert rag_server.identifier == (
        f"urn:air:{settings.ARD_PUBLISHER_DOMAIN}:server:rag-mcp-server"
    )
    assert rag_server.type == MCP_SERVER_CARD_MEDIA_TYPE
    assert rag_server.url is None
    assert rag_server.data["protocol"] == "mcp"
    assert "search_documents" in rag_server.capabilities
    assert "answer_question" in rag_server.capabilities


def test_representative_queries_stay_within_the_size_the_spec_asks_for():
    for entry in build_catalog().entries:
        assert (
            MINIMUM_REPRESENTATIVE_QUERIES
            <= len(entry.representative_queries)
            <= MAXIMUM_REPRESENTATIVE_QUERIES
        )


def test_search_ranks_the_voice_agent_first_for_a_voice_question(client):
    response = client.post(
        f"{REGISTRY_PREFIX}/search", json={"query": {"text": VOICE_QUESTION}}
    )

    assert response.status_code == 200
    results = response.json()["results"]
    assert [item["displayName"] for item in results][0] == "Voice Agent"
    assert results[0]["score"] > results[1]["score"]


def test_search_ranks_the_research_agent_first_for_a_documentation_question(client):
    """The other direction, so the ranking is not a fixed order in disguise."""
    response = client.post(
        f"{REGISTRY_PREFIX}/search", json={"query": {"text": RESEARCH_QUESTION}}
    )

    results = response.json()["results"]
    assert [item["displayName"] for item in results][0] == "Research Agent"


def test_a_search_result_is_a_flat_entry_with_score_and_source(client):
    """The conformance tool reads these keys off the result item itself."""
    results = client.post(
        f"{REGISTRY_PREFIX}/search", json={"query": {"text": VOICE_QUESTION}}
    ).json()["results"]

    for item in results:
        assert isinstance(item["score"], int)
        assert 0 <= item["score"] <= 100
        assert item["source"]
        assert item["identifier"] and item["displayName"] and item["type"]
        assert ("url" in item) != ("data" in item)


def test_search_filters_on_a_field_path(client):
    """The exact filter the official conformance tool's `/search` probe
    sends. It used to match nothing here, because the catalog held only A2A
    agents - see the module docstring. It now matches the RAG MCP server, so
    the probe's result-item assertions execute against real data."""
    response = client.post(
        f"{REGISTRY_PREFIX}/search",
        json={
            "query": {
                "text": "weather forecast tools",
                "filter": {"type": ["application/mcp-server-card+json"]},
            },
            "federation": "none",
            "pageSize": 2,
        },
    )

    assert response.status_code == 200
    results = response.json()["results"]
    assert [item["displayName"] for item in results] == ["RAG MCP Server"]
    assert results[0]["type"] == "application/mcp-server-card+json"


def test_search_honours_the_page_size(client):
    results = client.post(
        f"{REGISTRY_PREFIX}/search",
        json={"query": {"text": VOICE_QUESTION}, "pageSize": 1},
    ).json()["results"]

    assert len(results) == 1


def test_explore_returns_facet_counts(client):
    response = client.post(
        f"{REGISTRY_PREFIX}/explore",
        json={
            "query": {"text": "voice"},
            "resultType": {"facets": [{"field": "type"}]},
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["resultType"] == "facets"
    assert body["facets"]["type"] == {
        A2A_AGENT_CARD_MEDIA_TYPE: 3,
        MCP_SERVER_CARD_MEDIA_TYPE: 1,
    }


def test_agents_listing_is_paginated_in_shape(client):
    body = client.get(f"{REGISTRY_PREFIX}/agents").json()

    assert body["total"] == CATALOG_ENTRY_COUNT
    assert len(body["items"]) == CATALOG_ENTRY_COUNT


@pytest.mark.asyncio
async def test_search_falls_back_to_keywords_when_embedding_fails(catalog):
    """An optional backend degrades the ranking; it never fails the request."""

    class FailingEmbeddingClient:
        async def embed(self, text: str):
            raise RuntimeError("embedding backend is down")

    catalog._embedding_client = FailingEmbeddingClient()

    results = await catalog.search(CatalogQuery(text=VOICE_QUESTION), page_size=10)

    assert [item.display_name for item in results][0] == "Voice Agent"
    assert results[0].score > 0


@pytest.mark.asyncio
async def test_an_entry_that_matches_nothing_is_still_returned(catalog):
    """A zero score means "no match". Hiding the entry would mean "no agent"."""
    results = await catalog.search(
        CatalogQuery(text="zzzz quantum chromodynamics zzzz"), page_size=10
    )

    assert len(results) == CATALOG_ENTRY_COUNT
