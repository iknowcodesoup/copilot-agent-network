---
stepsCompleted: [1, 2, 3]
inputDocuments:
  - _bmad-output/planning-artifacts/prds/prd-copilot_agent_network-2026-08-13/prd.md
  - _bmad-output/specs/spec-agui-tool-loop/brownfield.md
  - _bmad-output/specs/spec-agui-tool-loop/implementation-plan.md
  - _bmad-output/specs/spec-copilotkit-hook-surface/brownfield.md
  - _bmad-output/specs/spec-copilotkit-hook-surface/implementation-plan.md
  - _bmad-output/specs/spec-video-scoped-ingestion/brownfield.md
  - _bmad-output/specs/spec-video-scoped-ingestion/implementation-plan.md
  - _bmad-output/specs/spec-multi-voice-data-model/brownfield.md
  - _bmad-output/specs/spec-multi-voice-data-model/implementation-plan.md
  - _bmad-output/specs/spec-videos-and-voices-views/brownfield.md
  - _bmad-output/specs/spec-videos-and-voices-views/implementation-plan.md
---

# copilot_agent_network - Epic Breakdown

> **Reconciled 2026-08-27.** Every epic in this document is delivered. The
> voice data model (Epic 3) shipped on a clip-based assignment model, not the
> run-based `assign`/`commit`/`voice_contributions` model these stories
> describe — reversed once on 2026-08-16, again in the weeks after. FR-5 was
> dropped. Two bodies of work shipped with no epic and are recorded below as
> **Post-plan Epic A** (multi-agent A2A network) and **Post-plan Epic B**
> (factory source of truth). Every changed requirement carries a dated
> `[DELIVERED]` / `[SUPERSEDED]` / `[OUT OF SCOPE]` tag. Full record:
> `sprint-change-proposal-2026-08-27.md`.

## Overview

This document provides the complete epic and story breakdown for copilot_agent_network, decomposing the requirements from the PRD (`prd-copilot_agent_network-2026-08-13`) and the technical detail in the five source spec kernels' brownfield/implementation-plan files (no dedicated Architecture.md or UX design contract exists for this project) into implementable stories.

## Requirements Inventory

### Functional Requirements

