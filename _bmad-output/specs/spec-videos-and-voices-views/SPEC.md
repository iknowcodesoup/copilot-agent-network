---
id: SPEC-videos-and-voices-views
companions:
  - brownfield.md
  - ui-views.md
  - implementation-plan.md
  - verification.md
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate. Source documents listed in frontmatter are for traceability — consult them only if you need narrative rationale or prose color this contract intentionally omits.
>
> **Status: SUPERSEDED IN PART (2026-08-27).** The Videos and Voices views shipped as client tab state (`type View` in `studio_provider.tsx`), not App Router segments. The assign/commit UI this spec targets never shipped — clip assignment replaced it. The Voice card's contributing-videos popover with assignment dates, the "Train now"/"Retrain" split, model-size display, "Download model", and the "View clips" modal were not built. Search-or-create speaker combobox, per-video clip table, and preserved playback all shipped. See `_bmad-output/planning-artifacts/sprint-change-proposal-2026-08-27.md`.

# Videos And Voices Views

## Why

The frontend renders one flat list — one row per run, one run per video, one video per eventual model — conflating ingestion and training. Approving a speaker name immediately commits clips and starts training; there is no way to review clips from one video, hold them, and combine them with clips from another video later. This blocks the multi-video-per-voice workflow that `spec-multi-voice-data-model` enables at the API layer. See `brownfield.md` for the verified evidence behind each gap.

## Capabilities

- **CAP-1**
  - **intent:** A person navigates between a Videos view (ingestion review) and a Voices view (voice management and training) as two distinct screens, not one flat list.
  - **success:** A tab or nav segment switches between the Videos view and the Voices view; each renders independently.

- **CAP-2**
  - **intent:** The Videos view shows every ingestion run with its speaker clips, and lets a person assign a video's detected speakers to a new or existing voice by search instead of free text.
  - **success:** A table lists video title, source URL, speaker count, and diarization status. Expanding a row shows detected speaker clips. Naming a speaker uses a combobox that searches existing voices or creates one inline.

- **CAP-3**
  - **intent:** Assigning speakers and committing those assignments are two separate actions a person triggers deliberately, so multiple videos can be reviewed and held before any of them commit.
  - **success:** "Assign speakers" opens the combobox without training. "Commit assignments" locks in assignments and creates contributions. "Discard" resets a run to AWAITING_REVIEW. Multiple videos can be assigned in parallel and committed one at a time or in batch.

- **CAP-4**
  - **intent:** The Voices view shows every voice as a durable entity with the videos that contributed to it, its training status, and explicit actions to train or download.
  - **success:** A card grid shows each voice's name, status (AWAITING_COMMIT/TRAINING/EXPORTING/READY/FAILED), total clip count, and model size when READY. Each card's contributing-videos popover lists every video, its clip count, and assignment date. A voice with AWAITING_COMMIT contributions shows a "Train now" banner.

## Constraints

- The speaker_board review flow (playing clips, reviewing quality) stays the same. Only the naming action changes (combobox instead of free text), and assignment is separated from training.
- This view depends on specific routes from `spec-multi-voice-data-model`: `GET /voices` (list with phase and checkpoint), `GET /voices/{id}` (voice plus contributions array), `POST /voices` (create by name only), `GET /runs` (ingestion runs only, no training phases). See `ui-views.md` for how each screen consumes them.

## Non-goals

- The pythonapi routes or data model do not change here; this spec consumes the assign, commit, and voices routes that `spec-multi-voice-data-model` defines.
- Clip audio-quality review does not change here; the existing `speaker_board` playback flow is preserved as-is.

## Success signal

Ingest video A — the Videos view shows it AWAITING_REVIEW with its speakers visible on expand. Ingest video B and assign one of its speakers to a new voice "Alice"; assign a speaker from video A to "Alice" too. Commit both assignments — the Videos table shows both as COMMITTED, and the Voices view shows "Alice" with two contributing videos and a "Train now" banner. Clicking "Train now" moves Alice through TRAINING to READY, and "Download model" becomes active.

## Assumptions

None — the source design was concrete enough to distill directly.

## Open Questions

None outstanding — the source spec resolved its design questions before this conversion.
