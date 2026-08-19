# Sprint Change Proposal — 2026-08-16

**Project:** copilot_agent_network
**Trigger:** User directive to adopt `assets/voice-training-platform` (a standalone Next.js design prototype) as the final UX for the voice-training dashboard, and to adjust the API to match its flow wherever feasible.
**Scope classification:** **Major** — invalidates FR17–FR19, FR22, and FR26; Epic 3 (all 6 stories) is `in-progress`/`review` and built against the requirements being reversed.

---

## 1. Issue Summary

The user supplied a finished UI design (`assets/voice-training-platform`, a v0-style Next.js prototype) and asked that it become the app's real UI, with mismatches between its assumptions and the real `pythonapi` backend resolved by adjusting the API rather than the design, wherever that is feasible.

Comparing the two revealed the prototype was built independent of this codebase: it defines its own simplified domain model (`Video` → `Clip` → `Voice` → `TrainingRun` → `Checkpoint`, all in an in-memory mock store) and its own fake REST + SSE API. It has no concept of the real backend's `VoiceRun.phase` state machine, its `AWAITING_REVIEW → COMMITTING → COMMITTED` flow, or its immutable `voice_contributions` audit trail.

The most consequential mismatch: **the design lets an operator relabel a clip's speaker directly onto a Voice, effective immediately — there is no assign/review/commit distinction anywhere in its UI.** The real backend deliberately splits this into two operations, `POST /runs/{id}/assign` (draft, reversible) and `POST /runs/{id}/commit` (locks in, writes immutable audit rows, triggers training). That split is not an implementation detail; it is the explicit subject of five functional requirements — FR17, FR18, FR19, FR22, FR26 — and of Story 3.2's frozen intent ("Split Assignment From Commit, With an Audit Trail").

The user was shown this conflict directly and confirmed: flatten the backend to match the design. Assigning a speaker to a voice should commit immediately.

## 2. Impact Analysis

### Epic Impact

