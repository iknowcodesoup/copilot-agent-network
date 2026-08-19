---
title: 'Story 3.5: Review Ingestion and Assign Speakers in the Videos View'
type: 'feature'
created: '2026-08-15'
status: 'in-progress'
review_loop_iteration: 0
context: []
baseline_commit: 'b2332fdc0f1bcbf4ac62dc12bf6946ba8c2e4f98'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `speaker_board.tsx` still runs the old single-phase flow: a free-text character name per speaker and one "Approve and train" button that starts training immediately. Story 3.2's assign/commit split (`POST /runs/{id}/assign`, `POST /runs/{id}/commit`) already exists on the backend but nothing in the UI calls it, and there is no way to search or create a Voice, or to discard a review.

**Approach:** Replace `speaker_board.tsx`'s free-text input and single approve action with a search-or-create Voice combobox per speaker, plus three explicit actions — "Assign speakers" (opens the combobox, no backend call), "Commit assignments" (calls assign then commit), and "Discard" (resets the run to `AWAITING_REVIEW`). Add the two small backend pieces this depends on: `GET /voices` (list/search, for the combobox) and `POST /runs/{id}/discard`. Multiple runs can each be worked independently since `RunCard`/`SpeakerBoard` are already per-run components.

## Boundaries & Constraints

