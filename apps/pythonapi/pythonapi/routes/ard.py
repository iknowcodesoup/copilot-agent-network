"""Agentic Resource Discovery: the publisher manifest and the registry API.

Two routers, because the two ARD roles live at different addresses.

`well_known_router` serves the publisher manifest. A well-known URI is defined
relative to the origin root (RFC 8615), so it cannot sit under `/api`.

`router` serves the registry, mounted under `/api/ard`. The repo already has a
document search at `/api/search`, and a second, unrelated search one path
segment away would be a trap for anyone reading the route table. A base path is
also the shape the conformance tool expects - its own example targets
`https://registry.example.com/api/ard`.

Thin by design: every decision lives in `core/ard_catalog.py`.

`response_model_exclude_none` is not cosmetic. A catalog entry MUST carry
exactly one of `url` or `data`, and a serialized `"data": null` reads as
present to a validator that tests for the key.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends

from pythonapi.core.ard_catalog import AgentCatalog
from pythonapi.dependencies import get_agent_catalog
from pythonapi.models.ard import (
    AgentListResponse,
    AiCatalog,
    ExploreRequest,
    ExploreResponse,
    SearchRequest,
    SearchResponse,
)

well_known_router = APIRouter(tags=["ARD"])
router = APIRouter(prefix="/ard", tags=["ARD"])


@well_known_router.get(
    "/.well-known/ai-catalog.json",
    response_model=AiCatalog,
    response_model_exclude_none=True,
    summary="ARD publisher manifest",
)
async def get_ai_catalog(
    catalog: AgentCatalog = Depends(get_agent_catalog),
) -> AiCatalog:
    """The static catalog of everything this deployment publishes."""
    return catalog.manifest


@router.get(
    "/agents",
    response_model=AgentListResponse,
    response_model_exclude_none=True,
    summary="Browse the catalog without ranking",
)
async def list_agents(
    catalog: AgentCatalog = Depends(get_agent_catalog),
) -> AgentListResponse:
    """Deterministic listing, the counterpart to ranked search.

    Optional in the spec. It is served anyway because the catalog is already
    in memory, and browsing is the honest answer to "what is there?" - a
    question ranked search answers only indirectly.
    """
    entries = catalog.entries
    return AgentListResponse(items=entries, total=len(entries))


@router.post(
    "/search",
    response_model=SearchResponse,
    response_model_exclude_none=True,
    summary="Rank the catalog against a natural-language query",
)
async def search_catalog(
    search_request: SearchRequest,
    catalog: AgentCatalog = Depends(get_agent_catalog),
) -> SearchResponse:
    """The one mandated registry endpoint.

    `federation` is read and only `none` is honoured. This registry answers
    for its own catalog: it publishes no referrals and calls no upstream.
    """
    results = await catalog.search(
        search_request.query, page_size=search_request.page_size
    )
    return SearchResponse(results=results)


@router.post(
    "/explore",
    response_model=ExploreResponse,
    response_model_exclude_none=True,
    summary="Facet counts over the catalog",
)
async def explore_catalog(
    explore_request: ExploreRequest,
    catalog: AgentCatalog = Depends(get_agent_catalog),
) -> ExploreResponse:
    """Introspection: how the catalog breaks down by a field."""
    facets, total = catalog.explore(
        explore_request.query,
        [facet.field for facet in explore_request.result_type.facets],
    )
    return ExploreResponse(facets=facets, total=total)