FR1: A request carrying `agent_input.tools` maps them to the model's `tools=` shape with `tool_choice="auto"`; a request with no tools omits both arguments and behaves identically to today.
FR2: A tool call the model makes emits `ToolCallStartEvent` → one or more ordered `ToolCallArgsEvent` → `ToolCallEndEvent`, reassembled from the model stream's per-index fragments, with reassembled argument text exactly matching what the model sent.
FR3: After tool calls are emitted, the server issues `RunFinishedEvent` and takes no further action for that run — it never blocks waiting for a tool result, since frontend tools execute in-browser.
FR4: `TextMessageStartEvent` fires only on the first non-empty content delta. A tool-only turn opens no empty text message; a turn with both text and a tool call opens exactly one text message.
FR5: `[OUT OF SCOPE — 2026-08-27]` Never implemented. The Orchestrator emits tool calls and ends the run (FR3); it never loops server-side on tool results, so there is no turn count to cap. `LLM_MAX_TOOL_TURNS` was never added. A cap belongs on the browser follow-up loop and is a new item. See `sprint-change-proposal-2026-08-27.md`.
FR6: The `chat_agent.py` module docstring, which currently states tools are unsupported, is rewritten to match the new behavior.
FR7: The currently expanded/selected run ID is published via `useAgentContext`; asking the agent "which run is open" names the correct run.
FR8: A static `useAgentContext` payload describes ingestion phases and which action is legal in each phase.
FR9: `useAgentContext` placement follows the owning component — collapsing a run card removes its context; the agent stops referencing that card's detail once collapsed.
FR10: One `useFrontendTool` lets the agent expand a specified run, wherever runs are currently listed in the UI. Asking the agent to open a different run results in that run's card expanding in the browser, unprompted by a click.
FR11: `useConfigureSuggestions` seeds starter prompts from the runs currently on screen; the suggestion set changes when the visible run set changes.
FR12: Claiming an already-ingested video for a new character triggers no download, transcribe, or diarize step — cached artifacts are reused by video ID.
FR13: `GET /videos` returns ingested video IDs with diarization status; `GET /videos/{id}/speakers` returns speaker labels with clip counts, without reference to any one character.
FR14: A commit payload shaped `{video_id: {speaker_label: character}}` can grow multiple named characters' datasets from multiple videos in a single call.
FR15: Running preprocess after new clips land regenerates the training config; running it again with no new clips is a no-op.
FR16: `[DELIVERED 2026-08-27 — "clips", not "contributions"]` The system represents a Voice (`id`, `name`, `phase`, `checkpoint_path`) independent of any single video via a `voices` table, exposed via `POST /voices` (create), `GET /voices/{id}` (fetch with assigned clips), and `PATCH /voices/{id}` (rename).
FR17: `[SUPERSEDED 2026-08-27 — no COMMITTED phase]` `[DELIVERED — separate state machines]` Run `phase` (`DOWNLOADING`/`DIARIZING`/`INGESTED`/`FAILED`) and Voice `phase` (`AWAITING_COMMIT`/`COMPILING`/`TRAINING`/`EXPORTING`/`READY`/`FAILED`) are on separate tables; neither drives the other. Review is not a Run phase. (2026-08-16 had briefly made a `COMMITTED` run move the Voice to `TRAINING`; dropped.)
FR18: `[SUPERSEDED 2026-08-27 — no run-scoped assign/commit route]` `[DELIVERED — clip-based]` `POST /voices/{id}/clips` assigns a video's clip IDs to a Voice; `/clips/unassign` removes them. Per-clip, append-only, touches no Run phase.
FR19: `[SUPERSEDED 2026-08-27 — the (voice, run, speaker) triple and voice_contributions table were never shipped]` `[DELIVERED — clip assignment is the record]` Each clip carries at most one Voice assignment on its `voice_clips` row; the clip and audio are never mutated; reassignment overwrites the one field.
FR20: `[DELIVERED 2026-08-27]` `POST /voices/{id}/train` triggers training explicitly (any phase); training also triggers automatically when clips are first assigned to a Voice. Both paths permanent.
FR21: `[DELIVERED 2026-08-27]` One LangGraph per video for ingestion (`voice_run_graph.py`); a separate LangGraph per Voice for training (`voice_training_graph.py`), triggered when clips are assigned. No shared node code.
FR22: `[SUPERSEDED 2026-08-27 — "all contributions joined to run/video" is now "all clips with their video"]` `[DELIVERED]` The repository answers "all clips assigned to this Voice, each with its video" (`list_clips_for_voice`, `list_clips_for_voices`) and "fetch Voice by name" (`get_voice_by_name`).
FR23: `[DELIVERED 2026-08-27 — client tab state, not App Router segments]` A tab segment switches between Videos, Voices, and Search views; each renders independently, no full reload.
FR24: `[DELIVERED 2026-08-27]` The Videos view lists each video's title, source URL, detected-speaker count, and diarization status; expanding a video shows its clips in a table (transcript, keep/exclude, quality flag, assigned Voice or "unassigned").
FR25: `[DELIVERED 2026-08-27]` Speaker naming uses a combobox that searches existing Voices or creates one inline.
FR26: `[SUPERSEDED 2026-08-27 — clip-based, not the voice_contributions write named on 2026-08-16]` `[DELIVERED]` Picking a Voice for a speaker in the combobox assigns that speaker's clips in one call and, on the Voice's first assignment, starts training. No commit or discard step. Speakers across any number of videos assign independently, in any order.
FR27: `[SUPERSEDED 2026-08-27 — trimmed]` `[DELIVERED]` The Voices view shows a card per Voice: name (editable inline), phase pill, kept-clip count, source-video count, total kept duration. Selecting a Voice opens a training panel with its kept/excluded clips and one "Start training" action calling `POST /voices/{id}/train`. **Not built:** contributing-videos popover with assignment dates, "Train now"/"Retrain" split, model-size display, "Download model", "View clips" modal.

### NonFunctional Requirements

NFR1: The agent tool-calling loop stays `async def` throughout — no new blocking calls (4.1).
NFR2: Hook selection in the CopilotKit surface is governed by a fixed Need-to-Hook policy table (read-only → `useAgentContext`; reversible → `useFrontendTool`; costly/destructive → `useHumanInTheLoop`; server-tool custom UI → `useRenderTool`; suggestions → `useConfigureSuggestions`; status → `useAgent`) — a binding constraint, not a style preference; CopilotKit v1 hooks (`useCopilotReadable`, `useCopilotAction`) are banned from new code (4.2).
NFR3: All five gateway-bound routes touched by video-scoped ingestion (`get_clips`, `update_clips`, `set_speaker_map`, `stream_clip_audio`, `get_training_progress`) update in the same change as the `VoiceFactoryGateway` call sites that depend on them — a hard breaking-change pairing across the `copilot_agent_network` / `star-trek-voyicer` repo boundary, not two independent rollouts (4.3). `[DELIVERED 2026-08-27]`
NFR4: `[DELIVERED 2026-08-27]` All voice persistence uses SQLAlchemy 2.0 async via `Base.metadata.create_all` — no raw SQL, no Alembic. `voices` and `voice_clips` are the new tables; `voice_contributions` was never created.

### Additional Requirements

