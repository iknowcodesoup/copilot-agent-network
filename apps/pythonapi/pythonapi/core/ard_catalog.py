"""Build the ARD catalog from the Agent Cards, and rank a query against it.

The one rule that keeps this honest: **the catalog is derived from the Agent
Cards, never maintained beside them.** `agents/research/card.py` and
`agents/voice/card.py` already build real `AgentCard` objects, so this module
reads those objects. A second hand-written list of agents would drift from the
cards within a week, and drift is the exact failure ARD exists to prevent.

The field mapping falls out of the two specs with nothing hand-written:

| ARD entry field         | Source on the A2A `AgentCard`            |
| ----------------------- | ---------------------------------------- |
| `identifier`            | `urn:air:<publisher>:agent:<slug>`       |
| `displayName`           | `card.name`                              |
| `url`                   | the specialist's public card URL         |
| `capabilities`          | `[skill.id for skill in card.skills]`    |
| `representativeQueries` | flattened `skill.examples`               |

No HTTP lives here. The routes shape the request and response; this module
owns the catalog and the ranking.
"""

from __future__ import annotations

import logging
import math
import re
from collections import Counter
from typing import Any

from a2a.types import AgentCard

from pythonapi.agents.research.card import build_research_agent_card
from pythonapi.agents.voice.card import build_voice_agent_card
from pythonapi.config import settings
from pythonapi.core.embeddings import EmbeddingClient
from pythonapi.models.ard import (
    A2A_AGENT_CARD_MEDIA_TYPE,
    MAXIMUM_REPRESENTATIVE_QUERIES,
    AiCatalog,
    CatalogEntry,
    CatalogHost,
    CatalogQuery,
    SearchResultItem,
)

logger = logging.getLogger(__name__)

__all__ = ["AgentCatalog", "build_catalog", "build_catalog_entries"]

# The URN namespace segment for an agent. ARD identifiers are
# `urn:air:<publisher>:<namespace>:<name>`, and every entry here is an agent.
AGENT_URN_NAMESPACE = "agent"

# A card's `name` is prose ("Research Agent"). A URN name segment allows only
# letters, digits, dot, underscore and hyphen, so the name is slugified.
_NON_SLUG_CHARACTERS = re.compile(r"[^a-z0-9]+")

# The card is served relative to the agent's mount root by the A2A SDK.
AGENT_CARD_PATH = "/.well-known/agent-card.json"

_TOKEN_PATTERN = re.compile(r"[a-z0-9]+")


def _slugify(name: str) -> str:
    """Turn a card name into a URN-safe name segment."""
    return _NON_SLUG_CHARACTERS.sub("-", name.lower()).strip("-")


def _card_url(mount_path: str) -> str:
    """Where a mounted specialist publishes its Agent Card."""
    base = settings.PUBLIC_BASE_URL.rstrip("/")
    return f"{base}{mount_path.rstrip('/')}{AGENT_CARD_PATH}"


def _entry_from_card(card: AgentCard, *, card_url: str) -> CatalogEntry:
    """Project one Agent Card onto one ARD catalog entry.

    The entry carries a pointer, not a copy. `capabilities` lists the skill
    ids so a filter can select on them, but the authoritative description of
    each skill stays in the card at `url`.
    """
    representative_queries: list[str] = []
    tags: list[str] = []
    for skill in card.skills:
        representative_queries.extend(skill.examples or [])
        tags.extend(skill.tags or [])

    return CatalogEntry(
        identifier=(
            f"urn:air:{settings.ARD_PUBLISHER_DOMAIN}"
            f":{AGENT_URN_NAMESPACE}:{_slugify(card.name)}"
        ),
        display_name=card.name,
        type=A2A_AGENT_CARD_MEDIA_TYPE,
        url=card_url,
        description=card.description,
        # Deduplicated but order-preserving, so the list reads like the card.
        tags=list(dict.fromkeys(tags)) or None,
        capabilities=[skill.id for skill in card.skills] or None,
        # The spec asks for at most 5. A card with more examples than that is
        # trimmed rather than allowed to publish a non-conformant entry.
        representative_queries=(
            representative_queries[:MAXIMUM_REPRESENTATIVE_QUERIES] or None
        ),
        version=card.version,
    )


