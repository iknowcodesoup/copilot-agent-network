---
title: copilot_agent_network
status: final
created: 2026-08-13
updated: 2026-08-13
---

# PRD: copilot_agent_network

## 0. Document Purpose

This PRD is for the project owner (CodeSoup) and anyone picking up implementation work next: it grounds the two active build threads on `copilot_agent_network` in a shared vocabulary and a shared "why," so downstream epics and stories trace back to a recorded intent instead of five independent spec kernels. It builds on five existing BMAD specs under `_bmad-output/specs/` (`spec-agui-tool-loop`, `spec-copilotkit-hook-surface`, `spec-video-scoped-ingestion`, `spec-multi-voice-data-model`, `spec-videos-and-voices-views`) — each already carries its own detailed functional requirements and implementation plan; this document does not repeat that detail, it organizes it, supplies the missing vision/user framing, and gives `bmad-create-epics-and-stories` a single source to work from.

## 1. Vision

`copilot_agent_network` is a demonstration platform: a working example of how to build a complex, enterprise-grade agent system with full observability, scalability, and operational rigor — not a toy chatbot. It already runs a Next.js chat front end talking to a Python FastAPI agent service over the AG-UI protocol, backed by a RAG pipeline (Qdrant + Postgres), routed through LiteLLM, and traced through Langfuse. A second, harder demonstration lives alongside it: a GPU-backed voice-cloning pipeline that turns YouTube video into fine-tuned Piper text-to-speech models.

This PRD covers the next increment of that demonstration: closing the agent's tool-calling loop so it can perceive and act on what a user sees on screen (not just answer questions about static state), and reworking the voice pipeline's data model so a "voice" is a durable entity built from many videos over time, rather than a one-shot byproduct of a single ingest. Both threads exist to make the platform a more convincing, more complete showcase of production-grade agent engineering — and they are not just two unrelated portfolios bundled for reporting convenience: the Voices dashboard is the concrete surface where they meet. Thread 1 makes the agent able to perceive and act on that dashboard; Thread 2 rebuilds the dashboard itself. The two threads have to be sequenced with that shared surface in mind, not developed in isolation (see §8, Open Question 4).

## 2. Target User

### 2.1 Jobs To Be Done

- As the platform's builder, I need the agent to demonstrably act on live UI state — not just narrate it — so the demo proves out real tool-use, not a scripted answer.
- As someone evaluating this platform (a prospective adopter, reviewer, or collaborator), I need to see a coherent, non-trivial workflow (voice model training) driven end-to-end through the agent, so the "enterprise-grade" claim is demonstrated rather than asserted.
- As the person operating the voice pipeline, I need to reuse an already-ingested video across multiple character voices and build one voice from clips spread across several videos, so a growing content library doesn't force redundant re-ingestion work.
- `[ASSUMPTION]` The primary audience is technical (engineers, technical evaluators) rather than an end-consumer audience — the platform's own README/CLAUDE.md frames it as a monorepo reference architecture, not a consumer product.

### 2.2 Key User Journeys

- **UJ-1. An evaluator asks the agent to open a specific run, and it does.** A technical evaluator is on the Voices dashboard with several ingestion runs visible. They ask the chat agent, in the sidebar, to "open the run for the latest video." The agent — via the AG-UI tool-calling loop and a registered `useFrontendTool` — expands that run's card in the browser, without a page reload or the user clicking anything themselves. The evaluator now sees the agent has literally reached into the UI, not just replied in text. Realizes FR-1 through FR-6, FR-10.
- **UJ-2. The same evaluator asks a state-dependent question and gets a state-aware answer.** With a run expanded, the evaluator asks "what can I do with this run right now?" The agent answers based on the run's actual ingestion phase (via `useAgentContext`), not a generic capability list — and if they collapse the card, the agent stops referencing that run's detail. Realizes FR-7 through FR-9, FR-11.
- **UJ-3. The operator builds one voice from two videos.** The operator ingests a video, reviews its detected speaker clips, and assigns two speakers to an existing voice named "Picard" without starting training. They ingest a second video days later, assign one more speaker to the same "Picard" voice, then commit both assignments together. Training on "Picard" now draws on clips from both videos. The operator later opens the Voices view and sees "Picard" with both contributing videos listed. Realizes FR-16 through FR-22, FR-25 through FR-27.
- **UJ-4. Re-ingesting a video for a second character costs nothing extra.** The operator has already ingested a video for one character. They start ingestion again, targeting a second character. Because the video was already downloaded, transcribed, and diarized, the second pass reuses those cached artifacts and jumps straight to speaker assignment. Realizes FR-12 through FR-15.