- **Cross-repo breaking-change pairing**: the video-scoped-ingestion gateway route changes span two repositories (`copilot_agent_network`'s `VoiceFactoryGateway` and `star-trek-voyicer`'s control API) and must land together — no independent deploy ordering is safe (spec-video-scoped-ingestion brownfield.md/implementation-plan.md).
- **Filesystem layout migration**: ingestion artifacts move from a character-scoped path (`work/<character>/youtube/*`) to a video-scoped path (`work/videos/<video_id>/`). Resolved: one-time re-ingest accepted in development, no migration script (PRD Open Question 2).
- **New backend LangGraph**: a second graph (`VoiceReconciler`/voice-training graph) runs alongside the existing `VoiceRunReconciler`/ingestion graph — two independent state machines, not a modification of the existing one (spec-multi-voice-data-model implementation-plan.md).
- **New repository classes**: `VoiceRepository` and `VoiceContributionRepository` are net-new, following the existing repository-per-concern pattern (`repositories/` in pythonapi) (spec-multi-voice-data-model implementation-plan.md).
- **`voice_runs` schema trim**: training-related columns move out of `voice_runs` into the new `voices` table. `Base.metadata.create_all` does not alter existing tables, so `voice_runs` is dropped and recreated in development — no migration tooling (Alembic) is introduced in this pass (spec-multi-voice-data-model brownfield.md).
- **New frontend components**: `videos_view.tsx`, `voice_card.tsx`, `voice_speaker_combobox.tsx`, `voices_view.tsx` are net-new; `speaker_board.tsx` and `page.tsx` are refactored, not replaced (spec-videos-and-voices-views implementation-plan.md).
- **New/updated frontend hooks**: `useVoiceRuns`, `useVoices`, `useVoiceContributions` back the new views and must track the assign/commit split from 4.4 (spec-videos-and-voices-views implementation-plan.md).
- **Existing playback flow preserved**: the `speaker_board` clip audio-quality review/playback flow carries over unchanged into the new views — not rebuilt (spec-videos-and-voices-views brownfield.md; PRD §4.5 Out of Scope).

### UX Design Requirements

No UX design contract exists for this project. Skipped.

### FR Coverage Map

> `[RECONCILED 2026-08-27]` — status appended to each line.

FR1: Epic 1 - Tool definitions reach the model — DELIVERED (agents/orchestrator/chat_agent.py)
FR2: Epic 1 - Tool-call events stream in order — DELIVERED
FR3: Epic 1 - Run ends after emitting tool calls — DELIVERED
FR4: Epic 1 - Lazy text-message opening — DELIVERED
FR5: Epic 1 - Runaway tool-calling is capped — OUT OF SCOPE (no server-side loop to cap; 2026-08-27)
FR6: Epic 1 - Documentation matches behavior — DELIVERED
FR7: Epic 1 - Expanded-run state published to the agent — DELIVERED (copilot_tools.tsx)
FR8: Epic 1 - Phase-legal actions published to the agent — DELIVERED
FR9: Epic 1 - Context ownership follows the UI — DELIVERED
FR10: Epic 1 - Agent can expand a run on the user's behalf — DELIVERED
FR11: Epic 1 - Starter suggestions track visible state — DELIVERED (static useConfigureSuggestions)
FR12: Epic 2 - Re-ingesting a known video costs nothing — DELIVERED
FR13: Epic 2 - Videos/speakers queryable independent of character — DELIVERED
FR14: Epic 2 - One commit routes many videos to many characters — DELIVERED
FR15: Epic 2 - Preprocessing only regenerates what changed — DELIVERED
FR16: Epic 3 - Voice is a durable, independent entity — DELIVERED (holds clips, not "contributions")
FR17: Epic 3 - Run phase and voice phase are separate state machines — DELIVERED; no COMMITTED phase (SUPERSEDED)
FR18: Epic 3 - Assigning a video's clips to a Voice is one call — DELIVERED (POST /voices/{id}/clips); no run-scoped assign/commit (SUPERSEDED)
FR19: Epic 3 - A clip's Voice assignment is the immutable audit record — DELIVERED; voice_contributions never shipped (SUPERSEDED)
FR20: Epic 3 - Training triggered explicitly or automatically — DELIVERED
FR21: Epic 3 - Ingestion and voice training run as separate state machines — DELIVERED
FR22: Epic 3 - Voice-centric queries at the repository layer — DELIVERED (clips, not contributions) (SUPERSEDED wording)
FR23: Epic 3 - Videos and Voices are separate views — DELIVERED (client tabs, not routes)
FR24: Epic 3 - Videos view surfaces ingestion state per video — DELIVERED
FR25: Epic 3 - Speaker naming is search-or-create — DELIVERED
FR26: Epic 3 - Assigning a speaker is immediate; no separate commit/discard — DELIVERED (clip-based) (SUPERSEDED wording)
FR27: Epic 3 - Voices view surfaces training state per voice — DELIVERED, trimmed (no popover / model download / View clips modal) (SUPERSEDED wording)