def build_catalog_entries() -> list[CatalogEntry]:
    """Every agent this deployment publishes, derived from its card."""
    return [
        _entry_from_card(
            build_research_agent_card(settings.research_agent_public_url),
            card_url=_card_url(settings.RESEARCH_AGENT_MOUNT_PATH),
        ),
        _entry_from_card(
            build_voice_agent_card(settings.voice_agent_public_url),
            card_url=_card_url(settings.VOICE_AGENT_MOUNT_PATH),
        ),
    ]


def build_catalog() -> AiCatalog:
    """The full published manifest."""
    return AiCatalog(
        host=CatalogHost(
            display_name=settings.ARD_PUBLISHER_DISPLAY_NAME,
            # A placeholder domain. The docs say so: this proves nothing about
            # who published the catalog, and pretending otherwise would be the
            # dishonest half of a trust claim we deliberately did not build.
            identifier=f"did:web:{settings.ARD_PUBLISHER_DOMAIN}",
        ),
        entries=build_catalog_entries(),
    )


def _tokenize(text: str) -> list[str]:
    return _TOKEN_PATTERN.findall(text.lower())


def _cosine_similarity(left: list[float], right: list[float]) -> float:
    if not left or not right or len(left) != len(right):
        return 0.0
    dot = sum(a * b for a, b in zip(left, right, strict=True))
    left_norm = math.sqrt(sum(a * a for a in left))
    right_norm = math.sqrt(sum(b * b for b in right))
    if left_norm == 0.0 or right_norm == 0.0:
        return 0.0
    return dot / (left_norm * right_norm)


def _to_score(similarity: float) -> int:
    """The spec reports `score` as an integer 0-100.

    Similarity can go negative, because the mock embedding signs each hashed
    feature. A negative match is no match, so the floor is 0.
    """
    return max(0, min(100, round(similarity * 100)))


def _entry_texts(entry: CatalogEntry) -> list[str]:
    """The texts a query is matched against.

    ARD says a registry builds its semantic index from `representativeQueries`,
    so those come first and are matched individually - a query is compared to
    one example, not to all of them blurred together. The description is the
    fallback for an entry that publishes no examples.
    """
    if entry.representative_queries:
        return list(entry.representative_queries)
    return [entry.description or entry.display_name]


def _keyword_score(query_text: str, entry: CatalogEntry) -> int:
    """Ranking without an embedding backend.

    Optional integrations degrade here the same way they do everywhere else in
    this service: `/search` answers with a worse ranking rather than failing.
    """
    query_tokens = set(_tokenize(query_text))
    if not query_tokens:
        return 0

    best = 0.0
    for text in _entry_texts(entry):
        candidate_tokens = set(_tokenize(text))
        if not candidate_tokens:
            continue
        overlap = len(query_tokens & candidate_tokens)
        best = max(best, overlap / len(query_tokens | candidate_tokens))

    # Skill ids and tags are single words that a person rarely types verbatim,
    # so they add a small nudge rather than competing with the examples.
    metadata_tokens = set(
        _tokenize(" ".join((entry.capabilities or []) + (entry.tags or [])))
    )
    if metadata_tokens & query_tokens:
        best = max(best, len(metadata_tokens & query_tokens) / len(query_tokens) * 0.5)
    return _to_score(best)


def _entry_field(entry: CatalogEntry, field_path: str) -> Any:
    """Read a filter's field path off an entry.

    Filter keys arrive in the wire spelling (`displayName`). The model keeps
    the Python spelling (`display_name`). Try the serialized form first, then
    the attribute, so both work.
    """
    serialized = entry.model_dump(by_alias=True, exclude_none=True)
    if field_path in serialized:
        return serialized[field_path]
    return getattr(entry, field_path, None)


def _matches_filter(entry: CatalogEntry, filters: dict[str, Any] | None) -> bool:
    """Every filter key must match. A list on either side means "any of"."""
    if not filters:
        return True

    for field_path, wanted in filters.items():
        actual = _entry_field(entry, field_path)
        if actual is None:
            return False

        wanted_values = wanted if isinstance(wanted, list) else [wanted]
        actual_values = actual if isinstance(actual, list) else [actual]
        if not set(map(str, wanted_values)) & set(map(str, actual_values)):
            return False
    return True


