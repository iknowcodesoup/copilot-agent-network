"""Wire models for Agentic Resource Discovery (ARD).

Target spec revision: `ards-project/ard-spec` commit `1d25abc`, read
2026-08-23. The document is a draft with Proposal status, so pin the revision
and change it deliberately. The manifest's own `specVersion` value is a
separate number: the schema fixes it at "1.0".

ARD is a wire protocol and speaks camelCase. The rest of this service speaks
snake_case. Rather than keep two spellings of every field by hand, the models
carry `to_camel` as an alias generator, so Python reads `display_name` and the
JSON reads `displayName` from one declaration.

`exclude_none` is load-bearing on every response. A catalog entry MUST carry
exactly one of `url` or `data`, and a serialized `"data": null` still counts as
present to a validator that tests for the key.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

# The two media types this catalog publishes. An a2a-agent-card entry points
# at a real A2A Agent Card, which is what holds its capabilities - an ARD
# entry never restates them. An mcp-server-card entry carries its descriptor
# inline in `data` instead: the MCP protocol has no served JSON resource for
# `url` to point at, only a runtime handshake over its own transport.
A2A_AGENT_CARD_MEDIA_TYPE = "application/a2a-agent-card+json"
MCP_SERVER_CARD_MEDIA_TYPE = "application/mcp-server-card+json"

# Fixed by the ai-catalog schema, which declares specVersion as an enum of
# exactly this value. It is not the spec document's draft number.
CATALOG_SPEC_VERSION = "1.0"

# The spec asks for 2-5 representative queries per entry: too few and the
# semantic index has nothing to match, too many and one entry drowns the rest.
MINIMUM_REPRESENTATIVE_QUERIES = 2
MAXIMUM_REPRESENTATIVE_QUERIES = 5


class ArdModel(BaseModel):
    """Base for every ARD wire model: camelCase out, either spelling in."""

    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
    )


class CatalogHost(ArdModel):
    """Who publishes this catalog.

    `identifier` is a `did:web:` anchored on the publisher domain. This
    deployment uses a placeholder domain, so the binding proves nothing. That
    is stated rather than hidden - a faked trust anchor is worse than none.
    """

    display_name: str
    identifier: str | None = None


class CatalogEntry(ArdModel):
    """One discoverable resource.

    Derived from an A2A Agent Card, never written by hand. `url` points at the
    card itself, so a caller that wants capabilities reads the card and gets
    the live answer instead of this catalog's copy of it.
    """

    identifier: str
    display_name: str
    type: str = A2A_AGENT_CARD_MEDIA_TYPE
    url: str | None = None
    data: dict[str, Any] | None = None
    description: str | None = None
    tags: list[str] | None = None
    capabilities: list[str] | None = None
    representative_queries: list[str] | None = None
    version: str | None = None
    updated_at: str | None = None
    metadata: dict[str, Any] | None = None


class AiCatalog(ArdModel):
    """The published manifest served at `/.well-known/ai-catalog.json`.

    The schema sets `additionalProperties: false` at the root, so these three
    fields are the whole document. Do not add a field here without checking
    the schema first.
    """

    spec_version: Literal["1.0"] = CATALOG_SPEC_VERSION
    host: CatalogHost
    entries: list[CatalogEntry] = Field(default_factory=list)


class CatalogQuery(ArdModel):
    """The shared query object used by both `/search` and `/explore`.

    `filter` keys are field paths into a catalog entry. A list value matches
    any member; a scalar matches equality.
    """

    text: str | None = None
    filter: dict[str, Any] | None = None


class SearchRequest(ArdModel):
    """A ranked-discovery request.

    `federation` is accepted and only `none` is honoured. This registry
    answers for its own catalog and calls no upstream - a recorded non-goal,
    not a gap.
    """

    query: CatalogQuery = Field(default_factory=CatalogQuery)
    federation: Literal["none", "local", "all"] = "none"
    page_size: int = Field(default=10, ge=1, le=100)
    page_token: str | None = None


class SearchResultItem(CatalogEntry):
    """A catalog entry plus its ranking.

    The entry fields sit at the top level beside `score` and `source`; they are
    not nested under a child object. `score` is an integer 0-100.
    """

    score: int = Field(ge=0, le=100)
    source: str


class SearchResponse(ArdModel):
    results: list[SearchResultItem] = Field(default_factory=list)
    next_page_token: str | None = None


class FacetRequest(ArdModel):
    field: str


class ExploreResultType(ArdModel):
    facets: list[FacetRequest] = Field(default_factory=list)


class ExploreRequest(ArdModel):
    query: CatalogQuery = Field(default_factory=CatalogQuery)
    result_type: ExploreResultType = Field(default_factory=ExploreResultType)
    order_by: str | None = None
    page_size: int = Field(default=20, ge=1, le=100)
    page_token: str | None = None


class ExploreResponse(ArdModel):
    """Facet counts for the matching entries.

    `result_type` is the string "facets", not an object - it names the shape
    of the answer, where the request used the same key to ask for it.
    """

    result_type: Literal["facets"] = "facets"
    facets: dict[str, dict[str, int]] = Field(default_factory=dict)
    total: int = 0


class AgentListResponse(ArdModel):
    """Deterministic browsing, the optional counterpart to ranked search."""

    items: list[CatalogEntry] = Field(default_factory=list)
    next_page_token: str | None = None
    total: int = 0
