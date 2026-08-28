---
title: copilot_agent_network
status: final
created: 2026-08-13
updated: 2026-08-27
---

# PRD: copilot_agent_network

> **Reconciled 2026-08-27.** The code moved past this plan. §4.4 and §4.5
> shipped on a clip-based assignment model, not the run-based
> `assign`/`commit`/`voice_contributions` model first written here and
> flattened on 2026-08-16. FR-5 was dropped. A multi-agent A2A network and a
> factory-source-of-truth change shipped without a plan and are recorded as
> §4.6 and §4.7. Every changed requirement carries a dated `[DELIVERED]`,
> `[SUPERSEDED]`, or `[OUT OF SCOPE]` tag. Full record:
> `sprint-change-proposal-2026-08-27.md`.

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
- **UJ-3. The operator builds one voice from two videos.** The operator ingests a video, reviews its detected speaker clips, and assigns one speaker's clips to an existing voice named "Picard". Assigning the first clips starts Picard's training. They ingest a second video days later and assign one more speaker's clips to the same "Picard" voice; its next training pass draws on clips from both videos. The operator opens the Voices view and sees "Picard" with a clip count and a source-video count of two. Realizes FR-16 through FR-22, FR-25 through FR-27. `[UPDATED 2026-08-27 — clip-based, no separate commit step, no "contributing videos" popover; see sprint-change-proposal-2026-08-27.md]`
- **UJ-4. Re-ingesting a video for a second character costs nothing extra.** The operator has already ingested a video for one character. They start ingestion again, targeting a second character. Because the video was already downloaded, transcribed, and diarized, the second pass reuses those cached artifacts and jumps straight to speaker assignment. Realizes FR-12 through FR-15.

## 3. Glossary

- **Run** — one video's ingestion lifecycle instance, tracked through `phase`. `[SUPERSEDED 2026-08-27]` Shipped phases are `DOWNLOADING` → `DIARIZING` → `INGESTED` → `FAILED`. Review is not a phase — a video stays in review until every clip has a keep/exclude decision. There is no `AWAITING_REVIEW` and no `COMMITTED`.
- **Video** — the unit of ingestion: one YouTube source, downloaded/transcribed/diarized once and reusable across characters/voices via cached artifacts keyed by video ID.
- **Voice** — a durable entity (name, training `phase`, `checkpoint_path`) that holds clips assigned to it from any number of videos over time. Distinct from a Run and tracked on a separate table. `[SUPERSEDED 2026-08-27]` Neither state machine drives the other: assigning clips to a Voice changes no Run phase, and a Run reaching `INGESTED` changes no Voice phase.
- **Clip assignment** — `[NEW 2026-08-27, replaces "Voice Contribution"]` a clip belongs to at most one Voice, recorded on the `voice_clips` row. The clip and its audio are never mutated; reassigning overwrites the one field. This is the audit trail of what feeds a Voice.
- **Voice Contribution** — `[SUPERSEDED 2026-08-27]` Never shipped. The `(voice, run, speaker)` triple and the `voice_contributions` table were designed on 2026-08-16 and dropped. Retained here only for reading pre-2026-08-27 artifacts. See **Clip assignment**.
- **Speaker** — a diarized voice detected within one video, identified by a label, prior to assignment to a Voice.
- **Assign** — `[SUPERSEDED 2026-08-27]` assigning a video's clips to a Voice via `POST /voices/{id}/clips`. Picking a speaker in the UI sends that speaker's whole clip list; a later per-clip correction sends one clip ID. It touches no Run phase. Assigning the first clips to a Voice starts its training.
- **Commit** — `[SUPERSEDED 2026-08-16, gone 2026-08-27]` Never a separate operation in shipped code. Retained only for reading old artifacts.
- **Ingest Phase / Run Phase** — a Run's state: `DOWNLOADING`, `DIARIZING`, `INGESTED`, `FAILED` `[SUPERSEDED 2026-08-27]`.
- **Voice Phase** — a Voice's training state: `AWAITING_COMMIT`, `COMPILING`, `TRAINING`, `EXPORTING`, `READY`, `FAILED`. `COMPILING` gathers every kept clip assigned to the Voice, across every video, at training start.
- **AG-UI** — the SSE-based protocol carrying agent run events (including tool-call events) between the FastAPI service and the browser.
- **Frontend Tool** — an agent-callable capability registered in the browser via CopilotKit's `useFrontendTool`, for cheap/reversible UI actions (e.g., expanding a run).
- **Agent Context** — read-only state published to the agent from the browser via `useAgentContext` (e.g., which run is expanded, which actions are legal in the current phase).
- **Tool Loop** — the backend mechanism that forwards registered tool definitions to the model, streams back ordered `ToolCall*` AG-UI events, and ends the run so the browser can execute the tool and resume with a follow-up run. `[SUPERSEDED 2026-08-27]` Lives in `agents/orchestrator/chat_agent.py`, not `core/chat_agent.py` — moved into the multi-agent A2A build (§4.6).
- **A2A** — `[NEW 2026-08-27]` the agent-to-agent protocol the Orchestrator uses to reach the Research Agent and the Voice Agent. See §4.6.
- **ARD** — `[NEW 2026-08-27]` Agentic Resource Discovery: the catalog spec the Orchestrator uses to discover each specialist's skills from its published Agent Card. See §4.6.