class AgentCatalog:
    """The ARD registry's view of this deployment's agents.

    Built once and held on `app.state`. The entries come from the cards at
    build time; the embeddings for each entry are computed on first use and
    kept, so a search does not re-embed the catalog on every request.

    Deliberately not backed by a Qdrant collection. Scoring two entries in
    memory is the same cosine arithmetic without an index to create, keep in
    sync, and fail on when Qdrant is not configured. Revisit if the catalog
    ever grows past a few dozen entries.
    """

    def __init__(
        self,
        *,
        entries: list[CatalogEntry] | None = None,
        embedding_client: EmbeddingClient | None = None,
    ) -> None:
        self.entries = entries if entries is not None else build_catalog_entries()
        self._embedding_client = embedding_client
        self._entry_vectors: dict[str, list[list[float]]] | None = None

    @property
    def manifest(self) -> AiCatalog:
        return AiCatalog(
            host=CatalogHost(
                display_name=settings.ARD_PUBLISHER_DISPLAY_NAME,
                identifier=f"did:web:{settings.ARD_PUBLISHER_DOMAIN}",
            ),
            entries=self.entries,
        )

    def filtered(self, query: CatalogQuery) -> list[CatalogEntry]:
        return [entry for entry in self.entries if _matches_filter(entry, query.filter)]

    async def _vectors_for(self, entry: CatalogEntry) -> list[list[float]]:
        """Embed one entry's match texts, once per process."""
        if self._entry_vectors is None:
            self._entry_vectors = {}
        cached = self._entry_vectors.get(entry.identifier)
        if cached is not None:
            return cached

        vectors = [
            await self._embedding_client.embed(text) for text in _entry_texts(entry)
        ]
        self._entry_vectors[entry.identifier] = vectors
        return vectors

    async def _semantic_score(self, query_text: str, entry: CatalogEntry) -> int:
        query_vector = await self._embedding_client.embed(query_text)
        best = max(
            (
                _cosine_similarity(query_vector, vector)
                for vector in await self._vectors_for(entry)
            ),
            default=0.0,
        )
        return _to_score(best)

    async def search(
        self, query: CatalogQuery, *, page_size: int
    ) -> list[SearchResultItem]:
        """Rank the catalog against one natural-language query.

        An entry that survives the filter is always returned, even at score 0.
        A registry that hides a zero-scoring entry gives a caller no way to
        tell "no match" from "no such agent".
        """
        candidates = self.filtered(query)
        query_text = (query.text or "").strip()

        scores: dict[str, int] = {}
        if query_text:
            scores = await self._score_all(query_text, candidates)

        results = [
            SearchResultItem(
                **entry.model_dump(),
                score=scores.get(entry.identifier, 0),
                source=settings.ARD_PUBLISHER_DOMAIN,
            )
            for entry in candidates
        ]
        results.sort(key=lambda item: (-item.score, item.display_name))
        return results[:page_size]

    async def _score_all(
        self, query_text: str, candidates: list[CatalogEntry]
    ) -> dict[str, int]:
        if self._embedding_client is not None:
            try:
                return {
                    entry.identifier: await self._semantic_score(query_text, entry)
                    for entry in candidates
                }
            except Exception:
                # The embedding backend is optional here, exactly as it is for
                # the rest of the service. Log it and rank on keywords instead
                # of failing a discovery request.
                logger.warning(
                    "ARD search fell back to keyword ranking: embedding failed",
                    exc_info=True,
                )
        return {
            entry.identifier: _keyword_score(query_text, entry) for entry in candidates
        }

    def explore(
        self, query: CatalogQuery, facet_fields: list[str]
    ) -> tuple[dict[str, dict[str, int]], int]:
        """Count the matching entries by each requested field."""
        candidates = self.filtered(query)

        facets: dict[str, dict[str, int]] = {}
        for field_path in facet_fields:
            counter: Counter[str] = Counter()
            for entry in candidates:
                value = _entry_field(entry, field_path)
                if value is None:
                    continue
                for item in value if isinstance(value, list) else [value]:
                    counter[str(item)] += 1
            facets[field_path] = dict(counter)
        return facets, len(candidates)
