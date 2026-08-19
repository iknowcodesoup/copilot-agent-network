# Epic 3 Context: Multi-Video Voice Building

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

An operator can build one durable Voice from clips contributed by several videos over time, rather than a voice being a one-shot byproduct of a single ingest. Assigning a video's speakers to a voice and committing that assignment (which starts training) become two separate, explicit steps, so an operator can hold an assignment before it locks in and starts training. The operator then manages each voice — its training state, contributing videos, and outputs — from a dedicated view. This closes out the voice-pipeline rework thread of the platform and is a required precursor to Epic 1: the agent's "expand a run" tool is built once, directly against the Videos/Voices UI this epic delivers, avoiding a rework pass. Epic 3 depends on Epic 2 (video-scoped ingestion) for its gateway contract and filesystem layout, so Epic 2 must ship first; build order is Epic 2 → Epic 3 → Epic 1.

## Stories

- Story 3.1: Create the Durable Voice Entity
- Story 3.2: Split Assignment From Commit, With an Audit Trail
- Story 3.3: Trigger Training Explicitly or Automatically, Independent of Ingestion
- Story 3.4: Split the Dashboard into Videos and Voices Views
- Story 3.5: Review Ingestion and Assign Speakers in the Videos View
- Story 3.6: Manage Voice Training From the Voices View

## Requirements & Constraints

- A Voice is a durable entity (id, name, training phase, checkpoint path) independent of any single video. A voice can be created by name and fetched together with its contributions.
- A Run's ingest phase (`DOWNLOADING` → `DIARIZING` → `AWAITING_REVIEW` → `COMMITTED`) and a Voice's training phase (`AWAITING_COMMIT` → `TRAINING` → `EXPORTING` → `READY`, or `FAILED`) are tracked and change independently. A run reaching `COMMITTED` does not itself change any voice's phase.
- Assigning a video's speakers to voices and committing that assignment are separate, explicit operations. Assign does not change ingest phase. Commit creates one immutable contribution record per (voice, run, speaker) triple — never updated in place, the audit trail of what fed a voice's training — and only then advances ingest phase to `COMMITTED`.
- Training triggers two ways, intentionally concurrent (not one superseding the other): explicitly on request, and automatically on a voice's first contribution.
- Ingestion and voice training are independent concerns and must be queryable and traceable per voice (all contributions for a voice joined to run/video, and lookup by voice name).
- The Videos view and Voices view are reachable independently via a nav/tab segment, with no full page reload.
- Videos view: lists title, source URL, speaker count, diarization status; expanding a row shows detected speaker clips each labeled "awaiting assignment" or "assigned to voice X." Speaker naming is search-or-create only — never free text. "Assign speakers," "Commit assignments," and "Discard" (resets a run to `AWAITING_REVIEW`) are distinct, visible actions; multiple videos can be assigned and committed individually or in batch.
- Voices view: one card per voice showing name, phase, total clip count, and model size once `READY`; a contributing-videos count badge opens a popover of video/clip-count/assignment-date; a phase-conditional "Train now" appears only while `AWAITING_COMMIT` contributions exist, alongside an always-available "Retrain"; "View clips" opens a modal of every clip across all contributing videos; "Download model" activates once `READY`.
- The existing `speaker_board` clip audio-quality review/playback flow carries over unchanged — it is not rebuilt.
- Success is demonstrated by showing, live, a single voice built from clips contributed by two or more distinct videos, with each contribution traceable in the UI. A rising contributing-video count is not itself a goal — per-contribution audio quality should not be sacrificed just to grow that count.

## Technical Decisions

- All new persistence uses SQLAlchemy 2.0 async, created via `Base.metadata.create_all` — no raw SQL, and no migration tooling (e.g. Alembic) introduced in this pass.
- `voices` and `voice_contributions` are new tables. `voice_runs` is trimmed, not grown: training-related columns move out of it into `voices`. Because `create_all` does not alter an existing table, `voice_runs` is dropped and recreated in development.
- Two new repository classes, `VoiceRepository` and `VoiceContributionRepository`, follow the existing repository-per-concern pattern already used in `repositories/`.
- Voice training runs on its own LangGraph, one per voice, triggered on contribution commit — a second, independent state machine alongside the existing per-video ingestion graph, not a modification of it.
- New frontend components are net-new: a videos view, a voice card, a voice/speaker combobox, and a voices view. `speaker_board` and the dashboard's top-level page are refactored, not replaced.
- New or updated frontend data hooks back the two views and must track the assign/commit split rather than a single approve action.

## UX & Interaction Patterns

- Nav/tab segment switches between Videos and Voices views; both stay mounted/reachable without a full reload.
- Videos view uses a list-with-expandable-row pattern: collapsed rows show summary fields, expanding reveals per-speaker clip detail and assignment state.
- Speaker/voice naming always goes through a search-or-create combobox — no free-text entry point exists.
- Assign, Commit, and Discard are always presented as separate, visible actions rather than one collapsed "approve" step, and operate per-video so several videos can be worked in parallel.
- Voices view uses a card-per-voice layout. Action visibility is phase-conditional ("Train now" only under `AWAITING_COMMIT`) alongside actions that are always available regardless of phase ("Retrain"). A count badge + popover pattern surfaces contributing-video detail without leaving the card. "View clips" is a modal, not an inline expansion.

## Cross-Story Dependencies

- Story 3.1 (voice entity and schema) is a prerequisite for 3.2 (assign/commit references voices) and 3.3 (training targets a voice).
- Story 3.2 (assign/commit and the contributions audit trail) is a prerequisite for 3.3 (auto-trigger fires on a voice's first contribution) and for 3.5/3.6, which surface the assign/commit split and resulting training state in the UI.
- Story 3.4 (the Videos/Voices view split) should land before or alongside 3.5 and 3.6, which populate those two views respectively.
- Epic 3 depends on Epic 2 for the video-scoped gateway contract and filesystem layout. Epic 1 depends on Epic 3: its "expand a run" frontend tool is built once, directly against the Videos/Voices UI this epic produces.
