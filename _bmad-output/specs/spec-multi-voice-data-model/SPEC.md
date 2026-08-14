---
id: SPEC-multi-voice-data-model
companions:
  - brownfield.md
  - data-model.md
  - implementation-plan.md
  - verification.md
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate. Source documents listed in frontmatter are for traceability — consult them only if you need narrative rationale or prose color this contract intentionally omits.

# Multi-Voice Data Model

## Why

The pythonapi treats voice training as part of the ingestion lifecycle: one `VoiceRun` row represents one video, carrying both ingestion state and training phases. This conflates two concerns — reviewing clips from a single video, and training a durable voice model from many videos — and blocks the goal of many videos feeding one named voice. See `brownfield.md` for the verified evidence behind each gap.

## Capabilities

- **CAP-1**
  - **intent:** A voice is a durable entity independent of any single video, so many videos can contribute clips to the same named voice over time.
  - **success:** Creating voice X, then committing contributions from two different videos, leaves voice X with two contributions and a training run that includes clips from both.

- **CAP-2**
  - **intent:** Video ingestion state and voice training state are tracked separately, so reviewing one video's clips never implies starting training.
  - **success:** `voice_runs` tracks only `ingest_phase` (DOWNLOADING/DIARIZING/AWAITING_REVIEW/COMMITTED). A run reaching COMMITTED does not by itself change any voice's training phase.

- **CAP-3**
  - **intent:** Assigning a video's speakers to voices and committing that assignment are separate actions, so a person can propose assignments and hold them before they become durable contributions.
  - **success:** `POST /runs/{id}/assign` records proposed assignments without changing `ingest_phase`. `POST /runs/{id}/commit` creates contributions and moves `ingest_phase` to COMMITTED only when called.

- **CAP-4**
  - **intent:** Training can be triggered explicitly for a voice, or automatically on first contribution, independent of any one run's lifecycle.
  - **success:** `POST /voices/{id}/train` starts the voice's training graph. The voice's phase moves TRAINING → EXPORTING → READY, tracked apart from any run's `ingest_phase`.

- **CAP-5**
  - **intent:** The repository layer answers voice-centric queries — which videos contributed to a voice, and what a voice's contributions are — not just run-centric CRUD.
  - **success:** A query lists all contributions for a given `voice_id`, joined to their source `run_id` and `video_id`.

## Constraints

- `voice_runs` is trimmed, not dropped: it keeps only `id, source_url, video_id, video_title, ingest_phase, speaker_map (JSONB)`. Training-related columns move to `voices`. See `data-model.md` for the full column list, before and after.
- `voice_contributions` rows are immutable after creation — an audit trail, never updated in place.
- The ingest graph and the voice graph are split LangGraphs, not one graph with more nodes: one ingest graph per video, one voice graph per voice, the voice graph triggered when a contribution commits.
- SQLAlchemy-only, async, `Base.metadata.create_all` pattern for the new tables — no raw SQL, per project-wide convention.

## Non-goals

- The multi-character clip-merge logic does not change. `stage_youtube_commit` in `star-trek-voyicer` already merges clips from multiple videos under one character; this spec only ensures pythonapi tracks that merge clearly, via the contributions table.
- The frontend does not change here. UI changes to present voices and videos as separate views are owned by `spec-videos-and-voices-views`, which depends on this spec's new routes and tables.
- The video-scoped filesystem layout and gateway routes do not change here; that is `spec-video-scoped-ingestion`, upstream of this one.

## Success signal

Create voice X, ingest video A, assign speaker `A_00` to voice X, and commit — voice X gains one contribution and moves toward TRAINING. Ingest video B, assign speaker `B_01` to voice X, and commit — voice X now has two contributions, and its training run includes clips from both videos.

## Assumptions

- Assumed training auto-triggers on first contribution is an acceptable default alongside the explicit `POST /voices/{id}/train` trigger, since the source design states "or auto-trigger on first contribution" without picking one exclusively — both paths are treated as valid entry points into the same voice graph.

## Open Questions

None outstanding — the source spec resolved its design questions before this conversion.