## 3. Glossary

- **Run** — one video's ingestion lifecycle instance, tracked through `ingest_phase` (`DOWNLOADING` → `DIARIZING` → `AWAITING_REVIEW` → `COMMITTED`).
- **Video** — the unit of ingestion: one YouTube source, downloaded/transcribed/diarized once and reusable across characters/voices via cached artifacts keyed by video ID.
- **Voice** — a durable entity (name, training `phase`, `checkpoint_path`) that one or more videos can contribute clips to over time. Distinct from a Run: committing a Run does not by itself change any Voice's phase.
- **Voice Contribution** — one immutable record of a (voice, run, speaker) triple, created on commit. Never updated in place; the audit trail of what fed a voice's training.
- **Speaker** — a diarized voice detected within one video, identified by a label, prior to assignment to a Voice.
- **Assign** — associating a video's detected speaker with a Voice, without yet locking that association in or starting training.
- **Commit** — locking in an assignment: creates the Voice Contribution record(s) and advances the Run's `ingest_phase` to `COMMITTED`.
- **Ingest Phase** — a Run's state: `DOWNLOADING`, `DIARIZING`, `AWAITING_REVIEW`, `COMMITTED`.
- **Voice Phase** — a Voice's training state: `AWAITING_COMMIT`, `TRAINING`, `EXPORTING`, `READY`, `FAILED`.
- **AG-UI** — the SSE-based protocol carrying agent run events (including tool-call events) between the FastAPI service and the browser.
- **Frontend Tool** — an agent-callable capability registered in the browser via CopilotKit's `useFrontendTool`, for cheap/reversible UI actions (e.g., expanding a run).
- **Agent Context** — read-only state published to the agent from the browser via `useAgentContext` (e.g., which run is expanded, which actions are legal in the current phase).
- **Tool Loop** — the backend mechanism (in `core/chat_agent.py`) that forwards registered tool definitions to the model, streams back ordered `ToolCall*` AG-UI events, and ends the run so the browser can execute the tool and resume with a follow-up run.

## 4. Features

### 4.1 Agent Tool-Calling Loop

**Description:** The backend half of closing the AG-UI tool loop. Today, a tool a browser registers is invisible to the model — the completion call never passes `tools=` and never emits a `ToolCall*` event. This feature makes the agent forward tool definitions to the model, stream back a correctly ordered tool-call event sequence, end the run so the browser can execute the tool, and resume cleanly on the follow-up run the browser sends back. Source: `spec-agui-tool-loop`. Realizes UJ-1, UJ-2 (as their enabling infrastructure).

**Functional Requirements:**

#### FR-1: Tool definitions reach the model
A request carrying `agent_input.tools` maps them to the model's `tools=` shape with `tool_choice="auto"`; a request with no tools omits both arguments and behaves identically to today.

**Consequences (testable):**

- A registered frontend tool becomes callable by the model in the same turn it's registered.
- A turn with zero registered tools shows no behavior change from the current implementation.

#### FR-2: Tool-call events stream in order
A tool call the model makes emits `ToolCallStartEvent` → one or more ordered `ToolCallArgsEvent` → `ToolCallEndEvent`, reassembled from the model stream's per-index fragments, with reassembled argument text exactly matching what the model sent.

#### FR-3: The run ends after emitting tool calls
After tool calls are emitted, the server issues `RunFinishedEvent` and takes no further action for that run — it never blocks waiting for a tool result, since frontend tools execute in-browser.

**Out of Scope:** Executing the tool server-side, or waiting synchronously for its result — the browser is expected to POST a fresh `RunAgentInput` with the tool result appended to continue the conversation.

#### FR-4: Lazy text-message opening
`TextMessageStartEvent` fires only on the first non-empty content delta. A tool-only turn opens no empty text message; a turn with both text and a tool call opens exactly one text message.