## Epic List

### Epic 1: Agent Tool-Calling on the Voices Dashboard

Backend and frontend together: the agent can call a browser-registered tool, and the Voices dashboard registers one — expanding a run — plus publishes phase-aware context and status. Delivers UJ-1 and UJ-2 end-to-end; the backend half (4.1) alone has no user-visible outcome, so it is one epic with ordered stories, not two.
**FRs covered:** FR1, FR2, FR3, FR4, FR5, FR6, FR7, FR8, FR9, FR10, FR11
**NFRs covered:** NFR1, NFR2
**Status:** `[DELIVERED 2026-08-27]` Shipped inside Post-plan Epic A (multi-agent A2A). The tool loop lives in `agents/orchestrator/chat_agent.py`; the hook surface in `features/chat/copilot_tools.tsx`. FR1–4, 6, 7–11 satisfied. **FR5 → out of scope** — the Orchestrator ends its run after emitting tool calls, so there is no server-side loop to cap. The `useAgent` status indicator (Story 1.6) was not built.

### Epic 2: Reusable Video Ingestion

An operator can ingest a video once and reuse it for any number of characters, with one commit routing several videos' speakers to several characters at once. Delivers UJ-4 standalone — works against the existing dashboard UI immediately, no dependency on Epic 3.
**FRs covered:** FR12, FR13, FR14, FR15
**NFRs covered:** NFR3
**Status:** `[DELIVERED]` Unchanged since 2026-08-15.

### Epic 3: Multi-Video Voice Building

An operator can build one durable Voice from clips assigned from several videos over time; assigning a speaker's clips is immediate; the operator manages that Voice from a dedicated view. Delivers UJ-3 end-to-end. Depends on Epic 2 for its gateway contract and filesystem layout.
**FRs covered:** FR16, FR17, FR18, FR19, FR20, FR21, FR22, FR23, FR24, FR25, FR26, FR27
**NFRs covered:** NFR4
**Status:** `[DELIVERED 2026-08-27]` Shipped on a **clip-based assignment model**, not the run-based `assign`/`commit`/`voice_contributions` model these stories describe. The model was reversed once on 2026-08-16 (assign/commit flattened) and again in the weeks after (moved to per-clip assignment on the Voice resource; `voice_contributions` and `COMMITTED` dropped entirely). Stories 3.1, 3.4, 3.6 delivered in substance; 3.2, 3.3, 3.5 superseded at the mechanism level. See `sprint-change-proposal-2026-08-27.md`.

**Cross-epic sequencing (as built):** Epic 2 → Epic 3 → (Post-plan Epic A, which absorbed Epic 1). FR-10's frontend tools were built once against the shipped Videos/Voices UI — no rework story was needed.

## Epic 2: Reusable Video Ingestion

An operator can ingest a video once and reuse it for any number of characters, with one commit routing several videos' speakers to several characters at once. Delivers UJ-4 standalone.

### Story 2.1: Reuse Ingested Videos Across Characters

As an operator,
I want the system to treat video ingestion as independent of character, and reuse a video's cached download/transcript/diarization artifacts when I claim it for a new character,
So that adding an already-ingested video to a second character's dataset costs nothing extra.

**Acceptance Criteria:**

**Given** a video has already been ingested (downloaded, transcribed, diarized) for one character
**When** an operator claims that same video for a different character
**Then** no download, transcribe, or diarize step runs, and the cached artifacts are reused by video ID (FR12)

**Given** the video-scoped gateway routes are live
**When** a caller requests `GET /videos`
**Then** it returns ingested video IDs with diarization status, with no character scoping (FR13)
**And** `GET /videos/{id}/speakers` returns that video's detected speaker labels with clip counts, with no character scoping (FR13)

**Given** all five gateway-bound routes (`get_clips`, `update_clips`, `set_speaker_map`, `stream_clip_audio`, `get_training_progress`) have moved together in this one change (NFR3)
**When** the Voices dashboard loads against the migrated routes
**Then** it still loads clip lists, speaker maps, and clip audio with no functional regression (SM-4)

**And** no migration script is written for pre-existing `work/<character>/youtube/*` directories — a one-time re-ingest in development is accepted (PRD Open Question 2, resolved)

### Story 2.2: Route One Commit to Multiple Characters Across Multiple Videos

As an operator,
I want a single commit to route speaker labels from one or more videos to multiple characters at once,
So that I don't have to repeat the commit step per video per character.

**Acceptance Criteria:**