- **Epic 3 — Multi-Video Voice Building** (`in-progress`; Stories 3.1–3.6 all `review`): directly invalidated at its core. The epic's stated purpose — "assigning and committing as separate steps" — is being reversed by user decision. Every story needs re-scoping, not just the UI-facing ones.
- **Epic 2 — Reusable Video Ingestion** (`done`): not directly touched. Its FRs (FR12–FR15) concern video/character reuse and preprocessing, which are orthogonal to the assign/commit split. No change expected, but Epic 3's rework must not regress Epic 2's gateway contract (NFR3's cross-repo pairing).
- **Epic 1 — Agent Tool-Calling on the Voices Dashboard** (`backlog`): not started, so no rework cost, but its build order is "ships after Epic 3, directly against the final Videos/Voices UI" (epics.md line 127) specifically to avoid rebuilding FR10's frontend tool. That premise still holds — Epic 1 should wait for the redesigned Epic 3 to land, same as originally planned, just against different final UI/backend shapes.

### Story-Level Impact (Epic 3)

| Story | Current status | Impact |
|---|---|---|
| 3.1 Create the Durable Voice Entity | review | Kept. `Voice` entity (id, name, phase, checkpoint_path) is not part of the assign/commit split — the design also has a `Voice` concept. Minor: no `contributions` list is needed if assignment writes are immediate and untracked; decide whether to keep a lightweight contribution log for traceability or drop the table (see Open Decision 1 below). |
| 3.2 Split Assignment From Commit, With an Audit Trail | review | **Superseded.** The story's entire premise — two routes, a `voice_assignments` draft field, an append-only `voice_contributions` table, a new `COMMITTED` run phase — is reversed. Replace with a single merged route (see Recommended Approach). |
| 3.3 Trigger Training Explicitly or Automatically | review | **Revised.** FR20's "training triggers automatically on a Voice's first contribution" now fires on the merged assign-and-commit call instead of a separate `/commit`. The explicit `POST /voices/{id}/train` path (also in the design, via `lib/assistant.ts`'s "train" action and `/api/voices/[id]/train`) is unaffected. |
| 3.4 Split the Dashboard into Videos and Voices Views | review | Kept in spirit — design also has a Videos/Voices split (`ViewTabs` in `studio-provider.tsx`/`page.tsx`), though as tabs in one shell rather than separate nav routes. Component structure changes; the FR23 requirement (independent rendering, no full reload) is still satisfiable. |
| 3.5 Review Ingestion and Assign Speakers in the Videos View | review | **Revised.** FR26 explicitly names "Assign speakers," "Commit assignments," and "Discard" as three distinct actions — this is being replaced by the design's single relabel-and-done interaction. FR24/FR25 (video list shape, search-or-create combobox) are compatible with the design's `ClipTable`/speaker relabeling, though the design uses free-text relabeling today (see Open Decision 2). |
| 3.6 Manage Voice Training From the Voices View | review | **Revised.** FR27's card contents (contributing-videos popover with assignment dates, "Train now" gated on `AWAITING_COMMIT`) assumed the two-phase model. With immediate commit, "Train now" vs. "Retrain" collapses toward the design's simpler `voice-card.tsx`, which shows one training action plus sample/export. Contributing-videos popover can survive only if some minimal contribution record is kept (Open Decision 1). |

### Artifact Conflicts

- **PRD / Epics (`epics.md`):** FR17, FR18, FR19, FR22, FR26 must be marked superseded and rewritten. FR23–FR25, FR27 need wording passes to drop assign/commit/discard language.
- **Frozen spec files:** `spec-3-2-split-assignment-from-commit-with-an-audit-trail.md` is `frozen-after-approval` — per its own header, it may only be changed by human renegotiation, which this proposal constitutes. It should be superseded by a new spec (working title: `spec-3-2-merge-assignment-into-immediate-commit.md`) rather than edited in place, preserving the historical record of why the split existed and why it was reversed.
- **No Architecture.md or UX design contract exists** for this project (epics.md line 21, line 75) — nothing to update there.
- **Backend code:** `models/voice.py` (`VoiceRunPhase.COMMITTED`, `RESTING_PHASES`, `voice_assignments` field), `models/orm.py` (`VoiceContributionRow`), `models/voices.py` (`VoiceContribution`, `RunAssignRequest/Response`, `RunCommitResponse`), `repositories/voice_contributions.py`, `routes/voice.py` (`assign_run`, `discard_run`, `commit_run` handlers), `routes/voices.py` (`get_voice`'s contribution population), `workers/voice_training_reconciler.py` (wake-on-commit trigger) all need rework.
- **Frontend code:** the entire `apps/agentic-executor/src/app/features/voices/` directory (11 components + 2 test files, ~2000 lines) and `app/voices/page.tsx` are candidates for wholesale replacement by ported/adapted design components (`videos-view.tsx`, `voice-card.tsx`, `clip-table.tsx`, `speaker-label-editor.tsx`, `training-panel.tsx`, `chat-panel.tsx`, `log-monitor.tsx`, etc.), per the user's "copy the design in" instruction.
- **Other artifacts:** No IaC/deployment/CI impact expected. Testing strategy is affected — `voice_api.test.tsx`, `voice_card.test.tsx`, `voices_view.test.tsx` and the pythonapi `test_voice.py`/new `test_voice_assign_commit.py` (per Story 3.2's Verification section) all target behavior being replaced and need rewriting, not just re-running.

### Additional divergences discovered (not FR-blocking, but must be resolved before/during implementation)

These don't invalidate approved requirements, but the design prototype makes assumptions the real system doesn't share, and the user's instruction was to flag UI-affecting gaps rather than decide them unilaterally:

1. **SSE protocol.** Design: bespoke `/api/stream` emitting full-`Snapshot` `state` events and individual `log` events. Real: `/voice/events`, AG-UI `CustomEvent`s (`EVENT_RUN_UPDATED`, `EVENT_RUN_LOG`) with Redis-Stream-ID-based `Last-Event-ID` replay. The design's `StudioProvider` SSE handling needs a rewrite against the real protocol; not a UI decision, just adaptation work.
2. **Chat assistant.** Design: regex/keyword intent parser (`lib/assistant.ts`) driving local mock-store mutations directly. Real: CopilotKit v2 (`react-core/v2`) wired through AG-UI (`copilot_provider.tsx`), per CLAUDE.md's explicit "v1 hooks banned" rule and Epic 1's whole purpose. **The design's chat panel cannot be ported as-is** — it must be re-implemented as CopilotKit actions/tools. This is existing direction (Epic 1), not a new decision.
3. **Video ingestion entry point.** Design: paste a YouTube URL directly (`add-video-bar.tsx` → `POST /api/videos`), which always queues fresh download/transcribe/diarize. Real: video-scoped ingestion (Epic 2, `done`) keys ingestion by video ID, not by character, so a video's speakers already fan out to as many voices as needed from one ingestion (that's what `SpeakerGroup`/`speaker_board` is for) — but re-pasting a URL that was already ingested should not re-trigger download/transcribe/diarize. **Resolved:** keep dedupe-on-add. The UI stays a plain paste-URL box (no separate search screen needed); underneath, adding a video checks whether it's already been ingested and reuses the existing clips/speakers instead of re-processing, preserving Epic 2's FR12 payoff.
4. **Speaker naming.** Design: free-text relabel (`speaker-label-editor.tsx` lets you type anything). Real: FR25 requires "combobox searches existing Voices or creates new inline — no free text." **Open Decision 3:** keep FR25's combobox-only constraint (prevents silent typos fragmenting a voice's dataset across misspelled names) layered onto the design's simpler interaction, or adopt the design's free-text field as-is. Recommend keeping the combobox — it's cheap to keep and the typo-fragmentation risk is real.
5. **Contribution/audit trail removal fallout.** If `voice_contributions` is dropped entirely rather than kept as an immediate-write log, Story 3.6's "contributing-videos popover" (FR27) and "View clips across all contributing videos" lose their data source. **Open Decision 1:** keep `voice_contributions` as a table that's still written to (just synchronously, on assign, instead of on a separate commit step) — cheapest option, preserves FR22/FR27's traceability UI with no reversal of NFR4 persistence conventions — versus dropping it and losing the popover/traceability feature from Story 3.6 entirely. Recommend keeping the table as an immediate-write log; it costs nothing extra now that assign and commit are the same call, and it's what makes FR27's "contributing videos" badge possible at all.

## 3. Recommended Approach

**Direct Adjustment (checklist Option 1), scoped as a rework of Epic 3's stories rather than a rollback.** A rollback (Option 2) was considered — reverting Stories 3.2/3.3/3.5/3.6 to their pre-review commits and starting over — but the code, tests, and DB schema from Stories 3.1–3.6 are 80% reusable (the `Voice` entity, phase enum scaffolding, repository patterns, view-split structure all survive); only the assign/commit boundary and the contribution-write timing change. A full rollback would throw away more than it saves.

**Concretely:**

- Merge `POST /runs/{id}/assign` and `POST /runs/{id}/commit` into one call (reuse the `/assign` path and behavior of `/commit`, minus the phase guard requiring a prior separate assign step). It writes `voice_contributions` row(s) immediately and advances `ingest_phase` to `COMMITTED` in the same request. Drop `discard_run` (nothing to discard once there's no draft state).
- Keep the `voice_contributions` table and `VoiceContributionRepository` so FR22/FR27's traceability survives — it becomes a synchronous side effect of assignment instead of a two-step commit. (Decision 1 — confirmed.)
- Keep FR25's search-or-create combobox constraint layered onto the design's simpler-looking interaction rather than adopting true free text. (Decision 3 — confirmed.)
- Keep dedupe-on-add: pasting an already-ingested video's URL reuses its existing clips/speakers instead of re-downloading/re-diarizing. No separate "search" screen is needed — the paste-URL box stays as the design shows it; the dedupe check happens underneath. (Decision 2 — confirmed, corrected from an earlier framing that wrongly implied a video is exclusively "claimed" by one character. A video's speakers already fan out to multiple voices from one ingestion; the only real question was whether re-adding a known video re-triggers processing.)
- Port the design's components into `apps/agentic-executor/src/app/features/voices/` and `app/videos/`, replacing the current implementation, adapted to call the flattened API and the real SSE protocol (`/voice/events`) instead of the design's mock endpoints.
- Re-implement the design's chat panel against CopilotKit v2 per Epic 1 / NFR2, not the design's regex parser.

**Effort:** High. **Risk:** Medium — the backend change is small in surface area (collapse two routes into one, drop one phase transition) but touches already-reviewed, shipped code and its full test suite; the frontend port is large (11+ components) but mechanical once the API contract is settled.

## 4. Detailed Change Proposals

### PRD / Epics — Functional Requirement rewrites

```
FR17 (superseded): "Run ingest_phase and Voice phase are tracked separately;
a Run reaching COMMITTED does not itself change any Voice's phase."
→ NEW: "Run ingest_phase and Voice phase remain tracked on separate tables/
columns; a Run reaching COMMITTED (now the immediate result of assignment)
moves the assigned Voice(s) to TRAINING in the same operation."
Rationale: assign and commit are no longer separate operations, so
"does not itself change" no longer holds — the flattened flow makes that
the point.

FR18 (superseded): "POST /runs/{id}/assign associates a video's speakers
with Voices without changing ingest_phase. POST /runs/{id}/commit
separately creates immutable Voice Contribution records and advances
ingest_phase to COMMITTED."
→ NEW: "POST /runs/{id}/assign associates a video's speakers with Voices,
creates one immutable Voice Contribution record per (voice, run, speaker)
triple, and advances ingest_phase to COMMITTED, all in one call."
Rationale: per user decision, merge assign and commit into one step.

FR19 (kept, reworded): "One voice_contributions row is created per (voice,
run, speaker) triple on assignment; rows are never updated in place."
Rationale: immutability and one-row-per-triple both survive; only the
trigger (assign, not commit) changes.

FR22: unchanged. Repository-layer contribution/voice queries still needed.

FR26 (superseded): "'Assign speakers' opens the combobox without starting
training; 'Commit assignments' locks assignments in and creates
contributions; 'Discard' resets a run to AWAITING_REVIEW. Multiple videos
can be assigned in parallel and committed individually or in batch."
→ NEW: "Assigning a speaker to a Voice via the combobox commits
immediately: it creates the contribution record and, on a Voice's first
contribution, triggers training. There is no separate commit or discard
step. Multiple videos' speakers can be assigned independently and in any
order."
Rationale: per user decision, drop the assign/commit/discard three-action
model in favor of the design's single relabel-and-done interaction.
```

### Story rewrites needed (titles only — full ACs to be drafted when a build agent picks these up)

- **Story 3.2** retitled: "Merge Assignment and Commit Into One Immediate, Audited Action" — replaces the current frozen spec.
- **Story 3.3**: AC1 changes trigger condition from "the commit that creates [the first contribution]" to "the assign call that creates it" — one word-level change, rest of the story (explicit train, per-voice LangGraph) is unaffected.
- **Story 3.5**: ACs referencing "Commit assignments" and "Discard" buttons are removed; "Assign speakers" AC is rewritten to describe the single immediate action.
- **Story 3.6**: "Train now" (gated on `AWAITING_COMMIT`) collapses — a voice with any contribution is already training or trained, so this action likely disappears in favor of just "Retrain," matching the design's `voice-card.tsx`.

## 5. Implementation Handoff

**Scope classification: Major.** Epic 3 is `in-progress` with all stories already in `review`; this reverses approved, implemented functional requirements and requires backlog reorganization plus new/rewritten stories before any code changes — not a direct developer-agent implementation task.

**Routed to:** Product Manager / Architect-equivalent workflow next — recommend running `bmad-prd` (update intent) to formally revise FR17/FR18/FR26 in the PRD, then `bmad-create-epics-and-stories` or manual epic edit to rewrite Stories 3.2/3.3/3.5/3.6, before any `bmad-build` implementation work begins on the merged assign/commit route or the ported UI.

**Responsibilities:**
- PRD owner: apply the FR17/FR18/FR19/FR26 rewrites above.
- Epic/story owner: rewrite Stories 3.2, 3.3, 3.5, 3.6 acceptance criteria; supersede `spec-3-2-split-assignment-from-commit-with-an-audit-trail.md` with a new spec file rather than editing the frozen one in place.
- Developer agent (after re-planning): implement the merged route, port design components, rewrite affected tests.

**Success criteria:** A single `POST /runs/{id}/assign`-equivalent call performs assignment, contribution-write, and (on first contribution) training trigger in one step; the ported UI from `assets/voice-training-platform` drives it with no visible assign/commit/discard distinction; FR19/FR22/FR27 traceability (contributing-videos popover, immutable audit rows) still functions; Epic 2's video-reuse and Epic 1's future agent-tool work are unaffected.

## Open Decisions — Resolved

1. **Keep `voice_contributions` as an immediate-write audit log.** Confirmed. Story 3.6's contributing-videos popover keeps working.
2. **Keep dedupe-on-add for video ingestion**, expressed as a check underneath the same paste-URL box the design already shows (no separate search screen). Confirmed. Preserves Epic 2's FR12 payoff without adding UI the design doesn't have.
3. **Keep FR25's search-or-create-only speaker combobox**, layered onto the design's interaction in place of its free-text field. Confirmed. Prevents typo-driven voice fragmentation.

All three resolved in favor of the recommended option, with Decision 2's framing corrected: ingestion dedupe is per-video, not per-character — a video's speakers already fan out to multiple voices from a single ingestion (this is what Epic 2 and `speaker_board`/`SpeakerGroup` already do). The open question was only whether re-adding an already-known video re-triggers download/transcribe/diarize; it should not.