#### FR-5: Runaway tool-calling is capped
A model that keeps calling tools without producing a final answer is capped by `LLM_MAX_TOOL_TURNS` (a `Settings` field with a real, non-`None` default per this project's configuration convention): a tool-calling turn count derived statelessly from `agent_input.messages` is allowed through at the limit and blocked past it — once the count exceeds `LLM_MAX_TOOL_TURNS`, the server forces a text answer instead of permitting another tool call.

#### FR-6: Documentation matches behavior
The `chat_agent.py` module docstring, which currently states tools are unsupported, is rewritten to match the new behavior.

**Feature-specific NFRs:**

- No new blocking calls — the tool loop stays `async def` throughout, per this project's async-all-the-way convention.

**Out of Scope:** Any change to `routes/agent.py`, which stays an unmodified pass-through. This feature shares no dependency with the voice-pipeline threads (4.3–4.5) and can proceed in parallel with them.

---

### 4.2 CopilotKit Hook Surface

**Description:** The frontend half of the same loop: wires the Voices dashboard's CopilotKit v2 hooks so the agent can perceive what's on screen and take cheap, reversible actions on the user's behalf, instead of only reading a static run-list summary. Depends on 4.1 shipping first — no frontend tool call works until the backend forwards tool definitions. The trade-off: every piece of on-screen state the agent needs to reach now requires a maintained `useAgentContext`/`useFrontendTool` pair, a second surface that has to keep tracking the UI as it evolves, not just the UI itself. Source: `spec-copilotkit-hook-surface`. Realizes UJ-1, UJ-2.

**Functional Requirements:**

#### FR-7: Expanded-run state is published to the agent
The currently expanded/selected run ID is published via `useAgentContext`; asking the agent "which run is open" names the correct run.

#### FR-8: Phase-legal actions are published to the agent
A static `useAgentContext` payload describes ingestion phases and which action is legal in each phase, so the agent's answers about "what can I do here" reflect actual state, not a generic capability list.

#### FR-9: Context ownership follows the UI, not a global store
`useAgentContext` placement follows the owning component — collapsing a run card removes its context; the agent stops referencing that card's detail once collapsed.

#### FR-10: The agent can expand a run on the user's behalf
One `useFrontendTool` lets the agent expand a specified run, wherever runs are currently listed in the UI. Asking the agent to open a different run results in that run's card expanding in the browser, unprompted by a click.

**[NOTE FOR PM]** FR-10 targets whatever run-list UI exists when 4.2 ships — 4.5 replaces that UI in the same MVP. See §8, Open Question 4 for the rework/re-validation question this raises.

#### FR-11: Starter suggestions track visible state
`useConfigureSuggestions` seeds starter prompts from the runs currently on screen; the suggestion set changes when the visible run set changes.

**Feature-specific NFRs:**

- Hook selection is governed by a fixed Need-to-Hook policy table (read-only → `useAgentContext`; reversible action → `useFrontendTool`; costly/destructive → `useHumanInTheLoop`; server-tool custom UI → `useRenderTool`; starter prompts → `useConfigureSuggestions`; status → `useAgent`) that stays stable across future work on this dashboard — a binding constraint, not a style preference.
- CopilotKit v1 hooks (`useCopilotReadable`, `useCopilotAction`) are not exported by `react-core/v2` and are banned from new code.

**Notes:**

- **[NOTE FOR PM]** A working/idle status indicator driven by `useAgent` is part of this feature's Phase 1 per the source spec, with its own testable success condition ("the sidebar header reflects the agent's run status during an active run"). It has no numbered FR here because it's deprioritized to an acceptance-criterion-level item, not because it's untestable — carry it into epics/stories under this feature.

**Out of Scope:** Classifying the concrete Phase 2 tool inventory for the reworked Videos/Voices actions (assign, commit, discard, train) — deferred until Feature 4.5 lands, to avoid building against the `approve_run` action this PRD's other thread removes (see §8, Open Question 1). This feature also does not modify `pythonapi`'s tool-call handling — that is 4.1's scope entirely.

---

### 4.3 Video-Scoped Ingestion

**Description:** Decouples video ingestion from character assignment in the GPU voice-training pipeline (control API in the separate `star-trek-voyicer` repo, orchestrated by this project's `VoiceFactoryGateway`). Today, ingesting a video is tied to one character; ingesting the same video for a second character repeats the whole download/transcribe/diarize pipeline. This feature makes ingestion video-scoped and its artifacts reusable across any number of characters, and lets a single commit route speaker labels from one or more videos to multiple characters at once. (This feature has no Voice entity to route into — that durable, cross-video Voice concept is 4.4's addition, built on top of this one.) Source: `spec-video-scoped-ingestion`. Realizes UJ-4, and is the upstream dependency for 4.4.

**Functional Requirements:**

#### FR-12: Re-ingesting a known video costs nothing
Claiming an already-ingested video for a new character triggers no download, transcribe, or diarize step — cached artifacts are reused by video ID.

#### FR-13: Ingested videos and their speakers are queryable independent of character
`GET /videos` returns ingested video IDs with diarization status; `GET /videos/{id}/speakers` returns speaker labels with clip counts, without reference to any one character.

#### FR-14: One commit can route many videos to many characters
A commit payload shaped `{video_id: {speaker_label: character}}` can grow multiple named characters' datasets from multiple videos in a single call.

#### FR-15: Preprocessing only regenerates what changed
Running preprocess after new clips land regenerates the training config; running it again with no new clips is a no-op.

**Feature-specific NFRs:**

- All five gateway-bound routes this feature touches (`get_clips`, `update_clips`, `set_speaker_map`, `stream_clip_audio`, and `get_training_progress` — the one route of the five that stays character-scoped and does not move) update in the same change as the `VoiceFactoryGateway` call sites that depend on them — this is a hard breaking-change pairing, not two independent rollouts.

**Out of Scope:** Rebuilding multi-character clip routing (already works via `speaker_map.json`/`commit_reviewed_clips` — only the file's location moves) and changing the `JobRequest` data model (the `character` field is already optional). The durable Voice entity and its data-model split are 4.4's scope, not this feature's.

**Notes:**

- **[NOTE FOR PM]** Migration path for pre-existing `work/<character>/youtube/*` directories is unresolved — see §8, Open Question 2.

---

### 4.4 Multi-Voice Data Model

**Description:** Splits "voice" from "video ingestion" as first-class, independently-lifecycled entities in `pythonapi`. A Voice becomes a durable entity that many videos can feed over time; assigning a speaker to a Voice and committing that assignment (which starts training) become two separate, explicit steps rather than one irreversible action. That split is a deliberate trade: it costs the operator an extra step and an extra state to track, in exchange for the ability to hold an assignment before training commits to it. Depends on 4.3 for its gateway contract and filesystem layout. Source: `spec-multi-voice-data-model`. Realizes UJ-3, and is the upstream dependency for 4.5.

**Functional Requirements:**

#### FR-16: Voice is a durable, independent entity
The system represents a Voice (id, name, `phase`, `checkpoint_path`) independent of any single video via a `voices` table, exposed via `POST /voices` to create a named Voice and `GET /voices/{id}` to fetch a Voice with its contributions.

#### FR-17: Ingest phase and voice phase are tracked and change independently
Run `ingest_phase` (`DOWNLOADING`/`DIARIZING`/`AWAITING_REVIEW`/`COMMITTED`) and Voice `phase` (`AWAITING_COMMIT`/`TRAINING`/`EXPORTING`/`READY`/`FAILED`) are tracked separately; a Run reaching `COMMITTED` does not itself change any Voice's phase.

#### FR-18: Assignment and commit are separate operations
`POST /runs/{id}/assign` associates a video's speakers with Voices without changing `ingest_phase`. `POST /runs/{id}/commit` separately creates immutable Voice Contribution records and advances `ingest_phase` to `COMMITTED`.

#### FR-19: Every contribution is an immutable audit record
One `voice_contributions` row is created per (voice, run, speaker) triple on commit; rows are never updated in place.

#### FR-20: Training can be triggered explicitly or automatically
`POST /voices/{id}/train` triggers training explicitly; training also triggers automatically on a Voice's first contribution. `[ASSUMPTION]` Both trigger paths are supported concurrently, since the source spec did not pick one exclusively — confirm this is still the intended behavior rather than a placeholder for a later decision.

#### FR-21: Ingestion and voice training run as separate state machines
One LangGraph per video handles ingestion; a separate LangGraph per Voice handles training, triggered on contribution commit.

#### FR-22: Voice-centric queries are supported at the repository layer
The repository layer answers "all contributions for this voice, joined to run/video" and "fetch voice by name," in addition to existing run-centric queries.

**Feature-specific NFRs:**

- All new persistence uses SQLAlchemy 2.0 async via `Base.metadata.create_all` — no raw SQL, per this project's standing convention. `voice_runs` is trimmed, not grown: its training-related columns move to the new `voices` table, leaving `voice_runs` holding only ingestion-related fields. `voices` and `voice_contributions` are new tables.

**Out of Scope:** No frontend or UI change is made in this feature — that is 4.5's scope. No change to the video-scoped filesystem layout or gateway routes — that is 4.3's scope. No change to multi-character clip-merge logic in the voice factory's own commit stage; this feature only ensures `pythonapi` tracks the merge via contributions.

---

### 4.5 Videos & Voices Views

**Description:** Splits the current single flat run-list UI into two dedicated screens — a Videos view for ingestion review and a Voices view for voice management — and surfaces the assign/commit split from 4.4 in the UI, replacing a single irreversible "approve" action. Depends on 4.4's routes and data model. Source: `spec-videos-and-voices-views`. Realizes UJ-3.

**Functional Requirements:**

#### FR-23: Videos and Voices are separate views
A tab or nav segment switches between a Videos view and a Voices view; each renders independently.

#### FR-24: Videos view surfaces ingestion state per video
The Videos view lists video title, source URL, speaker count, and diarization status; expanding a row shows its detected speaker clips, each labeled "awaiting assignment" or "assigned to voice X."

#### FR-25: Speaker naming is search-or-create, not free text
Speaker naming uses a combobox that searches existing Voices or creates a new one inline.

#### FR-26: Assign, commit, and discard are distinct, visible actions
"Assign speakers" opens the combobox without starting training; "Commit assignments" locks assignments in and creates contributions; "Discard" resets a run to `AWAITING_REVIEW`. Multiple videos can be assigned in parallel and committed individually or in batch.

#### FR-27: Voices view surfaces training state per voice
The Voices view shows a card per Voice: name, phase, total clip count, and model size once `READY`. Each card shows a contributing-videos count badge (e.g. "3 videos") that opens a popover listing each contributing video, its clip count, and assignment date. A Voice with `AWAITING_COMMIT` contributions shows a phase-conditional "Train now" action; a standing "Retrain" action independently re-triggers `POST /voices/{id}/train` regardless of that condition. "View clips" opens a modal listing every clip across all of the Voice's contributing videos. "Download model" activates once a Voice reaches `READY`.

**Out of Scope:** Changes to pythonapi routes or the data model (owned entirely by 4.4) and changes to existing clip audio-quality review/playback (`speaker_board` playback flow is preserved as-is).

## 5. Non-Goals (Explicit)

- This PRD does not cover the already-shipped RAG/document pipeline, order handling, or PII vault — those are existing, working capabilities, not part of this increment's scope (confirmed with the project owner).
- No server-side tool execution or synchronous tool-result waiting is introduced — frontend tools execute in the browser only (4.1). 4.1 shares no dependency with the voice-pipeline threads (4.3–4.5) and can proceed in parallel with them.
- No change to `pythonapi`'s tool-call handling in 4.2 — that is 4.1's scope entirely.
- No rebuilding of multi-character clip routing in the voice factory host — it already works via `speaker_map.json`/`commit_reviewed_clips`; only the file's location moves (4.3). No change to the `JobRequest` data model — the `character` field is already optional (4.3).
- No change to multi-character clip-merge logic in the voice factory's own commit stage — 4.4 only ensures `pythonapi` tracks the merge via contributions. No frontend or UI change in 4.4 — that is 4.5's scope. No change to the video-scoped filesystem layout or gateway routes in 4.4 — that is 4.3's scope.
- No migration tooling (e.g., Alembic) for the `voice_runs` trim (training-related columns moving out to `voices`) — development recreates the table (4.4).
- The concrete Phase 2 tool inventory for Videos/Voices actions (4.2's deferred scope) is not defined in this PRD — it is explicitly sequenced after 4.5.

## 6. MVP Scope

### 6.1 In Scope

- Agent tool-calling loop, backend and frontend (4.1, 4.2 Phase 1: context publishing, one frontend tool, suggestions, status indicator).
- Voice pipeline data-model rework end-to-end: video-scoped ingestion, multi-voice data model, and the Videos/Voices UI split (4.3, 4.4, 4.5).

### 6.2 Out of Scope for MVP

- 4.2 Phase 2 (concrete tool inventory for the new Videos/Voices actions) — see §4.2 Out of Scope for why. **[NOTE FOR PM]** Revisit immediately once 4.5 lands; this is sequencing, not descoping.
- Migration of pre-existing `work/<character>/youtube/*` directories to the new video-scoped layout (4.3) — unresolved; see §8.

## 7. Success Metrics

**Primary**

- **SM-1**: An evaluator can, in one live session, ask the agent to act on the Voices dashboard (expand a run) and get a correct, state-aware follow-up answer, with no manual UI interaction between the two. Validates FR-1, FR-2, FR-3, FR-7, FR-8, FR-10. Re-validate after 4.5 ships, not only before — see §8, Open Question 4.
- **SM-2**: A single Voice can be shown, live, to have been built from clips contributed by two or more distinct videos, with each contribution traceable in the UI. Validates FR-14, FR-16, FR-19, FR-22, FR-27.

**Secondary**

- **SM-3**: Re-ingesting a previously-ingested video for a new character shows no re-download/re-transcribe/re-diarize step in logs or timing. Validates FR-12.
- **SM-4**: After 4.3's gateway-route migration, the Voices dashboard still loads clip lists, speaker maps, and clip audio with no functional regression. Validates FR-13, and the route-rename NFR under §4.3.

**Counter-metrics (do not optimize)**

- **SM-C1**: Tool-call turn count per conversation should not silently climb toward `LLM_MAX_TOOL_TURNS` as a matter of course — hitting the cap routinely would indicate the agent is thrashing, not demonstrating capability. Counterbalances SM-1.
- **SM-C2**: A rising contributing-video count on a Voice is not itself the goal — a well-trained single-source Voice beats a noisy multi-source one; per-contribution audio quality should not be sacrificed to grow SM-2's count. Counterbalances SM-2.
- **SM-C3**: A cache hit on re-ingestion (SM-3) must still serve correct artifacts, not merely fast ones — reuse should not silently serve stale transcription/diarization if the source video changed. Counterbalances SM-3.

## 8. Open Questions

1. Once 4.5 ships, what is the concrete tool inventory for the new Videos/Voices actions, and how does each classify under the Need-to-Hook policy table (`useFrontendTool` vs. `useHumanInTheLoop`) — e.g., for commit, train, discard? (From 4.2's deferred scope.)
2. ~~What is the migration path for pre-existing `work/<character>/youtube/*` directories...~~ **Resolved during story creation:** accepted one-time re-ingest in development; no migration script. See `_bmad-output/planning-artifacts/epics.md`, Epic 2.
3. Is the dual training-trigger behavior in FR-20 (explicit call and auto-trigger-on-first-contribution) the intended permanent behavior, or a placeholder pending a later decision to pick one?
4. ~~FR-10's "expand a run" frontend tool (§4.2) is built against whichever run-list UI exists when 4.2 ships...~~ **Resolved during epic planning:** the voice-pipeline rework (4.3–4.5) ships before the agent tool-calling thread (4.1–4.2). FR-10 is built once, directly against the final Videos/Voices UI — no rework pass or dual SM-1 validation needed. See `_bmad-output/planning-artifacts/epics.md`, Epic ordering.

## 9. Assumptions Index

- From §2.1 — the primary audience is technical (engineers, evaluators) rather than a consumer end-user, inferred from the project's own framing as a reference architecture rather than a shipped product.
- From FR-20 (§4.4) — both the explicit `POST /voices/{id}/train` trigger and the automatic on-first-contribution trigger are treated as intentionally concurrent, not a placeholder for a single-trigger decision. Also listed as Open Question 3.