## 4. Features

### 4.1 Agent Tool-Calling Loop

**Description:** The backend half of closing the AG-UI tool loop. Today, a tool a browser registers is invisible to the model — the completion call never passes `tools=` and never emits a `ToolCall*` event. This feature makes the agent forward tool definitions to the model, stream back a correctly ordered tool-call event sequence, end the run so the browser can execute the tool, and resume cleanly on the follow-up run the browser sends back. Source: `spec-agui-tool-loop`. Realizes UJ-1, UJ-2 (as their enabling infrastructure).

> `[DELIVERED 2026-08-27]` Shipped inside the multi-agent A2A build (§4.6).
> The loop lives in `agents/orchestrator/chat_agent.py`, not `core/chat_agent.py`.
> FR-1, FR-2, FR-3, FR-4, FR-6 delivered as written; `test_agent_tools.py`
> covers them. FR-5 dropped — see below.

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
`[OUT OF SCOPE — 2026-08-27]` Not implemented, and no longer applicable. The
Orchestrator agent emits tool calls and ends the run (FR-3); it never loops
server-side waiting on a tool result, so there is no server-side turn count to
cap. `LLM_MAX_TOOL_TURNS` was never added to `Settings`. A cap, if wanted,
belongs on the browser (CopilotKit v2) follow-up loop and is a new item, not
this one. See `sprint-change-proposal-2026-08-27.md`.

