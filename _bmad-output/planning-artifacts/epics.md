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

## Overview

This document provides the complete epic and story breakdown for copilot_agent_network, decomposing the requirements from the PRD (`prd-copilot_agent_network-2026-08-13`) and the technical detail in the five source spec kernels' brownfield/implementation-plan files (no dedicated Architecture.md or UX design contract exists for this project) into implementable stories.

## Requirements Inventory

### Functional Requirements

FR1: A request carrying `agent_input.tools` maps them to the model's `tools=` shape with `tool_choice="auto"`; a request with no tools omits both arguments and behaves identically to today.
FR2: A tool call the model makes emits `ToolCallStartEvent` → one or more ordered `ToolCallArgsEvent` → `ToolCallEndEvent`, reassembled from the model stream's per-index fragments, with reassembled argument text exactly matching what the model sent.
FR3: After tool calls are emitted, the server issues `RunFinishedEvent` and takes no further action for that run — it never blocks waiting for a tool result, since frontend tools execute in-browser.
FR4: `TextMessageStartEvent` fires only on the first non-empty content delta. A tool-only turn opens no empty text message; a turn with both text and a tool call opens exactly one text message.
FR5: A model that keeps calling tools without producing a final answer is capped by `LLM_MAX_TOOL_TURNS`: once the count exceeds `LLM_MAX_TOOL_TURNS`, the server forces a text answer instead of permitting another tool call.
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
FR16: The system represents a Voice (id, name, `phase`, `checkpoint_path`) independent of any single video via a `voices` table, exposed via `POST /voices` to create a named Voice and `GET /voices/{id}` to fetch a Voice with its contributions.
FR17: Run `ingest_phase` and Voice `phase` are tracked separately; a Run reaching `COMMITTED` does not itself change any Voice's phase.
FR18: `POST /runs/{id}/assign` associates a video's speakers with Voices without changing `ingest_phase`. `POST /runs/{id}/commit` separately creates immutable Voice Contribution records and advances `ingest_phase` to `COMMITTED`.
FR19: One `voice_contributions` row is created per (voice, run, speaker) triple on commit; rows are never updated in place.
FR20: `POST /voices/{id}/train` triggers training explicitly; training also triggers automatically on a Voice's first contribution.
FR21: One LangGraph per video handles ingestion; a separate LangGraph per Voice handles training, triggered on contribution commit.
FR22: The repository layer answers "all contributions for this voice, joined to run/video" and "fetch voice by name," in addition to existing run-centric queries.
FR23: A tab or nav segment switches between a Videos view and a Voices view; each renders independently.
FR24: The Videos view lists video title, source URL, speaker count, and diarization status; expanding a row shows its detected speaker clips, each labeled "awaiting assignment" or "assigned to voice X."
FR25: Speaker naming uses a combobox that searches existing Voices or creates a new one inline.
FR26: "Assign speakers" opens the combobox without starting training; "Commit assignments" locks assignments in and creates contributions; "Discard" resets a run to `AWAITING_REVIEW`. Multiple videos can be assigned in parallel and committed individually or in batch.
FR27: The Voices view shows a card per Voice: name, phase, total clip count, model size once `READY`, a contributing-videos count badge opening a popover (video, clip count, assignment date), a phase-conditional "Train now" action, a standing "Retrain" action, a "View clips" modal, and "Download model" once `READY`.

### NonFunctional Requirements

NFR1: The agent tool-calling loop stays `async def` throughout — no new blocking calls (4.1).
NFR2: Hook selection in the CopilotKit surface is governed by a fixed Need-to-Hook policy table (read-only → `useAgentContext`; reversible → `useFrontendTool`; costly/destructive → `useHumanInTheLoop`; server-tool custom UI → `useRenderTool`; suggestions → `useConfigureSuggestions`; status → `useAgent`) — a binding constraint, not a style preference; CopilotKit v1 hooks (`useCopilotReadable`, `useCopilotAction`) are banned from new code (4.2).
NFR3: All five gateway-bound routes touched by video-scoped ingestion (`get_clips`, `update_clips`, `set_speaker_map`, `stream_clip_audio`, `get_training_progress`) update in the same change as the `VoiceFactoryGateway` call sites that depend on them — a hard breaking-change pairing across the `copilot_agent_network` / `star-trek-voyicer` repo boundary, not two independent rollouts (4.3).
NFR4: All new persistence for the multi-voice data model uses SQLAlchemy 2.0 async via `Base.metadata.create_all` — no raw SQL, per the project's standing convention (4.4).

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

