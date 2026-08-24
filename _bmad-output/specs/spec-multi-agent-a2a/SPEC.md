---
id: SPEC-multi-agent-a2a
companions:
  - agent-contracts.md
  - architecture-diagrams.md
  - repo-and-deployment.md
  - verification.md
  - implementation-plan.md
sources:
  - sources/multi-agent-a2a.md
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate. Source documents listed in frontmatter are for traceability only.

# Multi-Agent A2A Architecture

## Why

The chat agent today is one undifferentiated FastAPI service: it does document
research through the RAG pipeline and it drives the separate voice-model
pipeline through the same request path. There is no boundary between "answer
a question about the docs" and "manage a multi-day voice training run," so
neither capability can be addressed, tested, or reasoned about on its own.

This is a vision to realize, not a fix for a live failure: add a small,
real A2A (Agent2Agent) architecture — an Orchestrator that routes to a
Research Agent and a Voice Agent — that demonstrates genuine multi-agent
value (see `agent-contracts.md`, §8.4-style diagnostic workflow in
`architecture-diagrams.md`) without turning the system into an agent
sprawl. The design must stay small enough that every additional agent
boundary earns its keep.

## Capabilities

- **CAP-1**
  - **intent:** The Orchestrator Agent is the only agent the browser talks to, and it routes each AG-UI request into `research`, `voice`, `research_and_voice`, or `general` using deterministic rules, falling back to an LLM router only when rules cannot classify safely.
  - **success:** Every AG-UI request reaches the existing endpoint unchanged; a request classified `research`, `voice`, or `research_and_voice` never reaches Qdrant or the voice factory directly from the Orchestrator — only through a specialist.

- **CAP-2**
  - **intent:** A Research Agent, reachable over A2A with a published Agent Card, answers research questions using the existing `RagPipeline` and returns sourced answers.
  - **success:** A research request returns an answer with `sources[]` when the corpus has relevant content, and a clear no-results response when it does not. The Research Agent never starts, modifies, or reads voice run state.

- **CAP-3**
  - **intent:** A Voice Agent, reachable over A2A with a published Agent Card, drives the existing voice API and voice factory for search, run start, status, and human review.
  - **success:** A voice request returns a run identifier and status. `voice_runs.phase` and `VoiceRunReconciler` remain the only source of truth and the only writer of run phase; the Voice Agent never queries Qdrant for a normal voice operation.

- **CAP-4**
  - **intent:** The Orchestrator can delegate to both specialists for one request and combine their results into a single, coherent response.
  - **success:** See Success signal below — the training-run diagnosis workflow.

- **CAP-5**
  - **intent:** A specialist being unavailable degrades only that specialist's capability, never the other, and never the Orchestrator's ability to answer a general request.
  - **success:** With the Research Agent's URL unreachable, voice requests still complete and the Orchestrator returns a useful error for the research portion. The reverse holds for the Voice Agent. With both unreachable, a `general` request still gets a response.

- **CAP-6**
  - **intent:** The Orchestrator discovers each specialist's skills and capabilities from its published Agent Card at a configured URL, rather than hard-coding them in the router.
  - **success:** Adding a skill to a specialist's Agent Card makes it visible to the Orchestrator's routing without a code change to the router itself.

- **CAP-7**
  - **intent:** Every delegated task is traceable end to end: agent name, skill, A2A task ID, context ID, target, and status appear in logs and in the existing Langfuse/OpenTelemetry trace.
  - **success:** A single AG-UI request that triggers `research_and_voice` produces one trace showing the Orchestrator, both A2A calls with their task IDs, and the final combined response — with no secrets and no hidden model reasoning in the record.

- **CAP-8**
  - **intent:** The agent network publishes and serves its own catalog under the Agentic Resource Discovery (ARD) specification, so the set of available agents is a queryable resource and not private configuration. This service is both an ARD publisher (a static `ai-catalog` manifest) and an ARD registry (a live search API over that catalog).
  - **success:** `GET /.well-known/ai-catalog.json` returns a manifest listing both specialists, and `POST /search` with `{"query": {"text": "why is my voice training slow"}}` returns the Voice Agent entry ranked above the Research Agent entry. `tests/test_ard.py` proves this and every wire-shape rule the spec sets: the manifest schema, the URN format, one-of `url`/`data`, and a search result's flat shape with an integer `score`. The official ARD conformance tool's manifest mode also passes, as an independent, non-authoritative sanity check; its registry mode does not count as evidence, because its `/search` probe hardcodes a filter for `application/mcp-server-card+json` and this catalog holds only `application/a2a-agent-card+json` entries, so the probe's result-item checks never execute against real data.

