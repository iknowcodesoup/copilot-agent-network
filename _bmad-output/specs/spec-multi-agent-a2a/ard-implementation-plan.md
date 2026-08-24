# CAP-8 — ARD publisher and registry

Implementation plan for Agentic Resource Discovery in `pythonapi`.

**Target spec revision:** `ards-project/ard-spec` commit
`1d25abcf07e081f604dba3ae5398b16c79f20b7b`, read 2026-08-23. The repo also
carries `spec/ard-v0.91-draft.md`, so the document itself has moved past v0.9.
The manifest's own `specVersion` is a separate number that the schema fixes at
`"1.0"`. The spec is still a draft: pin the commit and change it deliberately.

---

## What ARD is, in one paragraph

ARD defines two roles. A **publisher** hosts a static `ai-catalog` JSON
manifest that lists its agentic resources. A **registry** indexes catalogs and
answers `POST /search` and `POST /explore`. An ARD entry does not contain the
agent's capabilities. It carries a `type` and a `url` that point at the real
artifact — for us, `application/a2a-agent-card+json` pointing at an A2A Agent
Card. So ARD sits above the Agent Card. It never replaces it.

```mermaid
flowchart LR
    CLIENT[Any ARD client] -->|POST /search| REG["ARD registry<br/>routes/ard.py"]
    CLIENT -->|GET| WK["/.well-known/ai-catalog.json"]
    REG --> CAT["AgentCatalog<br/>core/ard_catalog.py"]
    WK --> CAT
    CAT -->|derives entries from| CARDS["research/card.py<br/>voice/card.py"]
    CARDS -->|same objects| A2A["Mounted A2A endpoints"]
    DIR["SpecialistDirectory"] -->|configured URL, unchanged| A2A
```

## The one rule that keeps this honest

**The catalog is derived from the Agent Cards, never hand-maintained beside
them.** `agents/research/card.py` and `agents/voice/card.py` already build
real `AgentCard` objects. The catalog builder reads those objects. A second
hand-written list of agents would drift from the cards within a week, and
drift is the exact failure ARD exists to prevent.

The field mapping falls out cleanly:

| ARD entry field         | Source on the A2A `AgentCard`                   |
| ----------------------- | ----------------------------------------------- |
| `identifier`            | `urn:air:<publisher>:agent:<card.name>`         |
| `displayName`           | `card.name`                                     |
| `type`                  | `application/a2a-agent-card+json` (constant)    |
| `url`                   | the specialist's public card URL                |
| `description`           | `card.description`                              |
| `capabilities`          | `[skill.id for skill in card.skills]`           |
| `representativeQueries` | flattened `skill.examples` across skills        |
| `version`               | `card.version`                                  |

`AgentSkill.examples` is already part of the A2A card schema and already
carries natural-language examples. ARD's `representativeQueries` wants exactly
that, and says SHOULD contain 2–5. So the two specs line up with no new
hand-written data.

**Verified 2026-08-23.** Both cards populate `examples`. The Research card
carries 2. The Voice card carries 5 across its 4 skills, and the
`voice_status` skill already includes *"Why is my training run slow?"* — the
spec's own success-signal question. So the reference case can be proven
through `/search` ranking, not asserted.

## Ranking

ARD says registries use `representativeQueries` to build semantic embeddings
for search ranking. The repo already has `core/embeddings.py` and Qdrant.

**Do not create a Qdrant collection for two entries.** Embed the queries with
the existing embedding function and score cosine similarity in memory. It is
the same algorithm without the index, and it keeps the registry working when
Qdrant is not configured. Revisit only if the catalog grows past a few dozen
entries. `score` is reported 0–100 per the spec examples.

Fall back to keyword overlap on `capabilities` and `tags` when the embedding
backend is unavailable, so `/search` degrades instead of failing — the same
rule the rest of the service follows for optional integrations.

## Endpoints

| Route                               | Purpose                                     |
| ----------------------------------- | ------------------------------------------- |
| `GET /.well-known/ai-catalog.json`  | Static publisher manifest                   |
| `POST /api/ard/search`              | Ranked results for a natural-language query |
| `POST /api/ard/explore`             | Registry introspection, filters and facets  |

**Verified 2026-08-23 — the registry needs a base path.** `routes/search.py`
already mounts `APIRouter(prefix="/search")` under `APIRouter(prefix="/api")`,
so the existing document search lives at `/api/search`. A bare `/search` at
the app root would not technically collide, but two unrelated search endpoints
one path segment apart is a trap. `/api/ard` keeps the repo's `/api`
convention, and the ARD conformance tool's own README example targets
`https://registry.example.com/api/ard`, so a base path is the expected shape.

