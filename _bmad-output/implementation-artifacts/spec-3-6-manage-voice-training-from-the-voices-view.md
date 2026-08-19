---
title: 'Story 3.6: Manage Voice Training From the Voices View'
type: 'feature'
created: '2026-08-15'
status: 'done'
review_loop_iteration: 0
context: []
baseline_commit: 'b2332fdc0f1bcbf4ac62dc12bf6946ba8c2e4f98'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `apps/agentic-executor/src/app/voices/page.tsx` is an empty placeholder. An operator has no screen to see a voice's training phase, trigger training, or browse its contributing clips — every voice-level control from Story 3.1-3.3's backend has no UI.

**Approach:** Build a card-per-voice Voices view backed by the existing `GET /voices` (list) and `GET /voices/{id}` (contributions) routes, with "Train now"/"Retrain" calling the existing `POST /voices/{id}/train`, a contributing-videos popover, and a "View clips" modal that reuses the per-run `GET /runs/{id}/speakers` endpoint filtered to each contribution's speaker. No backend changes — every route this story needs already exists. Model size and "Download model" are deferred (no factory endpoint exists yet to serve the exported file — see `deferred-work.md`); live phase push over the event stream is also deferred (the stream currently carries only `VoiceRun` events — see `deferred-work.md`). This story uses refetch-on-mutation instead: after "Train now"/"Retrain", refetch the voice; otherwise the operator reloads to see a reconciler-driven phase change.

## Boundaries & Constraints