**Given** speaker labels have been reviewed across one or more ingested videos
**When** an operator submits a commit payload shaped `{video_id: {speaker_label: character}}`
**Then** every named character's dataset grows from every video/speaker pair in the payload, in a single call (FR14)

### Story 2.3: Skip Redundant Preprocessing

As an operator,
I want preprocessing to regenerate the training config only when new clips actually landed,
So that repeated preprocessing runs don't waste time.

**Acceptance Criteria:**

**Given** new clips have landed in a character's dataset since the last preprocess
**When** preprocessing runs
**Then** the training config is regenerated (FR15)

**Given** no new clips have landed since the last preprocess
**When** preprocessing runs again
**Then** it is a no-op (FR15)

## Epic 3: Multi-Video Voice Building

An operator can build one durable Voice from clips assigned from several videos over time; assignment is immediate; the operator manages that Voice from a dedicated view.

> `[DELIVERED 2026-08-27 — clip-based]` These stories describe a run-based
> `assign`/`commit`/`voice_contributions` model that was reversed twice and
> never shipped. The stories below keep their original text; each carries a
> dated note where the code diverges. Ground truth: `voice_clips` table,
> `POST /voices/{id}/clips`, per-clip keep/exclude review. See
> `sprint-change-proposal-2026-08-27.md`.

### Story 3.1: Create the Durable Voice Entity

> `[DELIVERED 2026-08-27]` `voices` table, `POST /voices`, `GET /voices/{id}`,
> `PATCH /voices/{id}` (rename) all shipped. `GET /voices/{id}` returns the
> Voice with its assigned **clips**, not "contributions" — there is no
> contributions table.

As an operator,
I want a Voice to exist as a durable entity independent of any single video,
So that I can build one voice's training data from many videos over time.

**Acceptance Criteria:**

**Given** no voice exists yet with a given name
**When** an operator creates a voice via `POST /voices`
**Then** a new `voices` row is created (id, name, phase, checkpoint_path) (FR16)

**Given** a voice exists
**When** a caller requests `GET /voices/{id}`
**Then** it returns the voice with its contributions (FR16)

**Given** the new `voices` table is introduced in this story
**When** the schema change lands
**Then** `voice_runs` is trimmed to its ingestion-related fields only, with training-related columns moved to `voices`, and no migration tooling is introduced — the table is recreated in development (NFR4)

### Story 3.2: Flatten Assignment and Commit Into One Immediate, Audited Action

> `[SUPERSEDED 2026-08-27]` The `voice_contributions` audit trail, the
> `voice_contributions` table, `POST /runs/{id}/assign`, and the `COMMITTED`
> run phase this story's ACs name were **all dropped**. Shipped instead:
> `POST /voices/{id}/clips` assigns a video's clip IDs to a Voice; the audit
> record is the assignment on the `voice_clips` row itself. The story text
> below is kept as history. See `sprint-change-proposal-2026-08-27.md`.

`[SUPERSEDED 2026-08-16 — see sprint-change-proposal-2026-08-16.md and spec-3-2-flatten-assign-commit.md, status done]` This story replaces the original "Split Assignment From Commit, With an Audit Trail" — the adopted UI design has no assign/review/commit distinction, so the split is reversed by user decision. The `voice_contributions` audit trail and repository-layer queries survive unchanged; only the trigger point (assign, not a separate commit) and the removal of `discard` change.

As an operator,
I want assigning a video's speaker to a voice to commit immediately, with an audit trail preserved,
So that I don't have to perform a separate commit step for an association I already intend to keep.

**Acceptance Criteria:**

**Given** a video has detected speakers and one or more voices exist (Story 3.1)
**When** an operator calls `POST /runs/{id}/assign`
**Then** the speakers are associated with voices, one immutable `voice_contributions` row is created per (voice, run, speaker) triple, and `ingest_phase` advances to `COMMITTED` — all in one call (FR17, FR18, FR19)

**Given** all speakers in the request are mapped to `None`
**When** an operator calls `POST /runs/{id}/assign`
**Then** no contribution rows are written and the run stays `AWAITING_REVIEW` (400)

**Given** a run is not in `AWAITING_REVIEW` (e.g. already `COMMITTED`)
**When** an operator calls `POST /runs/{id}/assign` again
**Then** nothing is persisted (409) — there is no discard/undo action, since there is no draft state to discard once assign commits

**Given** contributions exist for a voice
**When** the repository is queried
**Then** it returns all contributions for that voice joined to run/video, and can fetch a voice by name (FR22)

### Story 3.3: Trigger Training Explicitly or Automatically, Independent of Ingestion

> `[DELIVERED 2026-08-27]` Both trigger paths work: `POST /voices/{id}/train`
> (explicit, any phase) and an automatic wake of `VoiceTrainingReconciler`
> when clips are assigned to a Voice. The per-Voice LangGraph
> (`voice_training_graph.py`) is separate from the per-video ingestion graph.
> "Contribution" in the ACs below means "clip assignment" now.