The manifest is a well-known URI and must stay at the true root. It cannot sit
under `/api`.

Shared `query` object: `{text, filter}`. `filter` keys are field paths into
the catalog entry. `/search` adds `federation` and pagination; `/explore` adds
`orderBy` and facets. Defaults per spec: `/search` `pageSize` 10 (max 100),
`/explore` `pageSize` 20 (max 100).

`federation` is accepted and `none` is honoured. We publish no referrals and
call no upstream registry — that is a recorded non-goal, not an omission.

## Layering

Follows the existing rule, `routes/` → `core/` → `repositories/`.

- `core/ard_catalog.py` — builds entries from the cards, ranks a query.
  No HTTP.
- `models/ard.py` — Pydantic models for the manifest, entry, and the search
  and explore request/response shapes.
- `routes/ard.py` — the three endpoints. Thin, delegates to core.
- `config.py` — `ARD_PUBLISHER_DOMAIN` (placeholder default),
  `ARD_ENABLED` (default true), `ARD_SEARCH_PAGE_SIZE_DEFAULT`.
  Real defaults, never a bare `None`.

`SpecialistDirectory` is **not** changed by this work. It keeps resolving
specialists from configured URLs. ARD is the outward-facing catalog; the
directory is the inward delegation path. Wiring the directory to consume ARD
would add a second staleness problem on top of the one already open in the
card cache, and buys nothing while the agent set is fixed at two.

## What proves this works

**`tests/test_ard.py` is the evidence, not the official CLI.** The spec ships
`conformance/bin/conformance-test`, a zero-dependency Python 3 script
(confirmed 2026-08-23 - no toolchain needed, so it *could* run in CI). Its
manifest mode is a real, independent check and it passes: JSON Schema draft
2020-12, the URN pattern, value-or-reference exclusivity, the
`representativeQueries` size, all validated against our two real entries.

Its **registry mode does not count as evidence here**, and is not treated as
one. Read its source rather than assuming from a green summary line:

```python
mock_search_query = {
    "query": {"text": "weather forecast tools",
              "filter": {"type": ["application/mcp-server-card+json"]}}
}
...
for idx, item in enumerate(results):   # every real assertion lives in here
    score = item.get("score")
    if not isinstance(score, int): ...
```

The filter is hardcoded to the spec's own sample catalog, a fictional weather
MCP server we do not run and have no reason to run (MCP is out of scope for
this capability - see Constraints). Our catalog holds only
`application/a2a-agent-card+json` entries, so the filter matches nothing, the
`for` loop body never executes, and the tool prints `PASS` having checked
nothing about our result shape. Do not report that PASS as proof of anything
beyond "the endpoint returns HTTP 200 with a `results` key."

So `tests/test_ard.py` carries the real assertions instead, run against real
catalog data with no filter:

- A search result is **flat**: `score` and `source` sit beside `identifier`,
  `displayName`, `type` and `url`, not nested under a child.
- `score` is a Python `int` 0-100, asserted with `isinstance`.
- `/explore` returns `resultType` as the literal string `"facets"`.
- The manifest carries exactly `specVersion`, `host`, `entries` - nothing else.
- Every entry carries exactly one of `url` or `data`.
- The CAP-8 success signal itself: a voice question ranks the Voice Agent
  first, a documentation question ranks the Research Agent first, in both
  directions - so it is a real ranking, not a fixed order.

Run it: `nx test pythonapi` (or `pytest tests/test_ard.py` directly). This is
the gate. The CLI's manifest mode is worth keeping as a cheap secondary
sanity check against schema drift; its registry mode is not worth running at
all for this catalog and should not appear in any report as if it validated
something it structurally cannot.

## What is deliberately not built

- Federation, referrals, upstream registry calls.
- `trustManifest`, SPIFFE identity, attestations, JWS signing. An unsigned
  entry is honest. A faked one is not.
- Real domain anchoring. The publisher domain is a placeholder and the docs
  must say the trust binding is not real.
- Write APIs. The catalog is derived from code, so there is nothing to POST.

## Risks

1. **v0.9 Proposal.** The schema will change. Everything here is one module
   and one model file, so the blast radius of a spec bump is small by design.
2. ~~`skill.examples` may be empty.~~ Checked. Both cards populate it.
3. ~~`/search` and `/explore` may collide.~~ Checked. Resolved by mounting the
   registry under `/api/ard`.
4. ~~**The conformance tool may not be runnable here.**~~ Checked. It is a
   zero-dependency Python script. Its manifest mode is runnable and useful;
   its registry mode runs but cannot validate this catalog (see "What proves
   this works"). CAP-8's objective evidence is `tests/test_ard.py`, not the
   CLI's registry PASS.
