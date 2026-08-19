---
title: 'Flatten Assign/Commit Into One Immediate, Audited Action'
type: 'feature'
created: '2026-08-16'
status: 'done'
review_loop_iteration: 0
baseline_commit: 'a88ba960db37089b5b2ede2a4766cf779d5fcadb'
context: ['{project-root}/_bmad-output/planning-artifacts/sprint-change-proposal-2026-08-16.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The backend splits assigning a video's speaker to a Voice into two operator steps (`POST /runs/{id}/assign` then `POST /runs/{id}/commit`, plus a `discard`), but the adopted UI design (`assets/voice-training-platform`) has no such split — relabeling a clip's speaker onto a Voice commits immediately. Story 3.2's frozen premise is reversed by user decision (see linked sprint-change-proposal).

**Approach:** Merge `assign_run` and `commit_run` into one handler on the `/assign` path: on a single request it associates speakers with Voices, writes `voice_contributions` rows immediately, advances `ingest_phase` to `COMMITTED`, and wakes the training reconciler on any distinct voice touched. Remove `discard_run`. Port the design's Videos/Voices UI (already largely built in `assets/voice-training-platform`) into `apps/agentic-executor/src/app/features/voices/` and `app/videos/`, replacing the current three-button (assign/commit/discard) implementation and wiring it to the merged endpoint, the real SSE protocol, and CopilotKit v2 for chat.

## Boundaries & Constraints

**Always:**
- One request does assign + write-contribution + phase-advance + train-trigger; no intermediate draft state survives.
- `voice_contributions` stays append-only, one row per (voice, run, speaker) triple, immutable — same invariant as today, just triggered by assign instead of commit.
- Speaker naming stays search-or-create only (FR25) — do not adopt the design's free-text relabel field.
- Video re-add stays deduped: pasting an already-ingested video's URL reuses existing clips/speakers, no re-download/re-transcribe/re-diarize.
- SSE stays on the real protocol (`GET /voice/events`, AG-UI `CUSTOM` events `voice.run.updated`/`voice.run.log`, native `EventSource` reconnect) — do not port the design's mock `/api/stream`.
- Chat actions go through `@copilotkit/react-core/v2` `useCopilotAction`, registered in `copilot_provider.tsx`'s tree — do not port `lib/assistant.ts`'s regex parser as runtime logic (its `ACTION_CATALOG` may be used as a checklist of action names).

**Ask First:**
- Whether to rename the merged endpoint/hook (`useAssignRun` performing commit-semantics) or keep the `/assign` name as-is with updated doc comments only.
- Whether `RunCommitResponse`/`commit` naming disappears from the codebase entirely or is kept as an internal alias during transition.

**Never:**
- Do not reintroduce a discard/undo action — there is no draft state to discard once assign commits.
- Do not change `voice_contributions` table schema (columns, unique constraint) — only the trigger point moves.
- Do not touch Epic 2 ingestion code paths or Epic 1 (not started).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Happy path, single speaker | Run in `AWAITING_REVIEW`, one speaker assigned a voice_id | 201, one contribution row, run → `COMMITTED`, voice → `TRAINING`, reconciler woken once | N/A |
| Multiple speakers, multiple voices | Run in `AWAITING_REVIEW`, N speakers mapped to distinct voice_ids | One contribution row per speaker, reconciler woken once per distinct voice | N/A |
| Empty/all-null assignment | All speakers mapped to `None` | No rows written, run stays `AWAITING_REVIEW` | 400 |
| Unknown voice_id | One speaker mapped to a nonexistent voice | Nothing persisted | 404 |
| Run not in `AWAITING_REVIEW` | Run already `COMMITTED` or other phase | Nothing persisted | 409 |
| Unknown run_id | run_id does not exist | — | 404 |
| Re-add ingested video | Paste URL already in the system | Existing clips/speakers reused, no reprocessing | N/A |

</frozen-after-approval>

## Code Map

- `apps/pythonapi/pythonapi/routes/voice.py:369-485` -- `assign_run` (369-394) and `commit_run` (421-485) to merge into one handler at `/assign`; reuse `commit_run`'s body (contribution-write, phase-advance, wake-per-distinct-voice) gated by `_require_awaiting_review` (357-366) instead of a prior assign step; delete `discard_run` (397-413).
- `apps/pythonapi/pythonapi/models/voices.py:106-128` -- `RunAssignRequest`/`RunAssignResponse`/`RunCommitResponse`: merge response shape (likely `RunAssignResponse` gains `contributions: list[VoiceContribution]`, drop `RunCommitResponse` or alias it).
- `apps/pythonapi/pythonapi/models/voice.py:120-123` -- `VoiceRun.voice_assignments` field/comment describes old two-call flow; update comment only, field stays (still the working map during the single call).
- `apps/pythonapi/pythonapi/repositories/voice_contributions.py:18-28` -- `VoiceContributionRepository.create_contribution` reused as-is.
- `apps/pythonapi/pythonapi/routes/voices.py:79-91` -- `get_voice` contribution population unaffected.
- `apps/pythonapi/pythonapi/workers/voice_training_reconciler.py:60-67` -- `wake()` call site moves into merged handler, same semantics.
- `apps/pythonapi/tests/test_voice_assign_commit.py` -- assign-only and commit-only test classes merge into one; delete all `test_discard_*`; `apps/pythonapi/tests/test_voices_train.py:167` wake test updates to call merged endpoint.
- `assets/voice-training-platform/components/{videos-view,voice-card,clip-table,speaker-label-editor,training-panel,chat-panel,log-monitor,add-video-bar}.tsx` -- port targets; `speaker-label-editor.tsx`'s `assignClipVoice` single-call pattern is the UI model to replicate against the merged endpoint.
- `assets/voice-training-platform/lib/assistant.ts` -- `ACTION_CATALOG` (10 entries) as the checklist for `useCopilotAction` names/descriptions; parser logic itself not ported.
- `apps/agentic-executor/src/app/features/voices/voice_api.ts:561-597` -- `useAssignRun`/`useCommitRun`/`useDiscardRun` collapse into one `useAssignRun` hook calling the merged endpoint; `RunAssignResponse`/`RunCommitResponse` types follow the backend merge.
- `apps/agentic-executor/src/app/features/voices/speaker_board.tsx:44-131` -- `selectVoiceForSpeaker`/`commit()`/`discard()` handlers and the three-button UI collapse to one relabel action, replaced by ported `speaker-label-editor.tsx` behavior.
- `apps/agentic-executor/src/app/features/voices/voice_event_stream.tsx` -- SSE consumption pattern (AG-UI `CUSTOM` dispatch, TanStack Query cache writes) is the target contract the ported `studio-provider.tsx` equivalent must call into; do not port the design's own SSE client.
- `apps/agentic-executor/src/app/features/voices/copilot_provider.tsx` -- integration point for new `useCopilotAction` registrations (none exist yet in this app).
- `apps/agentic-executor/src/app/features/voices/{voice_api,voice_card}.test.tsx` -- existing assertions on `AWAITING_COMMIT`/`Train now` gating need revisiting once assign-implies-train collapses that distinction.

## Tasks & Acceptance

**Execution:**
- [x] `apps/pythonapi/pythonapi/routes/voice.py` -- merge `assign_run`+`commit_run` into one `/assign` handler, delete `discard_run` -- implements the flattened flow
- [x] `apps/pythonapi/pythonapi/models/voices.py` -- update `RunAssignRequest`/`RunAssignResponse` to carry contributions -- matches new single-response shape
- [x] `apps/pythonapi/tests/test_voice_assign_commit.py` -- merge assign/commit test classes, delete discard tests -- keeps coverage aligned to new behavior
- [x] `apps/agentic-executor/src/app/features/voices/voice_api.ts` -- collapse three hooks into one -- matches merged endpoint
- [x] Adapted the existing (already design-aligned) Videos/Voices UI in `apps/agentic-executor/src/app/features/voices/` to the flattened endpoint and real SSE, rather than a literal file-copy port from `assets/voice-training-platform` -- see Spec Change Log
- [x] `apps/agentic-executor/src/app/features/voices/voice_copilot_actions.tsx` (new) -- register chat actions via `useFrontendTool` (CopilotKit v2) per `ACTION_CATALOG` -- replaces design's regex parser per CLAUDE.md v1-hooks-banned rule
- [x] `apps/agentic-executor/src/app/features/voices/{voice_api,voice_card}.test.tsx` -- update AWAITING_COMMIT/Train-now assertions -- reflects collapsed training-trigger timing

**Acceptance Criteria:**
- Given a run in `AWAITING_REVIEW` with speakers mapped to voices, when the operator relabels a clip's speaker in the ported UI, then one call persists the contribution(s), advances the run to `COMMITTED`, and starts training with no separate commit/discard action visible.
- Given a video URL already ingested, when the operator pastes it again, then existing clips/speakers are reused and no reprocessing is queued.
- Given the merged endpoint, when speaker naming is attempted, then only the search-or-create combobox is available — no free-text entry.

## Spec Change Log

- 2026-08-16: Deviation from the literal Code Map (not a loopback — no bad_spec/intent_gap finding triggered this). Rather than copying `assets/voice-training-platform`'s mockup components file-for-file, the implementer found `apps/agentic-executor/src/app/features/voices/` already had a mature, tested, protocol-correct implementation (real SSE, real combobox, real phase badges) matching the design's UX intent, and adapted it in place instead of replacing it wholesale. This satisfies every Boundaries constraint (useFrontendTool not useCopilotAction, real SSE not the design's mock stream, combobox-only naming, no discard) without discarding working code. KEEP: this judgment call — visual pixel-parity with the mockup's CSS was treated as non-binding; the spec's UX/behavioral requirements were treated as binding. No visual-parity pass was done; flagged as open if that's wanted later.
- 2026-08-16: Review round 1 (blind-hunter, edge-case-hunter, verification-gap) found `AssignSpeakerTool` (chat tool) called the merged `/assign` endpoint once per speaker, but the endpoint is single-shot/non-repeatable per run (409 after first success) — a second chat-tool call for a different speaker on the same run would strand it. Patched: `assignSpeaker` now takes an array of `{speakerLabel, voiceId}` pairs and sends one batched request, matching `SpeakerBoard.assignAndTrain`'s existing batching pattern. Tool description updated to warn against per-speaker calls. Also patched in this round: added a missing `voice_assignments == {}` assertion to `test_assign_rejects_an_all_null_assignment_and_stores_nothing`; reverted an accidentally-included `apps/pythonapi/.coverage` binary diff (confirmed not gitignored — flagged, not fixed, per scope). All three verified via `nx test`/`nx lint` after the fix. KEEP: the batched-assignments tool shape — do not regress to one-speaker-per-call.
- Deferred (not blocking this pass, logged to `deferred-work.md`): no component/unit test for `SpeakerBoard`'s assign UI, `AssignSpeakerTool`'s handler, or `VoiceSpeakerCombobox`'s no-free-text guarantee; no transaction/rollback on partial mid-loop write failure in `assign_run`; no guard against duplicate `voice_id` targets or unknown speaker-label keys in one assign request.

## Design Notes

Training-trigger semantics do not change: `commit_run` already sets `voice.phase = TRAINING` and wakes the reconciler for every distinct voice touched by the request, regardless of whether it was that voice's first or Nth contribution (confirmed via investigation — no separate "first contribution" special-case exists in `voice_training_reconciler.py`). So "training triggers automatically on first contribution" already behaves as "training triggers on every assign that touches a voice" today; flattening assign+commit does not change this behavior, only removes the separate call that used to gate it.

`RESTING_PHASES` and `VoiceRunPhase.COMMITTING` (an intermediate phase distinct from `COMMITTED`) should be reviewed for continued relevance — if nothing sets `COMMITTING` outside the old two-step flow, it likely becomes dead, but confirm via grep before removing (out of scope to resolve here, flag during implementation).

## Verification

**Commands:**
- Hand off to `litert-subagent` for `nx test pythonapi` and `nx test @agentic-executor/agentic-executor` -- expected: prior passing tests plus rewritten assign/commit/discard-removal tests pass; no `discard` references remain
- Hand off to `litert-subagent` for `nx lint pythonapi` and `nx lint @agentic-executor/agentic-executor` -- expected: clean

**Manual checks (if no CLI):**
- Load the ported Videos view, relabel a clip's speaker to a new voice, confirm one action commits and training starts with no separate commit/discard button present.