**Always:**
- Reuse the existing `POST /runs/{id}/assign` and `POST /runs/{id}/commit` routes in `voice.py` unchanged — do not modify their contracts.
- Add `GET /voices?query=` to `routes/voices.py`, backed by a new `VoiceRepository.search_voices(query, limit)` method (both `InMemoryVoiceRepository` and `PostgresVoiceRepository`), returning voices whose name contains `query` case-insensitively, ordered by name, capped at a `limit` query param (default 20).
- Add `POST /runs/{run_id}/discard` to `voice.py`, gated the same way as `assign_run`/`commit_run` (`_require_awaiting_review`... except discard's own purpose is to leave `AWAITING_REVIEW`, so instead accept it from `AWAITING_REVIEW` and clear `run.voice_assignments` back to `{}`; reject with 409 from any other phase, same message shape as `_require_awaiting_review`).
- The Voice combobox creates a voice inline via the existing `POST /voices` (already documented for this in `voices.py:38-42`) when the typed name has no match; it never free-types a value into the assignment.
- New frontend hooks (`useVoices`, `useAssignRun`, `useCommitRun`, `useDiscardRun`) live in `voice_api.ts`, following the existing `request`/`useMutation`/query-invalidation pattern already used by `useUpdateClips`/`useApproveRun`/`useRetryRun`.
- Do not remove or change `useApproveRun` or the `POST /runs/{id}/approve` route — out of scope, potentially still used elsewhere; `SpeakerBoard` simply stops calling it.
- Preserve the existing clip playback/keep/reject flow (`ClipRow`, `useUpdateClips`, "Keep all"/"Reject all"/"Play clips") in `speaker_board.tsx` unchanged.
- "Assign speakers" is a local UI-state toggle only (shows the combobox); it must not call `assign` until "Commit assignments" — but calling `assign` on every combobox change (before commit) is fine since Story 3.2's `assign_run` is designed to be called repeatedly. Choose one approach and apply it consistently: call `assign` on each combobox selection (autosave draft) so "Commit assignments" only needs to call `commit`.

**Ask First:** None expected — the two new backend endpoints are additive and narrowly scoped to this story's UI needs.

**Never:**
- Do not build a generic reusable combobox component library — a single `voice_speaker_combobox.tsx` scoped to this use case is sufficient (epics.md anticipates this exact file name).
- Do not touch `run_card.tsx`'s layout beyond passing through any new props `SpeakerBoard` needs — no redesign of the card shell.
- Do not add batch multi-select UI across runs in this story — "individually or in batch" is satisfied by each run's `SpeakerBoard` being independently assignable/committable already (no shared cross-run state needed).
- Do not add e2e/UI/Playwright tests — per standing project directive, UX is not final.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Search existing voice | Operator types 2+ chars in combobox | `GET /voices?query=...` returns matching voices, shown as selectable options | Empty result shows "create new" option only |
| Create voice inline | Typed name matches no existing voice, operator confirms create | `POST /voices` creates it, response id becomes the speaker's assignment | 409 (name taken) refetches search and selects the existing match instead of erroring |
| Commit with unassigned speaker | Some speakers left blank, operator clicks "Commit assignments" | Blank speakers are omitted from the assign payload (voice id `null`), commit proceeds for assigned ones | `commit` 400 "Assign at least one speaker" surfaces as an inline alert if all are blank |
| Commit when run left AWAITING_REVIEW | Run phase changed elsewhere between load and commit (e.g. discarded in another tab) | `commit` call 409s | Alert shown: run is no longer awaiting review; refetch the run |
| Discard | Operator clicks "Discard" | `POST /runs/{id}/discard` clears `voice_assignments`, run stays/returns to `AWAITING_REVIEW`; combobox selections reset locally | 409 if run isn't in `AWAITING_REVIEW` |

</frozen-after-approval>

## Code Map

- `apps/pythonapi/pythonapi/repositories/voices.py` -- add `search_voices(query, limit)` to the `VoiceRepository` Protocol (line 33) and both implementations (`InMemoryVoiceRepository` line 67, `PostgresVoiceRepository` line 134); Postgres side uses `select(VoiceRow).where(VoiceRow.name.ilike(f"%{query}%")).order_by(VoiceRow.name).limit(limit)`.
- `apps/pythonapi/pythonapi/routes/voices.py` -- add `GET ""` (list/search) handler near `create_voice` (line 33), using `Query` params like `voice.py:99-109`'s `search_videos` does.
- `apps/pythonapi/pythonapi/routes/voice.py` -- add `POST /runs/{run_id}/discard` near `assign_run`/`commit_run` (lines 369-466); reuses `_load_run` (line 92) and the `AWAITING_REVIEW`-guard pattern from `_require_awaiting_review` (line 357), but its own guard must accept only `AWAITING_REVIEW` (nothing to discard from any other phase).
- `apps/agentic-executor/src/app/features/voices/voice_api.ts` -- add `useVoices(query)`, `useAssignRun(runId)`, `useCommitRun(runId)`, `useDiscardRun(runId)` following `useApproveRun` (line 409) and `useRetryRun` (line 436) as templates; reuse `request`/`jsonBody`/`voiceQueryKeys` helpers already in this file.
- `apps/agentic-executor/src/app/features/voices/voice_speaker_combobox.tsx` (new) -- search-or-create combobox for one speaker row; calls `useVoices` for search-as-you-type, calls `POST /voices` (needs a `useCreateVoice` hook alongside the others above) on inline create.
- `apps/agentic-executor/src/app/features/voices/speaker_board.tsx` -- replace the free-text `Input` (lines 122-136) with `VoiceSpeakerCombobox`; replace `approve()`/"Approve and train" button (lines 93-101, 189-205) with "Assign speakers" (local toggle), "Commit assignments" (`useCommitRun`), and "Discard" (`useDiscardRun`) actions; keep `ClipRow`/`useUpdateClips`/keep-reject UI (lines 83-91, 103-187) unchanged.
- `apps/agentic-executor/src/app/videos/page.tsx` -- no change expected; already renders `RunCard` per run, which mounts `SpeakerBoard` when `awaitingReview` (via `run_card.tsx:169-184`). Confirm during implementation that title/source URL/speaker count/diarization status are already visible in `RunCard`'s header — if not, extend `RunCard`'s header only (not `page.tsx`).
- `apps/agentic-executor/src/app/features/voices/run_card.tsx:179-183` -- passes `runId`/`primaryCharacter`/`awaitingReview` to `SpeakerBoard`; no change needed unless a new prop is required.

## Tasks & Acceptance

**Execution:**
- [x] `pythonapi/repositories/voices.py` -- add `search_voices` to Protocol + both implementations -- backs the combobox's search
- [x] `pythonapi/routes/voices.py` -- add `GET ""` list/search endpoint -- exposes search_voices over HTTP
- [x] `pythonapi/routes/voice.py` -- add `POST /runs/{run_id}/discard` -- lets an operator abandon a review
- [x] `pythonapi/tests/` -- unit tests for `search_voices` (empty query behavior, case-insensitive match, limit) and `discard_run` (happy path, 409 from wrong phase) -- covers the I/O matrix's discard/error rows
- [x] `agentic-executor/.../voice_api.ts` -- add `useVoices`, `useCreateVoice`, `useAssignRun`, `useCommitRun`, `useDiscardRun` -- frontend access to the new/existing routes
- [x] `agentic-executor/.../voice_speaker_combobox.tsx` (new) -- search-or-create UI per speaker -- FR25
- [x] `agentic-executor/.../speaker_board.tsx` -- swap free-text input + approve for combobox + assign/commit/discard actions -- FR24, FR26

**Acceptance Criteria:**
- Given ingested videos with detected speakers, when an operator opens the Videos view and expands a run, then each speaker shows "awaiting assignment" or "assigned to voice X" (FR24)
- Given an operator assigns speakers across two different runs, when they commit one and discard the other, then each run's outcome is independent of the other (FR26)
- Given a voice is committed to from this flow, when training's automatic trigger fires (Story 3.3, already implemented), then no additional wiring in this story is needed — commit alone is sufficient

## Design Notes

`speaker_board.tsx` currently seeds `effectiveAssignments` from `primaryCharacter` (lines 51-61) — a single-character-per-run assumption from the old flow. The new combobox-based assignment is per-speaker-to-Voice, with no single-character seed; drop that seeding logic rather than adapting it, since assign/commit already stores a full `voice_assignments` map keyed by speaker label (mirrors `run.speaker_map`'s existing shape).

Autosave-on-select (calling `assign` immediately when a combobox selection changes, before "Commit assignments" is clicked) is the simplest way to satisfy "Assign speakers opens the combobox without starting training" while still letting "Commit assignments" be a single cheap call — `assign_run` is documented as idempotent/repeatable (`voice.py:376-381`), so this is within its designed use.

## Verification

**Commands:**
- Hand off to `litert-subagent`: `nx test pythonapi` -- expected: new `search_voices`/`discard_run` tests pass, existing suite unaffected
- Hand off to `litert-subagent`: `nx lint pythonapi` -- expected: no new violations
- Hand off to `litert-subagent`: `nx run pythonapi:format` -- expected: clean
- Hand off to `litert-subagent`: `nx lint @agentic-executor/agentic-executor` -- expected: no new violations
- Hand off to `litert-subagent`: `nx typecheck @agentic-executor/agentic-executor` -- expected: clean
- Hand off to `litert-subagent`: `nx test @agentic-executor/agentic-executor` -- expected: existing suite passes unaffected

**Manual checks (if no CLI):**
- Run `nx dev @agentic-executor/agentic-executor` and `nx serve pythonapi`, open a run in `AWAITING_REVIEW`, search for an existing voice and assign it to a speaker, commit, and confirm the run moves to `COMMITTED` and the voice's phase reflects training start. Then start a second run, assign a speaker to a brand-new typed name, confirm it creates a voice, then click Discard and confirm the run returns to `AWAITING_REVIEW` with assignments cleared.