`[REVISED 2026-08-16]` AC1's trigger changed from "the commit that creates [the first contribution]" to "the assign call that creates it," matching Story 3.2's merge. The rest of this story (explicit train call, per-voice LangGraph) is unaffected. Confirmed no separate "first contribution" special-case exists in `voice_training_reconciler.py` — training triggers on every assign that touches a voice, same as it triggered on every commit before.

As an operator,
I want training to start either automatically on a voice's first contribution or by an explicit call, running independently of video ingestion,
So that training doesn't block on or get blocked by ingestion state.

**Acceptance Criteria:**

**Given** a voice receives its first contribution (Story 3.2)
**When** the assign call that creates it completes
**Then** training triggers automatically (FR20)

**Given** a voice already has contributions
**When** an operator calls `POST /voices/{id}/train`
**Then** training triggers explicitly, regardless of the automatic path (FR20)

**Given** ingestion and training are independent concerns
**When** either runs
**Then** it runs on its own LangGraph — one per video for ingestion, one per voice for training (FR21)

### Story 3.4: Split the Dashboard into Videos and Voices Views

> `[DELIVERED 2026-08-27]` Shipped as client tab state
> (`type View = "videos" | "voices" | "search"` in `studio_provider.tsx`),
> not App Router segments as the ACs imply. Each view renders independently
> with no full reload.

As an operator,
I want Videos and Voices as separate views,
So that I can focus on ingestion review or voice management without the other cluttering the screen.

**Acceptance Criteria:**

**Given** the dashboard loads
**When** an operator uses the nav/tab segment
**Then** the Videos view and Voices view render independently, each reachable without a full page reload (FR23)

### Story 3.5: Review Ingestion and Assign Speakers in the Videos View

> `[DELIVERED 2026-08-27 — clip-based]` Videos view + per-video clip table +
> search-or-create speaker combobox all shipped. Picking a Voice for a
> speaker assigns that speaker's clips (`POST /voices/{id}/clips`) and, on the
> Voice's first assignment, starts training. There is no `COMMITTED` phase
> and no run-phase change — AC3's "advances the run to `COMMITTED`" does not
> happen. The clip audio-quality review/playback flow is preserved, and a
> per-clip trim/zoom editor was added on top.

`[REVISED 2026-08-16]` ACs referencing "Commit assignments" and "Discard" buttons are removed — there is no separate commit or discard step. "Assign speakers" is rewritten to describe the single immediate action: picking a voice for a speaker in the combobox commits it right away.

As an operator,
I want to review a video's detected speakers and assign them to voices by searching or creating, with the assignment committing immediately,
So that I don't need a separate step to lock in an association I already intend to keep.

**Acceptance Criteria:**

**Given** ingested videos exist
**When** an operator opens the Videos view
**Then** it lists video title, source URL, speaker count, and diarization status; expanding a row shows detected speaker clips labeled "awaiting assignment" or "assigned to voice X" (FR24)

**Given** an operator is naming a speaker
**When** they use the speaker combobox
**Then** it searches existing voices or creates a new one inline — no free text (FR25)

**Given** a video's speakers are unassigned
**When** an operator picks a voice for a speaker in the combobox
**Then** one call persists the contribution, advances the run to `COMMITTED`, and starts training on that voice — no separate commit or discard action is shown (FR26)

**Given** multiple videos have pending speakers
**When** an operator works through them
**Then** each speaker can be assigned independently and in any order — assigning one speaker does not block or require assigning others first (FR26)

**And** the existing `speaker_board` clip audio-quality review/playback flow is preserved unchanged

### Story 3.6: Manage Voice Training From the Voices View

> `[DELIVERED 2026-08-27 — trimmed]` Shipped: a Voice card (name editable
> inline, phase pill, kept-clip count, source-video count, total kept
> duration) and a training panel with kept/excluded clip lists and one
> "Start training" button (`POST /voices/{id}/train`). **Not built:** the
> contributing-videos popover with assignment dates (AC2), "Download model"
> (AC5), model-size display (AC1), the "Train now"/"Retrain" split (AC3), and
> the "View clips" **modal** (AC4 — the clip list is inline, not a modal).
> The clip model keeps no per-video contribution record with a date.

`[REVISED 2026-08-16]` A voice with any contribution is already training or trained the moment it's assigned, since assign-implies-train now — so the phase-conditional "Train now" action (gated on the old `AWAITING_COMMIT` two-phase model) collapses. Only the standing "Retrain" action remains, matching the adopted design's `voice_card.tsx`.

As an operator,
I want to see each voice's training state and manage it — view clips, retrain, download — from one card,
So that I don't have to piece its status together from the ingestion side.