FR1: Epic 1 - Tool definitions reach the model
FR2: Epic 1 - Tool-call events stream in order
FR3: Epic 1 - Run ends after emitting tool calls
FR4: Epic 1 - Lazy text-message opening
FR5: Epic 1 - Runaway tool-calling is capped
FR6: Epic 1 - Documentation matches behavior
FR7: Epic 1 - Expanded-run state published to the agent
FR8: Epic 1 - Phase-legal actions published to the agent
FR9: Epic 1 - Context ownership follows the UI
FR10: Epic 1 - Agent can expand a run on the user's behalf
FR11: Epic 1 - Starter suggestions track visible state
FR12: Epic 2 - Re-ingesting a known video costs nothing
FR13: Epic 2 - Videos/speakers queryable independent of character
FR14: Epic 2 - One commit routes many videos to many characters
FR15: Epic 2 - Preprocessing only regenerates what changed
FR16: Epic 3 - Voice is a durable, independent entity
FR17: Epic 3 - Ingest phase and voice phase tracked independently
FR18: Epic 3 - Assignment and commit are separate operations
FR19: Epic 3 - Every contribution is an immutable audit record
FR20: Epic 3 - Training triggered explicitly or automatically
FR21: Epic 3 - Ingestion and voice training run as separate state machines
FR22: Epic 3 - Voice-centric queries at the repository layer
FR23: Epic 3 - Videos and Voices are separate views
FR24: Epic 3 - Videos view surfaces ingestion state per video
FR25: Epic 3 - Speaker naming is search-or-create
FR26: Epic 3 - Assign, commit, discard are distinct actions
FR27: Epic 3 - Voices view surfaces training state per voice

## Epic List

### Epic 1: Agent Tool-Calling on the Voices Dashboard

Backend and frontend together: the agent can call a browser-registered tool, and the Voices dashboard registers one — expanding a run — plus publishes phase-aware context and status. Delivers UJ-1 and UJ-2 end-to-end; the backend half (4.1) alone has no user-visible outcome, so it is one epic with ordered stories, not two.
**FRs covered:** FR1, FR2, FR3, FR4, FR5, FR6, FR7, FR8, FR9, FR10, FR11
**NFRs covered:** NFR1, NFR2

### Epic 2: Reusable Video Ingestion

An operator can ingest a video once and reuse it for any number of characters, with one commit routing several videos' speakers to several characters at once. Delivers UJ-4 standalone — works against the existing dashboard UI immediately, no dependency on Epic 3.
**FRs covered:** FR12, FR13, FR14, FR15
**NFRs covered:** NFR3

### Epic 3: Multi-Video Voice Building

An operator can build one durable Voice from clips contributed by several videos over time, assigning and committing as separate steps, and manage that Voice from a dedicated view. Delivers UJ-3 end-to-end. Depends on Epic 2 for its gateway contract and filesystem layout — the data model and the UI that surfaces it ship together as one epic for the same reason as Epic 1.
**FRs covered:** FR16, FR17, FR18, FR19, FR20, FR21, FR22, FR23, FR24, FR25, FR26, FR27
**NFRs covered:** NFR4

**Cross-epic sequencing (resolved):** Epic 3 ships before Epic 1. This resolves PRD Open Question 4 — FR-10's frontend tool is then built once, directly against the final Videos/Voices UI, with no rework story needed. Epic 2 must precede Epic 3 regardless (data-model dependency). **Build order: Epic 2 → Epic 3 → Epic 1.** Epic numbers reflect the user-value grouping approved above, not build order.

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

An operator can build one durable Voice from clips contributed by several videos over time, assigning and committing as separate steps, and manage that Voice from a dedicated view.

### Story 3.1: Create the Durable Voice Entity

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

### Story 3.2: Split Assignment From Commit, With an Audit Trail

As an operator,
I want to assign a video's speakers to voices without committing, and commit separately when I'm ready,
So that I can hold an assignment before it starts training.

**Acceptance Criteria:**

**Given** a video has detected speakers and one or more voices exist (Story 3.1)
**When** an operator calls `POST /runs/{id}/assign`
**Then** the speakers are associated with voices, and the run's `ingest_phase` does not change (FR17, FR18)