## Constraints

- Use the current released A2A specification and a pinned SDK version
  (https://a2a-protocol.org/latest/specification/). No custom JSON protocol
  may be presented as A2A.
- The Research Agent must not start or modify voice runs and must not call
  the voice factory.
- The Voice Agent must not query Qdrant and must not depend on RAG for
  normal voice operations; the two pipelines stay unmerged.
- `voice_runs.phase` stays the state machine and `VoiceRunReconciler` stays
  its only writer. The Voice Agent wraps the existing reconciler; it does
  not replace or duplicate it.
- MCP is not adopted in this first implementation.
- No A2A push notifications in the first version.
- Discovery follows the Agentic Resource Discovery (ARD) specification
  (<https://agenticresourcediscovery.org/spec/>), which supersedes the earlier
  constraint that ruled service discovery out. This service implements both
  ARD roles: it publishes a static `ai-catalog` manifest and it serves the
  registry search API over that manifest. A configured URL per specialist
  stays the transport fallback, so ARD being unavailable degrades discovery
  but never breaks delegation.
- ARD is a v0.9 draft with Proposal status. Pin the spec revision that the
  implementation targets and record it, because the schema will change.
- ARD's `trustManifest` is out of scope. No SPIFFE identity, no attestation,
  and no JWS signing. An unsigned entry is honest; a faked one is not.
- ARD identifiers are domain-anchored and require a verifiable domain. The
  demo uses a placeholder publisher domain and must state in its docs that
  the trust binding is not real.
- Orchestrator task records persist user request, orchestrator decision,
  target agent, A2A task ID, task result, and final response only — never
  full agent reasoning or hidden chain-of-thought.
- CI must not require a real GPU training job; the voice factory and GPU
  training are mocked in every automated test.
- Any new Postgres access uses SQLAlchemy 2.0 async only, per project-wide
  convention.

## Non-goals

- A swarm of agents, or an agent for every tool.
- Agent-to-agent free-form conversation.
- A separate planner agent, reviewer agent, or memory agent.
- MCP adopted solely for demonstration.
- A2A push notifications.
- ARD federation across organizations. This registry answers for its own
  catalog. It accepts the `federation` request field and honours `none`, but
  it publishes no referrals and calls no upstream registry.
- ARD trust manifests, attestations, or signature verification.
- Distributed consensus, agent self-replication, or automatic agent creation.
- Real GPU model training in CI.
- Merging the RAG pipeline into the voice pipeline, or adding RAG calls to
  voice operations without a concrete future need for it.

## Success signal

Ask the Orchestrator "Why is this voice training run taking so long?" It
must query the Voice Agent for run status and training data, query the
Research Agent for relevant troubleshooting documentation, and return one
combined, concise explanation — proving A2A adds real value here rather
than decorating an otherwise single-agent system. See the full trace in
`architecture-diagrams.md` §8.4.

## Assumptions

- Assumed the local dev topology in the source (orchestrator:8000,
  research-agent:8001, voice-agent:8002) is illustrative, not mandatory —
  the source marks it SHOULD and allows the module names to differ. See
  `repo-and-deployment.md`.
- Assumed unauthenticated internal A2A calls are acceptable for local
  development only; the source explicitly requires authenticated A2A in
  production configuration.

## Open Questions

- Which A2A SDK and protocol version will be pinned at implementation time?
  The source defers this decision to implementation time.
- Where will the initial Research Agent documentation corpus live, and who
  authors the four seed documents (dataset-requirements, diarization,
  piper-training, troubleshooting)? The source gives a suggested path but
  says the exact location may differ.
- Should the Research Agent and Voice Agent run in-process inside
  `pythonapi`, or as separate processes, for the first version? The source
  allows either and only requires separate processes if proving remote A2A
  communication needs it.