**Acceptance Criteria:**

**Given** one or more voices exist
**When** an operator opens the Voices view
**Then** each shows as a card: name, phase, total clip count, and model size once `READY` (FR27)

**Given** a voice has contributing videos
**When** an operator views its card
**Then** a contributing-videos count badge opens a popover listing each video, its clip count, and assignment date (FR27)

**Given** a voice exists in any phase
**When** an operator views its card
**Then** a standing "Retrain" action is always available, independently re-triggering `POST /voices/{id}/train` (FR27, FR20)

**Given** a voice has any contributions
**When** an operator clicks "View clips"
**Then** a modal lists every clip across all of that voice's contributing videos (FR27)

**Given** a voice has reached `READY`
**When** an operator views its card
**Then** "Download model" is active (FR27)

## Epic 1: Agent Tool-Calling on the Voices Dashboard

Backend and frontend together: the agent can call a browser-registered tool, and the Voices dashboard registers one — expanding a run — plus publishes phase-aware context and status.

> `[DELIVERED 2026-08-27 — inside Post-plan Epic A]` The tool loop is
> `agents/orchestrator/chat_agent.py` (not `core/chat_agent.py`); the hook
> surface is `features/chat/copilot_tools.tsx`. Stories 1.1, 1.3, 1.4, 1.5
> delivered. **Story 1.2 → out of scope** — no `LLM_MAX_TOOL_TURNS`, no
> server-side loop to cap. **Story 1.6** (`useAgent` working/idle indicator)
> not built. See `sprint-change-proposal-2026-08-27.md`.

### Story 1.1: Forward Tool Definitions and Stream Tool-Call Events

As the platform's builder,
I want the backend to forward registered tool definitions to the model and stream back correctly ordered tool-call events,
So that a browser-registered tool actually becomes callable instead of invisible to the model.

**Acceptance Criteria:**

**Given** a request carries `agent_input.tools`
**When** the completion call is made
**Then** those tools map to the model's `tools=` shape with `tool_choice="auto"`; a request with no tools omits both arguments and behaves identically to today (FR1)

**Given** the model makes a tool call
**When** its stream is reassembled
**Then** `ToolCallStartEvent`, one or more ordered `ToolCallArgsEvent`, and `ToolCallEndEvent` are emitted, with reassembled argument text exactly matching what the model sent (FR2)

**Given** tool calls have been emitted
**When** the run completes
**Then** the server issues `RunFinishedEvent` and takes no further action — it never blocks waiting for a tool result (FR3)

**Given** a turn produces only a tool call
**When** `TextMessageStartEvent` would normally fire
**Then** it fires only on the first non-empty content delta — a tool-only turn opens no empty text message, and a turn with both text and a tool call opens exactly one (FR4)

**And** the `chat_agent.py` module docstring is rewritten to match this behavior (FR6)
**And** the tool loop stays `async def` throughout — no new blocking calls (NFR1)

### Story 1.2: Cap Runaway Tool-Calling

> `[OUT OF SCOPE — 2026-08-27]` Not built. The Orchestrator emits tool calls
> and ends the run; it never loops server-side on tool results, so there is
> no turn count to cap and `LLM_MAX_TOOL_TURNS` was never added. A cap
> belongs on the browser follow-up loop and is a new item. See
> `sprint-change-proposal-2026-08-27.md`.

As the platform's builder,
I want a model that keeps calling tools without a final answer to be capped,
So that a conversation can't loop indefinitely on tool calls.

**Acceptance Criteria:**

**Given** a tool-calling turn count derived statelessly from `agent_input.messages`
**When** that count exceeds `LLM_MAX_TOOL_TURNS` (a `Settings` field with a real, non-`None` default)
**Then** the server forces a text answer instead of permitting another tool call (FR5)

### Story 1.3: Publish Run and Phase Context to the Agent

As an evaluator,
I want the agent to know which run is expanded and what's legal to do with it,
So that its answers reflect the actual state on screen instead of a generic capability list.

**Acceptance Criteria:**

**Given** a run is expanded/selected in the browser
**When** the agent is asked "which run is open"
**Then** it names the correct run, published via `useAgentContext` (FR7)

**Given** a run's ingestion phase
**When** the agent is asked what actions are available
**Then** it answers from a static `useAgentContext` payload describing phases and their legal actions (FR8)

**Given** a run card is collapsed
**When** the agent is asked about that run afterward
**Then** it no longer references that card's detail — `useAgentContext` placement follows the owning component (FR9)

**And** hook selection throughout this epic's frontend stories follows the fixed Need-to-Hook policy table; CopilotKit v1 hooks are not used (NFR2)

### Story 1.4: Let the Agent Expand a Run