**Given** an assignment has been made
**When** an operator calls `POST /runs/{id}/commit`
**Then** one immutable `voice_contributions` row is created per (voice, run, speaker) triple, and `ingest_phase` advances to `COMMITTED` — the `voice_contributions` table is introduced in this story, alongside `VoiceContributionRepository` (FR18, FR19)

**Given** contributions exist for a voice
**When** the repository is queried
**Then** it returns all contributions for that voice joined to run/video, and can fetch a voice by name (FR22)

### Story 3.3: Trigger Training Explicitly or Automatically, Independent of Ingestion

As an operator,
I want training to start either automatically on a voice's first contribution or by an explicit call, running independently of video ingestion,
So that training doesn't block on or get blocked by ingestion state.

**Acceptance Criteria:**

**Given** a voice receives its first contribution (Story 3.2)
**When** the commit that creates it completes
**Then** training triggers automatically (FR20)

**Given** a voice already has contributions
**When** an operator calls `POST /voices/{id}/train`
**Then** training triggers explicitly, regardless of the automatic path (FR20)

**Given** ingestion and training are independent concerns
**When** either runs
**Then** it runs on its own LangGraph — one per video for ingestion, one per voice for training (FR21)

### Story 3.4: Split the Dashboard into Videos and Voices Views

As an operator,
I want Videos and Voices as separate views,
So that I can focus on ingestion review or voice management without the other cluttering the screen.

**Acceptance Criteria:**

**Given** the dashboard loads
**When** an operator uses the nav/tab segment
**Then** the Videos view and Voices view render independently, each reachable without a full page reload (FR23)

### Story 3.5: Review Ingestion and Assign Speakers in the Videos View

As an operator,
I want to review a video's detected speakers and assign them to voices by searching or creating, without starting training,
So that I can prepare an assignment before committing it.

**Acceptance Criteria:**

**Given** ingested videos exist
**When** an operator opens the Videos view
**Then** it lists video title, source URL, speaker count, and diarization status; expanding a row shows detected speaker clips labeled "awaiting assignment" or "assigned to voice X" (FR24)

**Given** an operator is naming a speaker
**When** they use the speaker combobox
**Then** it searches existing voices or creates a new one inline — no free text (FR25)

**Given** a video's speakers are unassigned
**When** an operator clicks "Assign speakers"
**Then** the combobox opens without starting training (FR26)

**Given** assignments have been made
**When** an operator clicks "Commit assignments"
**Then** assignments lock in and contributions are created, via Story 3.2's routes (FR26)

**Given** an operator wants to abandon a review
**When** they click "Discard"
**Then** the run resets to `AWAITING_REVIEW` (FR26)

**Given** multiple videos have pending assignments
**When** an operator works through them
**Then** each can be assigned and committed individually or in batch (FR26)

**And** the existing `speaker_board` clip audio-quality review/playback flow is preserved unchanged

### Story 3.6: Manage Voice Training From the Voices View

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

**Given** a voice has `AWAITING_COMMIT` contributions
**When** an operator views its card
**Then** a "Train now" action is shown; a standing "Retrain" action is always available regardless of that condition (FR27)

**Given** a voice has any contributions
**When** an operator clicks "View clips"
**Then** a modal lists every clip across all of that voice's contributing videos (FR27)

**Given** a voice has reached `READY`
**When** an operator views its card
**Then** "Download model" is active (FR27)

## Epic 1: Agent Tool-Calling on the Voices Dashboard

Backend and frontend together: the agent can call a browser-registered tool, and the Voices dashboard registers one — expanding a run — plus publishes phase-aware context and status.

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

As an evaluator,
I want starter prompt suggestions that reflect the runs currently on screen,
So that the suggestions stay relevant as the run list changes.

**Acceptance Criteria:**

**Given** the set of runs visible on screen
**When** that set changes
**Then** `useConfigureSuggestions` reseeds starter prompts from the currently visible runs (FR11)

### Story 1.6: Show Agent Working/Idle Status

As an evaluator,
I want to see whether the agent is actively working,
So that I know when to expect a response.

**Acceptance Criteria:**

**Given** the agent is processing an active run
**When** the sidebar header is visible
**Then** it reflects the agent's run status (working vs. idle), via `useAgent`

*(No numbered FR — deprioritized to an acceptance-criterion-level item per PRD §4.2 Notes; carried into this story per that note's instruction.)*