~~A model that keeps calling tools without producing a final answer is capped by `LLM_MAX_TOOL_TURNS` (a `Settings` field with a real, non-`None` default per this project's configuration convention): a tool-calling turn count derived statelessly from `agent_input.messages` is allowed through at the limit and blocked past it — once the count exceeds `LLM_MAX_TOOL_TURNS`, the server forces a text answer instead of permitting another tool call.~~

#### FR-6: Documentation matches behavior
The `chat_agent.py` module docstring, which currently states tools are unsupported, is rewritten to match the new behavior.

**Feature-specific NFRs:**

- No new blocking calls — the tool loop stays `async def` throughout, per this project's async-all-the-way convention.

**Out of Scope:** Any change to `routes/agent.py`, which stays an unmodified pass-through. This feature shares no dependency with the voice-pipeline threads (4.3–4.5) and can proceed in parallel with them.

---

### 4.2 CopilotKit Hook Surface

**Description:** The frontend half of the same loop: wires the Voices dashboard's CopilotKit v2 hooks so the agent can perceive what's on screen and take cheap, reversible actions on the user's behalf, instead of only reading a static run-list summary. Depends on 4.1 shipping first — no frontend tool call works until the backend forwards tool definitions. The trade-off: every piece of on-screen state the agent needs to reach now requires a maintained `useAgentContext`/`useFrontendTool` pair, a second surface that has to keep tracking the UI as it evolves, not just the UI itself. Source: `spec-copilotkit-hook-surface`. Realizes UJ-1, UJ-2.

> `[DELIVERED 2026-08-27]` `features/chat/copilot_tools.tsx` registers the
> hook surface with `@copilotkit/react-core/v2`: `useAgentContext` payloads
> (current view/selection, every run, every voice, the selected video's
> clips), `useFrontendTool` for `addVideo`, `keepClips`, `discardClips`,
> `assignSpeaker`, `startTraining`, and a static `useConfigureSuggestions`.
> FR-7 through FR-11 satisfied. The Phase-2 tool inventory (below) is
> resolved by this file. The `useAgent` status indicator (§4.2 Notes) is
> not built.

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

**Out of Scope:** ~~Classifying the concrete Phase 2 tool inventory for the reworked Videos/Voices actions (assign, commit, discard, train) — deferred until Feature 4.5 lands, to avoid building against the `approve_run` action this PRD's other thread removes.~~ `[RESOLVED 2026-08-27]` The Phase-2 tool inventory shipped in `copilot_tools.tsx`: `addVideo`, `keepClips`, `discardClips`, `assignSpeaker`, `startTraining` — all `useFrontendTool` (reversible), no `useHumanInTheLoop`. There is no `approve_run`, no assign/commit/discard split. This feature does not modify `pythonapi`'s tool-call handling — that is 4.1's / §4.6's scope.

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

**Description:** Splits "voice" from "video ingestion" as first-class, independently-lifecycled entities in `pythonapi`. A Voice becomes a durable entity that holds clips assigned to it from any number of videos over time. Assigning a video's clips to a Voice is one immediate action (`POST /voices/{id}/clips`); assigning the first clips starts the Voice's training. There is no separate commit or discard step. Depends on 4.3 for its gateway contract and filesystem layout. Source: `spec-multi-voice-data-model`. Realizes UJ-3, and is the upstream dependency for 4.5.

> `[SUPERSEDED 2026-08-27]` The run-based `assign` → `commit` split first
> written here, and its flattened `POST /runs/{id}/assign` +
> `voice_contributions` + `COMMITTED` replacement from 2026-08-16, were both
> reversed. Shipped model is clip-based: a `voice_clips` table, per-clip
> keep/exclude review, `POST /voices/{id}/clips` to assign a video's clips to
> a Voice. No `voice_contributions` table, no `COMMITTED` phase, no
> run-scoped assign or commit route exists. FR-16 through FR-22 below are
> rewritten to the shipped model. See `sprint-change-proposal-2026-08-27.md`.

**Functional Requirements:**

#### FR-16: Voice is a durable, independent entity
`[DELIVERED 2026-08-27 — "clips", not "contributions"]` The system represents a Voice (`id`, `name`, `phase`, `checkpoint_path`) independent of any single video via a `voices` table, exposed via `POST /voices` to create a named Voice, `GET /voices/{id}` to fetch a Voice with its assigned clips, and `PATCH /voices/{id}` to rename it.

#### FR-17: Run phase and voice phase are separate state machines, neither driving the other
`[SUPERSEDED 2026-08-27 — no COMMITTED phase]` `[DELIVERED — separate state machines]` Run `phase` (`DOWNLOADING`/`DIARIZING`/`INGESTED`/`FAILED`) and Voice `phase` (`AWAITING_COMMIT`/`COMPILING`/`TRAINING`/`EXPORTING`/`READY`/`FAILED`) are tracked on separate tables. Neither drives the other: assigning clips to a Voice changes no Run phase, and a Run reaching `INGESTED` changes no Voice phase. Review is not a Run phase — a video stays in review until every clip has a keep/exclude decision. Originally (2026-08-13) read "does not itself change any Voice's phase"; 2026-08-16 reversed that to "a Run reaching `COMMITTED` moves the Voice to `TRAINING`"; 2026-08-27 dropped `COMMITTED` entirely. See `sprint-change-proposal-2026-08-27.md`.

#### FR-18: Assigning a video's clips to a Voice is one immediate call
`[SUPERSEDED 2026-08-27 — no run-scoped assign or commit route]` `[DELIVERED — clip-based]` `POST /voices/{id}/clips` assigns a list of a video's clip IDs to a Voice. `POST /voices/{id}/clips/unassign` removes them. Assignment is per-clip and append-only; it touches no Run phase. Picking a speaker in the UI sends that speaker's whole clip list; correcting one clip sends one ID. Originally split across `/assign` then `/commit` (2026-08-13), merged onto `POST /runs/{id}/assign` (2026-08-16), then moved to the Voice resource (2026-08-27).

#### FR-19: A clip's Voice assignment is the immutable audit record
`[SUPERSEDED 2026-08-27 — the (voice, run, speaker) triple and voice_contributions table were never shipped]` `[DELIVERED — clip assignment is the record]` Each clip carries at most one Voice assignment, recorded on its `voice_clips` row. Reassigning a clip overwrites that one field; the clip and its audio are never mutated. Un-keeping or reassigning a clip takes effect at the next `COMPILING` pass, which re-gathers the Voice's kept clips from scratch.

#### FR-20: Training can be triggered explicitly or automatically
`[DELIVERED 2026-08-27]` `POST /voices/{id}/train` triggers training explicitly, accepted in any phase. Training also triggers automatically when clips are first assigned to a Voice — the assign route wakes `VoiceTrainingReconciler`. Both paths are permanent (resolves the 2026-08-13 `[ASSUMPTION]` and §8 Open Question 3).

#### FR-21: Ingestion and voice training run as separate state machines
`[DELIVERED 2026-08-27]` One LangGraph per video handles ingestion (`voice_run_graph.py`); a separate LangGraph per Voice handles training (`voice_training_graph.py`), triggered when clips are assigned to the Voice. No shared node code.

#### FR-22: Voice-centric queries are supported at the repository layer
`[SUPERSEDED 2026-08-27 — "all contributions joined to run/video" is now "all clips with their video"]` `[DELIVERED]` The repository layer answers "all clips assigned to this Voice, each with the video it came from" (`list_clips_for_voice`, `list_clips_for_voices`) and "fetch Voice by name" (`get_voice_by_name`), alongside the existing run-centric queries.

**Feature-specific NFRs:**

- `[UPDATED 2026-08-27]` All new persistence uses SQLAlchemy 2.0 async via `Base.metadata.create_all` — no raw SQL, no Alembic, per this project's standing convention. `voice_runs` holds ingestion fields only; training state lives on the new `voices` table. `voices` and `voice_clips` are the new tables. `voice_contributions` was never created.

**Out of Scope:** No frontend or UI change is made in this feature — that is 4.5's scope. No change to the video-scoped filesystem layout or gateway routes — that is 4.3's scope. No change to multi-character clip-merge logic in the voice factory's own commit stage.

---

### 4.5 Videos & Voices Views

**Description:** Splits the current single flat run-list UI into dedicated views — a Videos view for ingestion review and a Voices view for voice management — and surfaces clip assignment from 4.4 in the UI. Depends on 4.4's routes and data model. Source: `spec-videos-and-voices-views`. Realizes UJ-3.

> `[DELIVERED IN PART / SUPERSEDED IN PART — 2026-08-27]` Views shipped as
> client tab state (`type View = "videos" | "voices" | "search"` in
> `studio_provider.tsx`), not App Router segments. The assign/commit UI never
> shipped — clip assignment replaced it. FR-27's contributing-videos popover,
> "Train now"/"Retrain" split, model-size, "Download model", and "View clips"
> modal were not built. See `sprint-change-proposal-2026-08-27.md`.

**Functional Requirements:**

#### FR-23: Videos and Voices are separate views
`[DELIVERED 2026-08-27 — client tab state, not App Router segments]` A tab segment switches between Videos, Voices, and Search views; each renders independently with no full page reload.

#### FR-24: Videos view surfaces ingestion state per video
`[DELIVERED 2026-08-27]` The Videos view lists each video's title, source URL, detected-speaker count, and diarization status. Expanding a video shows its clips in a table: per-clip transcript, keep/exclude state, diarization-quality flag, and the Voice each clip is assigned to (or "unassigned").

#### FR-25: Speaker naming is search-or-create, not free text
`[DELIVERED 2026-08-27]` Speaker naming uses a combobox that searches existing Voices or creates a new one inline.

#### FR-26: Assigning a speaker to a Voice is immediate — no separate commit or discard step
`[SUPERSEDED 2026-08-27 — clip-based, not the voice_contributions write FR-26 named on 2026-08-16]` `[DELIVERED]` Picking a Voice for a speaker in the combobox assigns that speaker's clips to the Voice in one call and, if it is the Voice's first assignment, starts its training. There is no separate commit or discard step. Speakers across any number of videos can be assigned independently, in any order. A later per-clip correction reassigns that one clip. Originally (2026-08-13) a three-action "Assign / Commit / Discard" model; collapsed to one action 2026-08-16; moved to clip assignment 2026-08-27.

#### FR-27: Voices view surfaces training state per voice
`[SUPERSEDED 2026-08-27 — trimmed]` `[DELIVERED]` The Voices view shows a card per Voice: name (editable inline via `PATCH /voices/{id}`), a phase pill, kept-clip count, source-video count, and total kept-clip duration. Selecting a Voice opens a training panel listing its kept and excluded clips (gathered across every source video — the same rows `COMPILING` uses) and a single "Start training" action, enabled when the Voice has at least one kept clip and is not already training, that calls `POST /voices/{id}/train`. **Dropped, not built:** the contributing-videos popover with per-video clip counts and assignment dates, the phase-conditional "Train now" vs. standing "Retrain" split, model-size display, "Download model", and the "View clips" modal (the clip list is inline in the training panel). The clip model keeps no per-video contribution record with a date.

**Out of Scope:** Changes to pythonapi routes or the data model (owned entirely by 4.4) and changes to existing clip audio-quality review/playback (playback flow is preserved as-is).

---

### 4.6 Multi-Agent A2A Network

`[NEW 2026-08-27 — delivered without a plan; recorded after the fact]`

**Description:** Replaces the single chat agent with a network of three. An
Orchestrator agent is the only agent the browser talks to. It classifies each
AG-UI request as `research`, `voice`, `research_and_voice`, or `general` and
routes it to a specialist over the A2A protocol, falling back to an LLM router
only when deterministic rules cannot classify safely. A Research Agent answers
research questions using the existing `RagPipeline` and returns sourced
answers. A Voice Agent drives the existing voice API and voice factory. The
Orchestrator discovers each specialist's skills from its published Agent Card
via Agentic Resource Discovery (ARD); a configured URL per specialist is the
transport fallback. Source: `spec-multi-agent-a2a`. This work absorbed §4.1 —
the tool-calling loop lives in `agents/orchestrator/chat_agent.py`.

**Capabilities (delivered):**

- The Orchestrator is the only browser-facing agent; a `research`/`voice`/`research_and_voice` request never reaches Qdrant or the voice factory except through a specialist.
- The Research Agent never starts, modifies, or reads voice run state. The Voice Agent never queries Qdrant.
- `voice_runs.phase` and `VoiceRunReconciler` stay the only source of truth and the only writer of run phases — the Voice Agent wraps the reconciler, it does not replace it.
- A specialist being unavailable degrades only its own capability; a `general` request still answers with both specialists down.
- Every delegation is traceable end to end in Langfuse: agent name, skill, A2A task ID, context ID, target, status.
- The service publishes a static `ai-catalog` ARD manifest and serves the ARD registry search API over it.

**Code:** `agents/{orchestrator,research,voice}/`, `a2a_support/`,
`core/ard_catalog.py`, `routes/ard.py`. **Tests:** `test_orchestrator_agent.py`,
`test_orchestrator_delegation.py`, `test_research_agent.py`,
`test_voice_agent.py`, `test_agent_tools.py`, `test_ard.py`.

**Out of Scope (per the source spec):** MCP is not adopted. No A2A push
notifications. ARD `trustManifest`, SPIFFE identity, and JWS signing are out —
the demo uses a placeholder publisher domain and says so. CI mocks the voice
factory and GPU training. Authenticated A2A is required in production config
but unauthenticated internal calls are accepted for local development.

---

### 4.7 Factory Is the Source of Truth

`[NEW 2026-08-27 — delivered as PR #20; recorded after the fact]`

**Description:** The voice factory host owns clip decisions. `review.csv` on
the factory host stays the one source of truth for keep/exclude; `pythonapi`
stores run and voice state and nothing on disk. Source:
`spec-factory-source-of-truth`.

**Out of Scope:** Rebuilding the factory's own commit/merge logic.

## 5. Non-Goals (Explicit)

- This PRD does not cover the already-shipped RAG/document pipeline, order handling, or PII vault — those are existing, working capabilities, not part of this increment's scope (confirmed with the project owner).
- No server-side tool execution or synchronous tool-result waiting is introduced — frontend tools execute in the browser only (4.1). 4.1 shares no dependency with the voice-pipeline threads (4.3–4.5) and can proceed in parallel with them.
- No change to `pythonapi`'s tool-call handling in 4.2 — that is 4.1's scope entirely.
- No rebuilding of multi-character clip routing in the voice factory host — it already works via `speaker_map.json`/`commit_reviewed_clips`; only the file's location moves (4.3). No change to the `JobRequest` data model — the `character` field is already optional (4.3).
- No change to multi-character clip-merge logic in the voice factory's own commit stage. No frontend or UI change in 4.4 — that is 4.5's scope. No change to the video-scoped filesystem layout or gateway routes in 4.4 — that is 4.3's scope.
- No migration tooling (e.g., Alembic) for the voice schema — development recreates the tables (4.4).
- ~~The concrete Phase 2 tool inventory for Videos/Voices actions is not defined in this PRD.~~ `[RESOLVED 2026-08-27]` It shipped — see §4.2 Out of Scope.

## 6. MVP Scope

> `[DELIVERED 2026-08-27]` The MVP shipped. Every user journey (UJ-1 through
> UJ-4) is served — see the per-FR tags in §4 for the mechanism each one
> shipped with, and `sprint-change-proposal-2026-08-27.md` for where the
> mechanism differs from this section's wording.

### 6.1 In Scope

- Agent tool-calling loop, backend and frontend (4.1, 4.2). Shipped inside the multi-agent A2A network (§4.6).
- Voice pipeline data-model rework end-to-end: video-scoped ingestion (4.3), the durable-Voice / clip-assignment data model (4.4), and the Videos/Voices UI split (4.5).

### 6.2 Out of Scope for MVP

- ~~4.2 Phase 2 (concrete tool inventory).~~ `[RESOLVED 2026-08-27]` Shipped.
- ~~Migration of pre-existing `work/<character>/youtube/*` directories.~~ `[RESOLVED]` One-time re-ingest in development; no migration script.
- A server-side or browser-side runaway-tool-call cap (former FR-5) — see §4.1.

## 7. Success Metrics

**Primary**

- **SM-1**: An evaluator can, in one live session, ask the agent to act on the Voices dashboard and get a correct, state-aware follow-up answer, with no manual UI interaction between the two. Validates FR-1, FR-2, FR-3, FR-7, FR-8, FR-10.
- **SM-2**: `[UPDATED 2026-08-27]` A single Voice can be shown, live, to hold clips assigned from two or more distinct videos, with each source video visible in the Voice's clip list (Voices view: source-video count; training panel: per-clip video). Validates FR-14, FR-16, FR-19, FR-22, FR-27. (Originally "each contribution traceable in the UI" — the clip model has no per-video contribution record with a date.)

**Secondary**

- **SM-3**: Re-ingesting a previously-ingested video for a new character shows no re-download/re-transcribe/re-diarize step in logs or timing. Validates FR-12.
- **SM-4**: After 4.3's gateway-route migration, the Voices dashboard still loads clip lists, speaker maps, and clip audio with no functional regression. Validates FR-13, and the route-rename NFR under §4.3.

**Counter-metrics (do not optimize)**

- **SM-C1**: `[UPDATED 2026-08-27]` Tool-call turn count per conversation should not silently climb — a thrashing agent is not a capable one. (There is no `LLM_MAX_TOOL_TURNS` cap; the orchestrator ends its run after emitting calls — see §4.1.) Counterbalances SM-1.
- **SM-C2**: A rising source-video count on a Voice is not itself the goal — a well-trained single-source Voice beats a noisy multi-source one; per-clip audio quality should not be sacrificed to grow SM-2's count. Counterbalances SM-2.
- **SM-C3**: A cache hit on re-ingestion (SM-3) must still serve correct artifacts, not merely fast ones — reuse should not silently serve stale transcription/diarization if the source video changed. Counterbalances SM-3.

## 8. Open Questions

> `[ALL RESOLVED 2026-08-27]` — the code shipped. Kept here as a record.

1. ~~Concrete Phase-2 tool inventory for the new Videos/Voices actions.~~ **Resolved:** `copilot_tools.tsx` registers `addVideo`, `keepClips`, `discardClips`, `assignSpeaker`, `startTraining` — all `useFrontendTool` (reversible), none `useHumanInTheLoop`. No `approve_run`, no assign/commit/discard.
2. ~~Migration path for pre-existing `work/<character>/youtube/*` directories.~~ **Resolved:** one-time re-ingest in development; no migration script. Video-scoped layout is `work/youtube/<video_id>`.
3. ~~Dual training-trigger behavior in FR-20 — permanent or placeholder?~~ **Resolved:** both paths (`POST /voices/{id}/train` and auto-trigger on first clip assignment) are permanent.
4. ~~FR-10's frontend tool built against a UI that 4.5 then replaces — rework needed?~~ **Resolved:** the voice-pipeline rework shipped before the agent tool surface; the frontend tools were built once against the shipped Videos/Voices UI. No rework story was needed.

## 9. Assumptions Index

- From §2.1 — the primary audience is technical (engineers, evaluators) rather than a consumer end-user, inferred from the project's own framing as a reference architecture rather than a shipped product.
- ~~From FR-20 (§4.4) — both training triggers are intentionally concurrent, not a placeholder.~~ `[RESOLVED 2026-08-27]` Confirmed permanent; see §8 Q3.