As an evaluator,
I want to ask the agent to open a specific run and have it actually expand in the browser,
So that the agent demonstrably acts on the UI, not just narrates it.

**Acceptance Criteria:**

**Given** several runs are listed in the UI
**When** an evaluator asks the agent to open a specific one
**Then** a registered `useFrontendTool` expands that run's card in the browser, unprompted by a click, wherever runs are currently listed (FR10)

### Story 1.5: Seed Starter Suggestions From Visible Runs

> `[DELIVERED 2026-08-27 — static, not run-seeded]` `copilot_tools.tsx`
> registers `useConfigureSuggestions` with a fixed list naming the studio's
> verbs. A comment there records the choice: a generated set would cost a
> model call per thread to say the same thing. FR11's "reseeds from visible
> runs" is not literally met; the intent (relevant starters) is.

As an evaluator,
I want starter prompt suggestions that reflect the runs currently on screen,
So that the suggestions stay relevant as the run list changes.

**Acceptance Criteria:**

**Given** the set of runs visible on screen
**When** that set changes
**Then** `useConfigureSuggestions` reseeds starter prompts from the currently visible runs (FR11)

### Story 1.6: Show Agent Working/Idle Status

> `[NOT BUILT — 2026-08-27]` No `useAgent` working/idle indicator ships in
> the sidebar header. Low-priority acceptance-criterion-level item; left
> undone. See `sprint-change-proposal-2026-08-27.md`.

As an evaluator,
I want to see whether the agent is actively working,
So that I know when to expect a response.

**Acceptance Criteria:**

**Given** the agent is processing an active run
**When** the sidebar header is visible
**Then** it reflects the agent's run status (working vs. idle), via `useAgent`

*(No numbered FR — deprioritized to an acceptance-criterion-level item per PRD §4.2 Notes; carried into this story per that note's instruction.)*

---

## Post-plan Epic A: Multi-Agent A2A Network

`[DELIVERED 2026-08-27 — never planned through bmad-create-epics; recorded after the fact]`

Source: `spec-multi-agent-a2a` (SPEC + companions under
`_bmad-output/specs/spec-multi-agent-a2a/`). This work replaced the single
chat agent and absorbed Epic 1's tool-calling loop.

An Orchestrator agent is the only agent the browser talks to. It classifies
each AG-UI request as `research`, `voice`, `research_and_voice`, or `general`
and routes it to a specialist over the A2A protocol, falling back to an LLM
router only when deterministic rules cannot classify safely. A Research Agent
answers research questions with the existing `RagPipeline` and returns sourced
answers; it never touches voice run state. A Voice Agent drives the existing
voice API and factory; it never queries Qdrant. `voice_runs.phase` and
`VoiceRunReconciler` stay the only source of truth and only writer of run
phases. The Orchestrator discovers each specialist's skills from its published
Agent Card via Agentic Resource Discovery (ARD); a configured URL per
specialist is the transport fallback. A specialist being down degrades only
its own capability. Every delegation is traceable end to end in Langfuse.

**Delivered:** `agents/{orchestrator,research,voice}/` (each with `app.py`,
`card.py`, `executor.py`, `interface.py`), `a2a_support/`,
`core/ard_catalog.py`, `routes/ard.py`.
**Tests:** `test_orchestrator_agent.py`, `test_orchestrator_delegation.py`,
`test_research_agent.py`, `test_voice_agent.py`, `test_agent_tools.py`,
`test_ard.py`.
**Absorbs:** all of Epic 1 except Story 1.2 (out of scope) and Story 1.6 (not built).

**Out of scope (per the source spec):** MCP not adopted. No A2A push
notifications. ARD `trustManifest` / SPIFFE / JWS signing out — placeholder
publisher domain, stated as such. CI mocks the factory and GPU training.
Authenticated A2A required in production config; unauthenticated internal
calls accepted for local development only.

## Post-plan Epic B: Factory Is the Source of Truth

`[DELIVERED 2026-08-27 — merged as PR #20]`

Source: `spec-factory-source-of-truth`. The voice factory host owns clip
decisions — `review.csv` on the factory host is the one source of truth for
keep/exclude. `pythonapi` stores run and voice state and nothing on disk.

## Out of scope — shipped without a spec

Recorded for completeness. These landed in `main` between 2026-08-13 and
2026-08-27 and were never planned:

- Postgres-backed clip storage — `voice_clips` table, `repositories/voice_clips.py`
- Per-clip trim / zoom range editor — `clip_trim_bar.tsx`
- Per-clip transcription editing with auto-update
- Collapsible dashboard panels
- TLS for local / LAN via the nginx proxy — `infra/nginx/`
- Editable voice names — `editable_voice_name.tsx`, `PATCH /voices/{id}`
- Unreviewed-clip state and "assign all clips" review flow