**Always:**
- `GET /voices` already supports `query`/`limit` (default 20, max 50); call it with an empty query and `limit=50` for "list every voice" — do not add pagination or a new list endpoint.
- `POST /voices/{id}/train` already handles both "Train now" and "Retrain" (always accepted, whatever the current phase) — call it unchanged for both card actions; do not add a second endpoint.
- `GET /voices/{id}` already returns `contributions: VoiceContribution[]` (each with `run_id`, `video_id`, `video_title`, `speaker_label`) — use it directly for the contributing-videos popover; do not add a new endpoint.
- "Train now" shows only while the voice has at least one contribution and phase is `AWAITING_COMMIT`; "Retrain" is always visible and always calls the same `useTrainVoice`. After either call resolves, refetch `GET /voices/{id}` (and invalidate the list) so the card reflects the new phase without a full page reload.
- "View clips" modal, per contributing video/run, calls the existing `GET /runs/{run_id}/speakers` and filters its `speakers` array to the contribution's `speaker_label` — do not add a new voice-scoped clips endpoint.
- New `voice_api.ts` hooks: `useVoiceList()` (`GET /voices?limit=50`), `useVoiceDetail(id)` (`GET /voices/{id}`), `useTrainVoice(id)` (`POST /voices/{id}/train`) — follow `useVoices`/`useApproveRun` (existing hooks in this file) as templates for query key shape and mutation/invalidation pattern.
- New components in `apps/agentic-executor/src/app/features/voices/`: `voice_card.tsx` (one card: name, `PhaseBadge` reuse, clip count, contributing-videos badge + popover, "Train now"/"Retrain", "View clips"), `voices_view.tsx` (fetches `useVoiceList`, renders a `VoiceCard` grid). Wire `voices_view.tsx` into `apps/agentic-executor/src/app/voices/page.tsx`, replacing its placeholder body.
- Add two minimal Base UI wrapper primitives, `components/ui/popover.tsx` and `components/ui/dialog.tsx`, from `@base-ui/react/popover` and `@base-ui/react/dialog`, styled like the existing `components/ui/select.tsx` (same Portal/Positioner/Popup shape) — no Popover/Dialog wrapper exists in this codebase yet.
- Show phase as `PhaseBadge` (reuse; extend its phase-to-style map if `VoicePhase`'s values differ from what it already handles for `VoiceRunPhase`).
- Card shows "Model size: —" and a disabled "Download model" button once `READY`, with a short label (e.g. "not available yet") — a visible placeholder for the deferred backend work, not a hidden feature.

**Ask First:** None expected — every backend route this story calls already exists and is unchanged.

**Never:**
- Do not add the model-download route, gateway method, or factory endpoint — deferred (see `deferred-work.md`).
- Do not extend the Redis event stream or add `voice.updated` push events — deferred (see `deferred-work.md`).
- Do not add pagination, filtering, or sorting controls to the Voices view — a flat card grid is sufficient for this story.
- Do not rebuild `speaker_board.tsx`'s clip playback/keep/reject UI inside the "View clips" modal — it is read-only here, no `ClipRow`/`useUpdateClips` reuse.
- Do not add e2e/UI/Playwright tests — per standing project directive, UX is not final.
- Do not build a general-purpose reusable Popover/Dialog beyond what `voice_card.tsx` needs — scope the two new UI primitives to what this story actually uses, matching `voice_speaker_combobox.tsx`'s "no generic component library" precedent from Story 3.5.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| List voices | Operator opens `/voices` | `GET /voices?limit=50` returns every voice; one card per voice | Empty list shows an empty-state message, not a blank page |
| Train now | Voice in `AWAITING_COMMIT` with >=1 contribution, operator clicks "Train now" | `POST /voices/{id}/train` called; on success, voice detail and list are refetched; card shows `TRAINING` | Request fails -> inline alert on the card, phase unchanged |
| Retrain a READY voice | Voice in `READY`, operator clicks "Retrain" | Same call/refetch as above, from any phase | Same as above |
| View clips across videos | Voice has contributions from 2 videos, operator clicks "View clips" | Modal lists clips grouped by contributing video, each fetched via that run's `/speakers` endpoint filtered to the contribution's speaker label | A contributing run's video deleted/unreachable -> that video's section shows an inline error, others still render |
| Phase changes elsewhere | Reconciler advances a voice while the Voices view is open, no action taken here | Card keeps showing the phase from the last fetch (no live push in this story) | Operator reload or any mutation-triggered refetch shows current state |

</frozen-after-approval>

## Code Map

- `apps/agentic-executor/src/app/voices/page.tsx` — replace placeholder body with `VoicesView`.
- `apps/agentic-executor/src/app/features/voices/voices_view.tsx` (new) — fetches `useVoiceList()`, renders grid of `VoiceCard`.
- `apps/agentic-executor/src/app/features/voices/voice_card.tsx` (new) — one voice's card UI; consumes `useVoiceDetail`, `useTrainVoice`; reuses `PhaseBadge` (`phase_badge.tsx`).
- `apps/agentic-executor/src/app/features/voices/voice_api.ts` — add `voiceQueryKeys.voiceList` / `voiceQueryKeys.voiceDetail(id)`, `useVoiceList`, `useVoiceDetail`, `useTrainVoice`; templates at `useVoices` (~line 505) and `useApproveRun` (~line 462).
- `apps/agentic-executor/src/components/ui/popover.tsx` (new), `apps/agentic-executor/src/components/ui/dialog.tsx` (new) — thin wrappers, styled like `components/ui/select.tsx`.
- `apps/pythonapi/pythonapi/routes/voices.py` — read-only reference: `search_voices` (line 63, list/search contract), `get_voice` (line 79, contributions shape), `train_voice` (line 99, phase-transition contract) — no changes.
- `apps/pythonapi/pythonapi/routes/voice.py:214` (`get_speaker_board`, `GET /runs/{run_id}/speakers`) — read-only reference for the view-clips modal's per-run fetch.
- `apps/agentic-executor/src/app/features/voices/phase_badge.tsx` — reused as-is; verify its phase map covers `VoicePhase` values (`awaiting_commit`, `training`, `exporting`, `ready`, `failed`).

## Tasks & Acceptance

**Execution:**
- [x] `agentic-executor/.../voice_api.ts` -- add `useVoiceList`, `useVoiceDetail`, `useTrainVoice` -- frontend access to list/detail/train routes
- [x] `components/ui/popover.tsx`, `components/ui/dialog.tsx` (new) -- Base UI wrappers -- backs the contributing-videos popover and view-clips modal
- [x] `agentic-executor/.../voice_card.tsx` (new) -- card UI: name, phase, clip count, contributing-videos popover, train/retrain, view-clips -- populates one voice's controls
- [x] `agentic-executor/.../voices_view.tsx` (new) -- list/grid of cards -- populates the view
- [x] `agentic-executor/src/app/voices/page.tsx` -- mount `VoicesView`, drop placeholder -- closes out Story 3.4's placeholder
- [x] `agentic-executor` frontend tests -- cover `useVoiceList`/`useVoiceDetail`/`useTrainVoice` and `voice_card.tsx`'s phase-conditional action visibility -- covers the I/O matrix's train/retrain rows

**Acceptance Criteria:**
- Given a voice with contributions in `AWAITING_COMMIT`, when an operator clicks "Train now", then the card refetches and shows `TRAINING`
- Given a voice with contributions from two different videos, when an operator opens "View clips", then clips from both videos are listed, each traceable to its source video
- Given a `READY` voice, when an operator opens its card, then "Download model" is visibly present but disabled with a "not available yet" label, and no model size is shown

## Design Notes

The contributing-videos popover and view-clips modal share one data source — `voice.contributions` from `GET /voices/{id}` — so `voice_card.tsx` fetches it once via `useVoiceDetail` and both UI pieces read from that same result; the modal additionally calls `GET /runs/{run_id}/speakers` per distinct `run_id` among the contributions, once when opened.

## Verification

**Commands:**
- Hand off to `litert-subagent`: `nx lint @agentic-executor/agentic-executor` -- expected: no new violations
- Hand off to `litert-subagent`: `nx typecheck @agentic-executor/agentic-executor` -- expected: clean
- Hand off to `litert-subagent`: `nx test @agentic-executor/agentic-executor` -- expected: new hook/component tests pass, existing suite unaffected

**Manual checks (if no CLI):**
- Run `nx dev @agentic-executor/agentic-executor` and `nx serve pythonapi`, open `/voices`, confirm every existing voice shows as a card. Click "Train now" on an `AWAITING_COMMIT` voice and confirm the card updates to `TRAINING` after the call resolves. Open "View clips" on a voice with contributions from more than one video and confirm clips are grouped correctly per video.

## Suggested Review Order

**Card UI and its data**

- Entry point: one voice's full card — phase badge, train/retrain, contributing-videos popover, view-clips dialog.
  [`voice_card.tsx:154`](../../apps/agentic-executor/src/app/features/voices/voice_card.tsx#L154)

- View-clips dialog stays mounted through Base UI's close animation; `enabled` gates the per-run fetch instead of JSX presence.
  [`voice_card.tsx:95`](../../apps/agentic-executor/src/app/features/voices/voice_card.tsx#L95)

- One contribution's clips, fetched only while its dialog is open and filtered to that speaker's label.
  [`voice_card.tsx:27`](../../apps/agentic-executor/src/app/features/voices/voice_card.tsx#L27)

- Contributing-videos popover reads the same `useVoiceDetail` result the card and dialog already fetched.
  [`voice_card.tsx:118`](../../apps/agentic-executor/src/app/features/voices/voice_card.tsx#L118)

- Card grid, loading/error/empty states — the page's actual content.
  [`voices_view.tsx:13`](../../apps/agentic-executor/src/app/features/voices/voices_view.tsx#L13)

**New data hooks**

- List every voice for the grid — no pagination, matches the route's max limit.
  [`voice_api.ts:602`](../../apps/agentic-executor/src/app/features/voices/voice_api.ts#L602)

- One voice's full detail, including the contribution audit trail the popover and dialog both read.
  [`voice_api.ts:613`](../../apps/agentic-executor/src/app/features/voices/voice_api.ts#L613)

- Start/restart training; invalidates both this voice's detail and the list so the phase shows without reload.
  [`voice_api.ts:625`](../../apps/agentic-executor/src/app/features/voices/voice_api.ts#L625)

- `voicesApiBase` — the durable-Voice router is a separate base URL from the run-pipeline router.
  [`voice_api.ts:22`](../../apps/agentic-executor/src/app/features/voices/voice_api.ts#L22)

**Phase badge widening**

- `AnyPhase` union lets one badge component serve both run-ingest and voice-training phases.
  [`phase_badge.tsx:14`](../../apps/agentic-executor/src/app/features/voices/phase_badge.tsx#L14)

- `awaiting_commit` is excluded from the pulse-dot's active set — it is a resting phase, not an in-progress one.
  [`phase_badge.tsx:44`](../../apps/agentic-executor/src/app/features/voices/phase_badge.tsx#L44)

**New UI primitives**

- Popover wrapper, scoped to this story's one use site — not a general component library.
  [`popover.tsx`](../../apps/agentic-executor/src/components/ui/popover.tsx#L1)

- Dialog wrapper; `DialogPopup` tracks its own mount state, which is why `voice_card.tsx` never conditionally renders it.
  [`dialog.tsx`](../../apps/agentic-executor/src/components/ui/dialog.tsx#L1)

**Peripherals**

- Placeholder page now mounts `VoicesView`.
  [`page.tsx:3`](../../apps/agentic-executor/src/app/voices/page.tsx#L3)

- Phase-conditional actions, the disabled Download-model stub, and the view-clips modal's per-video error isolation.
  [`voice_card.test.tsx`](../../apps/agentic-executor/src/app/features/voices/voice_card.test.tsx#L1)

- Empty-state and error-state coverage for the card grid.
  [`voices_view.test.tsx`](../../apps/agentic-executor/src/app/features/voices/voices_view.test.tsx#L1)

- Request-shape and cache-invalidation coverage for the three new hooks.
  [`voice_api.test.tsx`](../../apps/agentic-executor/src/app/features/voices/voice_api.test.tsx#L1)
