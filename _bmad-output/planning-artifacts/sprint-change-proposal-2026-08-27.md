# Sprint Change Proposal — 2026-08-27

**Type:** Documentation reconciliation (no code change)
**Scope classification:** Moderate — backlog and requirement text realignment, no replan
**Prepared by:** Correct Course workflow, for CodeSoup
**Supersedes nothing. Extends:** `sprint-change-proposal-2026-08-16.md`

---

## 1. Issue Summary

The BMAD planning artifacts — `prd-copilot_agent_network-2026-08-13/prd.md`,
`epics.md`, the seven spec kernels, and `sprint-status.yaml` — describe a
system state the code left behind. Between the plan date (2026-08-13) and today
(2026-08-27), about 40 commits shipped three changes the artifacts never
caught up with.

### 1.1 The three divergences

**A. The voice data model changed twice, not once.**
The 2026-08-16 proposal flattened Story 3.2's `assign` → `commit` split into
one `POST /runs/{id}/assign` call that writes `voice_contributions` rows and
moves the run to `COMMITTED`. That merged model was then dropped as well. The
code now uses a **clip-based assignment model**:

- No `assign_run`, `commit_run`, or `discard_run` handler exists.
- No `voice_contributions` table, `VoiceContribution` schema, or `COMMITTED`
  run phase exists anywhere in `apps/pythonapi`.
- `VoiceRunPhase` is `DOWNLOADING → DIARIZING → INGESTED → FAILED`. Review is
  not a phase — a video is "in review" until every clip has a keep/exclude
  decision.
- Assignment is `POST /voices/{voice_id}/clips` (a list of clip IDs from one
  video) and `POST /voices/{voice_id}/clips/unassign`. A voice holds clips,
  not contributions.
- `VoicePhase` is `AWAITING_COMMIT → COMPILING → TRAINING → EXPORTING →
  READY → FAILED`. `COMPILING` gathers every kept clip assigned to the voice,
  across every video, at training start.

**B. A multi-agent A2A architecture was added, and it is not in the PRD.**
`spec-multi-agent-a2a` was written and delivered: an Orchestrator agent
(`agents/orchestrator/`), a Research Agent (`agents/research/`), and a Voice
Agent (`agents/voice/`), each with a published A2A Agent Card, plus ARD
discovery (`core/ard_catalog.py`, `routes/ard.py`). The Orchestrator is the
only agent the browser talks to; it routes each request to a specialist over
A2A. This work absorbed Epic 1's tool-calling loop — `chat_agent.py` moved to
`agents/orchestrator/chat_agent.py` and forwards browser tool definitions to
the model there. `spec-multi-agent-a2a` never entered `epics.md`.

**C. Features shipped with no spec.**
Postgres-backed clip storage (`voice_clips` table), a clip trim/zoom editor,
per-clip transcription editing with auto-update, collapsible panels, TLS for
local/LAN, editable voice names, and `spec-factory-source-of-truth` (merged as
PR #20) are all in `main` and none are in `epics.md`.

### 1.2 Evidence

- `grep -rn 'assign_run|commit_run|discard_run|voice_contributions|VoiceContribution|COMMITTED' apps/pythonapi/pythonapi/` → no source matches (only a comment in `voice_training_graph.py` referencing the old `AWAITING_COMMIT` name).
- `apps/pythonapi/pythonapi/agents/{orchestrator,research,voice}/` — all present, each with `app.py`, `card.py`, `executor.py`, `interface.py`.
- `apps/pythonapi/pythonapi/models/voice_run.py` — `VoiceRunPhase` enum has four members, none named `COMMITTED` or `AWAITING_REVIEW`.
- `apps/pythonapi/pythonapi/routes/voices.py` — routes are `POST /voices/{id}/clips`, `/clips/unassign`, `POST /voices/{id}/train`, `PATCH /voices/{id}` (rename). No run-scoped assign/commit.
- `git log --grep` — PR #19 (flatten assign/commit) and PR #20 (factory source of truth) both merged to `main`.
- `_bmad-output/specs/spec-multi-agent-a2a/` and `spec-factory-source-of-truth/` exist; neither is referenced by `epics.md` front matter.

---

## 2. Impact Analysis

### 2.1 Epic Impact

| Epic | Recorded status | Actual | Action |
|---|---|---|---|
| **Epic 1 — Agent Tool-Calling on the Voices Dashboard** | `backlog` | Delivered, inside the A2A build. FR1–4, 6, 7–11 satisfied by `agents/orchestrator/chat_agent.py` + `features/chat/copilot_tools.tsx`. FR5 not implemented. | → `done`. FR5 → **out of scope** (see 2.3). Note the A2A absorption. |
| **Epic 2 — Reusable Video Ingestion** | `done` | Accurate. FR12–15 shipped in `star-trek-voyicer` + the gateway. | No change. |
| **Epic 3 — Multi-Video Voice Building** | `in-progress`, stories in `review` | Delivered, on the clip-based model, not the run-based `assign`/`commit`/`voice_contributions` model the stories describe. | → `done`. Rewrite FR16–27 text; supersede Stories 3.2/3.3/3.5 at the mechanism level; mark 3.1/3.4/3.6 delivered. |

No future epics remain. Two delivered bodies of work have no epic:
`spec-multi-agent-a2a` and `spec-factory-source-of-truth`.

### 2.2 Story-Level Impact (Epic 3)

| Story | Recorded | Actual outcome |
|---|---|---|
| 3.1 Create the Durable Voice Entity | review | **Delivered.** `voices` table, `POST /voices`, `GET /voices/{id}`. `GET /voices/{id}` returns the voice with its `clips`, not `contributions`. |
| 3.2 Flatten Assignment and Commit | review | **Superseded again.** No run-based assign/commit at all. Replaced by `POST /voices/{id}/clips`. `voice_contributions` never shipped. |
| 3.3 Trigger Training Explicitly or Automatically | review | **Delivered, retriggered differently.** `POST /voices/{id}/train` (explicit) works. Auto-trigger fires when clips are assigned to a voice (`VoiceTrainingReconciler.wake(voice_id)`), not on a "first contribution." Separate LangGraph per voice (`voice_training_graph.py`) confirmed. |
| 3.4 Split the Dashboard into Videos and Voices Views | review | **Delivered as client tab state**, not route segments. `type View = "videos" \| "voices" \| "search"` in `studio_provider.tsx`. Each renders independently, no full reload. |
| 3.5 Review Ingestion and Assign Speakers in the Videos View | review | **Delivered, clip-based.** Videos view + clip table + speaker combobox (search-or-create, no free text). Assigning a speaker's clips to a voice is immediate. No commit/discard. |
| 3.6 Manage Voice Training From the Voices View | review | **Delivered, trimmed.** Voice cards show name, phase, kept-clip count. "Retrain" via `POST /voices/{id}/train`. **No contributing-videos popover** — the clip model has no per-video contribution record with an assignment date. "View clips" lists the voice's clips across videos. |

### 2.3 FR-Level Verdict

**Delivered as worded (tag `[DELIVERED]`):**
FR1, FR2, FR3, FR4, FR6, FR7, FR8, FR9, FR10, FR11, FR12, FR13, FR14, FR15,
FR20, FR21, FR23, FR25.

**Delivered by a different mechanism — FR text to be rewritten, then tagged
`[DELIVERED]`:**
- FR16 — voice returns its `clips`, not `contributions`.
- FR17 — no `COMMITTED` phase; run phases are `DOWNLOADING/DIARIZING/INGESTED/FAILED`; voice and run phases are on separate tables; nothing about assignment moves a run phase.
- FR18 — becomes `POST /voices/{id}/clips`: assign a video's clips to a voice; append-only assignment; no run-phase change.
- FR19 — the immutable audit record is the clip→voice assignment on `voice_clips`, one row per clip; the `(voice, run, speaker)` triple is gone.
- FR22 — repository answers "all clips for this voice, with their video" (`list_clips_for_voice`, `list_clips_for_voices`) and "fetch voice by name" (`get_voice_by_name`).
- FR24 — Videos view surfaces clips per video with per-clip keep/exclude and an assigned-voice label; "speaker count" becomes "detected speakers."
- FR26 — assigning a speaker's clips to a voice via the combobox is immediate; auto-trains on first assignment; no commit/discard.
- FR27 — Voice card shows name, phase, kept-clip count, "Retrain", "View clips". **Drop** the contributing-videos popover with assignment dates and the phase-conditional "Train now"/model-size/"Download model" language that the clip model does not carry. (If model download and size display exist, keep them; verify at edit time.)

**Not delivered, now out of scope (tag `[OUT OF SCOPE]`):**
- **FR5 — runaway tool-calling cap.** No `LLM_MAX_TOOL_TURNS` setting or turn-count logic exists. The orchestrator emits tool calls and ends the run; it never loops server-side waiting on a tool, so a server-side turn cap has no loop to bound. The browser (CopilotKit v2) drives the follow-up run. If a cap is wanted, it belongs on the browser side and is a new, unplanned item.

### 2.4 Artifact Conflicts

- **`prd.md`** — §4.1 FR-5; all of §4.4 (FR-16–22) and §4.5 (FR-23–27); §4.2 "Out of Scope" note that still names `approve_run`; UJ-3 prose ("commit both assignments together", "contributing videos listed"); §7 SM-2 ("each contribution traceable in the UI"); §8 Open Questions 1–4 and §9 Assumptions Index (FR-20 assumption).
- **`epics.md`** — Requirements Inventory FR17/18/19/22/26; FR Coverage Map; Epic 1 and Epic 3 status; Stories 3.2/3.3/3.5/3.6 bodies; no mention of `spec-multi-agent-a2a` or `spec-factory-source-of-truth`.
- **`sprint-status.yaml`** — Epic 1 `backlog` → `done`; Epic 3 `in-progress` → `done`; all Epic 3 stories `review` → `done`; add a dated note for this proposal.
- **Spec `SPEC.md` files** — none carry a delivery-status line. Add one to all seven.
- **No Architecture.md, no UX design contract** — nothing to update there.
- **Tests** — `test_voice.py`, `test_voices.py`, `test_voices_train.py`, `test_agent_tools.py`, `test_orchestrator_*`, `test_research_agent.py`, `test_voice_agent.py`, `test_ard.py` all track current behavior. No test debt from this reconciliation.
- **Code** — none. This proposal changes documentation only.

### 2.5 Technical Impact

None. The code is complete and its test suite is green (228 passing as of the
2026-08-23 baseline, per project memory). This proposal makes the written
record match the code, not the other way round.

---

## 3. Recommended Approach

**Option 1 — Direct Adjustment (documentation-only).** Effort: Low. Risk: Low.

Rewrite the diverged FR text to describe the shipped clip-based and A2A
reality, tag every FR and story with its delivery status, add the two missing
bodies of work to `epics.md` as delivered epics, and refresh
`sprint-status.yaml` and the spec headers.

Rejected alternatives:
- **Rollback** — the clip-based model and the A2A layer are the intended end
  state. There is nothing to revert.
- **MVP Review** — the MVP is met. Every user journey (UJ-1 through UJ-4) is
  served, by different mechanisms than the plan named.
- **Full replan** — the PRD's vision, target user, and user journeys still
  hold. Only the §4.4/§4.5 mechanism text and one §4.1 FR are wrong. A replan
  would rebuild artifacts that are 80% correct.

---

## 4. Detailed Change Proposals

Grouped by artifact. Old → new for each. Applied in batch after approval.

### 4.1 `prd.md`

**FR-5 (§4.1)** — retag as out of scope:
> `[OUT OF SCOPE — 2026-08-27]` Not implemented and no longer applicable. The
> Orchestrator agent emits tool calls and ends the run (FR-3); it never loops
> server-side on tool results, so there is no server-side turn count to cap.
> `LLM_MAX_TOOL_TURNS` was never added. A cap, if wanted, belongs on the
> browser (CopilotKit v2) follow-up loop and is a new item, not this one.

**§4.1 Description, last sentence** — append:
> Delivered inside the multi-agent A2A build (`spec-multi-agent-a2a`): the
> loop lives in `agents/orchestrator/chat_agent.py`.

**§4.2 "Out of Scope" bullet** — replace the parenthetical
`(assign, commit, discard, train)` with `(assign clips to a voice, unassign,
train)` and drop "the `approve_run` action this PRD's other thread removes"
(there is no `approve_run` and no assign/commit split).

**§4.4 Description** — replace the "two separate, explicit steps" sentence:
> OLD: "assigning a speaker to a Voice and committing that assignment (which
> starts training) become two separate, explicit steps rather than one
> irreversible action. That split is a deliberate trade: ..."
> NEW: "assigning a video's clips to a Voice is one immediate action:
> `POST /voices/{id}/clips`. A Voice holds clips gathered from any number of
> videos; assigning the first clips to a Voice starts its training. There is
> no separate commit or discard step. `[SUPERSEDED 2026-08-27 — the
> run-based assign/commit/`voice_contributions` model in FR-16–22 below was
> reversed twice; the shipped model is clip-based. See
> sprint-change-proposal-2026-08-27.md.]`"

**FR-16** — rewrite:
> The system represents a Voice (`id`, `name`, `phase`, `checkpoint_path`)
> independent of any single video via a `voices` table, exposed via
> `POST /voices` to create a named Voice, `GET /voices/{id}` to fetch a Voice
> with its assigned clips, and `PATCH /voices/{id}` to rename it.
> `[DELIVERED — clips, not "contributions"]`

**FR-17** — rewrite:
> Run `phase` (`DOWNLOADING`/`DIARIZING`/`INGESTED`/`FAILED`) and Voice
> `phase` (`AWAITING_COMMIT`/`COMPILING`/`TRAINING`/`EXPORTING`/`READY`/`FAILED`)
> are tracked on separate tables. Neither state machine drives the other:
> assigning clips to a Voice does not change any run's phase, and a run
> reaching `INGESTED` does not change any Voice's phase.
> `[SUPERSEDED 2026-08-27 — no `COMMITTED` phase; see
> sprint-change-proposal-2026-08-27.md]` `[DELIVERED — separate state
> machines]`

**FR-18** — rewrite:
> `POST /voices/{id}/clips` assigns a list of a video's clip IDs to a Voice.
> `POST /voices/{id}/clips/unassign` removes them. Assignment is per-clip and
> append-only; it does not touch any run's phase. Picking a speaker in the UI
> sends that speaker's whole clip list; correcting one clip sends one ID.
> `[SUPERSEDED 2026-08-27 — no run-scoped `/assign` or `/commit`; see
> sprint-change-proposal-2026-08-27.md]` `[DELIVERED — clip-based]`

**FR-19** — rewrite:
> Each clip carries at most one Voice assignment, recorded on `voice_clips`.
> Reassigning a clip overwrites that one field; the clip and its audio are
> never mutated. Un-keeping or reassigning a clip takes effect at the next
> `COMPILING` pass, which re-gathers the Voice's kept clips from scratch.
> `[SUPERSEDED 2026-08-27 — the `(voice, run, speaker)` contribution triple
> and `voice_contributions` table were never shipped]` `[DELIVERED — clip
> assignment is the record]`

**FR-20** — keep, drop the `[ASSUMPTION]` block, add:
> `POST /voices/{id}/train` triggers training explicitly (accepted in any
> phase). Training also triggers automatically when clips are first assigned
> to a Voice — the assign route wakes `VoiceTrainingReconciler`. Both paths
> are permanent. `[DELIVERED]`

**FR-21** — keep, reword "triggered on contribution commit" → "triggered when
clips are assigned to the Voice". `[DELIVERED]`

**FR-22** — rewrite:
> The repository layer answers "all clips assigned to this Voice, each with
> the video it came from" (`list_clips_for_voice`, `list_clips_for_voices`)
> and "fetch Voice by name" (`get_voice_by_name`), alongside the existing
> run-centric queries. `[SUPERSEDED 2026-08-27 — "all contributions joined to
> run/video" is now "all clips with their video"]` `[DELIVERED]`

**§4.4 Feature-specific NFR** — replace the last two sentences:
> `voice_runs` holds ingestion fields only; training state lives on the new
> `voices` table. `voices` and `voice_clips` are the new tables.
> `voice_contributions` was never created. `Base.metadata.create_all`, no
> raw SQL, no Alembic — per convention.

**FR-23** — keep, reword:
> A tab segment switches between Videos, Voices, and Search views
> (`type View` in `studio_provider.tsx`); each renders independently with no
> full reload. `[DELIVERED — client tab state, not App Router segments]`

**FR-24** — rewrite:
> The Videos view lists each video's title, source URL, detected-speaker
> count, and diarization status. Expanding a video shows its clips in a
> table: per-clip transcript, keep/exclude state, diarization-quality flag,
> and the Voice each clip is assigned to (or "unassigned"). `[DELIVERED]`

**FR-25** — keep as worded. `[DELIVERED]`

**FR-26** — rewrite:
> Picking a Voice for a speaker in the combobox assigns that speaker's clips
> to the Voice in one call and, if it is the Voice's first assignment, starts
> its training. There is no separate commit or discard step. Speakers across
> any number of videos can be assigned independently, in any order. A later
> per-clip correction reassigns that one clip.
> `[SUPERSEDED 2026-08-27 — clip-based, not the `voice_contributions` write
> FR-26 named on 2026-08-16]` `[DELIVERED]`

**FR-27** — rewrite:
> The Voices view shows a card per Voice: name (editable inline via
> `PATCH /voices/{id}`), a phase pill, kept-clip count, source-video count,
> and total kept-clip duration. Selecting a Voice opens a training panel that
> lists its kept and excluded clips (gathered across every source video — the
> same rows `COMPILING` uses) and a single "Start training" action, enabled
> when the Voice has at least one kept clip and is not already training, that
> calls `POST /voices/{id}/train`.
> `[SUPERSEDED 2026-08-27 — dropped, not built: the contributing-videos
> popover with per-video clip counts and assignment dates, the phase-
> conditional "Train now" vs. standing "Retrain" split, model-size display,
> "Download model", and the "View clips" modal (the clip list is inline in
> the training panel, not a modal). The clip model keeps no per-video
> contribution record with a date. See sprint-change-proposal-2026-08-27.md.]`
> `[DELIVERED — trimmed]`

**§4.5 Description** — reword "surfaces the assign/commit split from 4.4" →
"surfaces clip assignment from 4.4"; drop "replacing a single irreversible
'approve' action".

**§4.5 "Out of Scope"** — keep (still accurate — playback flow preserved).

**UJ-3 prose (§2.2)** — rewrite to match: assign clips (not "assign speakers
without starting training"), no "commit both assignments together", "the
Voices view shows Picard with clips from both videos" (not "both contributing
videos listed").

**§7 SM-2** — reword "each contribution traceable in the UI" → "each source
video visible in the Voice's clip list". Drop the `FR-19` reference or point
it at the rewritten FR-19.

**§8 Open Questions** — mark all four resolved:
1. Phase 2 tool inventory — resolved: `copilot_tools.tsx` registers `addVideo`,
   `keepClips`, `discardClips`, `assignSpeaker`, `startTraining`, plus
   `useAgentContext` payloads and static `useConfigureSuggestions`.
2. Filesystem migration — resolved: one-time re-ingest, video-scoped
   `work/youtube/<video_id>`.
3. FR-20 dual trigger — resolved: both paths are permanent.
4. FR-10 rework against 4.5's UI — resolved: no rework story was needed; the
   frontend tool surface was built once against the shipped Videos/Voices UI.

**§9 Assumptions Index** — drop the FR-20 assumption line (now resolved in §8).

**New §4.6 — Multi-Agent A2A Network** and **§4.7 — Factory Is the Source of
Truth**, as first-class PRD feature sections matching the §4.1–4.5 structure
(Description + capability list + Out of Scope). Content mirrors Post-plan
Epic A / B in `epics.md` (see 4.2). Decided 2026-08-27.

### 4.2 `epics.md`

**Requirements Inventory** — apply the same FR16–27 rewrites as §4.1, plus:
- FR5 → append `[OUT OF SCOPE — 2026-08-27]`.
- FR17/18/19/22/26 → append `[SUPERSEDED 2026-08-27]` with the one-line reason.

**FR Coverage Map** — update each line's mechanism phrase; add:
```
FR5:  OUT OF SCOPE — no server-side tool loop to cap (2026-08-27)
```

**Epic 1 status** — add after the FRs/NFRs lines:
> `[DELIVERED 2026-08-27]` Shipped inside `spec-multi-agent-a2a`. FR1–4, 6,
> 7–11 satisfied by `agents/orchestrator/chat_agent.py` and
> `features/chat/copilot_tools.tsx`. FR5 out of scope.

**Epic 3 status** — add:
> `[DELIVERED 2026-08-27]` Shipped on a clip-based assignment model, not the
> run-based `assign`/`commit`/`voice_contributions` model these stories
> describe. Stories 3.1, 3.4, 3.6 delivered in substance; 3.2, 3.3, 3.5
> superseded at the mechanism level. See sprint-change-proposal-2026-08-27.md.

**Stories 3.2, 3.3, 3.5, 3.6** — prepend a `[SUPERSEDED / REVISED 2026-08-27]`
note to each, mirroring the 2026-08-16 note style, pointing at this proposal.
Do not rewrite the acceptance criteria line by line — the story is closed;
the note records why it does not match the code.

**New "Post-plan Epic A: Multi-Agent A2A Network" section** (delivered):
> Source: `spec-multi-agent-a2a` (never planned through `bmad-create-epics`;
> recorded here after the fact). An Orchestrator agent is the only agent the
> browser talks to; it routes each AG-UI request to a Research Agent or a
> Voice Agent over the A2A protocol, discovers their skills from published
> Agent Cards via ARD, and combines specialist results into one answer. A
> specialist being down degrades only its own capability. Every delegation is
> traceable in Langfuse.
> **Delivered:** `agents/{orchestrator,research,voice}/`, `core/ard_catalog.py`,
> `routes/ard.py`, `a2a_support/`. Tests: `test_orchestrator_agent.py`,
> `test_orchestrator_delegation.py`, `test_research_agent.py`,
> `test_voice_agent.py`, `test_ard.py`.
> `[DELIVERED 2026-08-27]`

**New "Post-plan Epic B: Factory Is the Source of Truth" section** (delivered):
> Source: `spec-factory-source-of-truth` (merged as PR #20). The voice factory
> host owns clip decisions; `pythonapi` stores run and voice state and nothing
> on disk. `[DELIVERED 2026-08-27]`

**New "Out of scope — shipped without a spec" list:**
> These landed in `main` and are recorded for completeness, not planned:
> - Postgres-backed clip storage (`voice_clips` table, `repositories/voice_clips.py`)
> - Clip trim / zoom range editor per clip (`clip_trim_bar.tsx`)
> - Per-clip transcription editing with auto-update
> - Collapsible dashboard panels
> - TLS for local / LAN via the nginx proxy (`infra/nginx/`)
> - Editable voice names (`editable_voice_name.tsx`, `PATCH /voices/{id}`)

### 4.3 `sprint-status.yaml`

```yaml
development_status:
  epic-1: done          # was: backlog
  1-1-...: done          # ... all six Epic 1 stories → done
  epic-1-retrospective: optional

  epic-2: done           # unchanged
  ...

  epic-3: done           # was: in-progress
  3-1-...: done           # was: review
  3-2-...: done           # was: review   (superseded — see note)
  3-3-...: done
  3-4-...: done
  3-5-...: done
  3-6-...: done
  epic-3-retrospective: optional

  post-plan-epic-a-multi-agent-a2a: done          # new — not in the original plan
  post-plan-epic-b-factory-source-of-truth: done  # new — not in the original plan
```
Append a dated comment block referencing this proposal, in the style of the
existing 2026-08-16 block.

### 4.4 Spec `SPEC.md` headers

Add one line under the `> **Canonical contract.**` blockquote of each:

| Spec | Line to add |
|---|---|
| `spec-agui-tool-loop` | `> **Status: DELIVERED (2026-08-27).** Lives in agents/orchestrator/chat_agent.py. FR5 (runaway cap) dropped as out of scope.` |
| `spec-copilotkit-hook-surface` | `> **Status: DELIVERED (2026-08-27).** features/chat/copilot_tools.tsx, CopilotKit v2 hooks.` |
| `spec-video-scoped-ingestion` | `> **Status: DELIVERED (2026-08-27).** Video-scoped work/youtube/<video_id> layout, gateway routes paired across repos.` |
| `spec-multi-voice-data-model` | `> **Status: SUPERSEDED (2026-08-27).** The run-based assign/commit/voice_contributions model here was replaced by a clip-based model. See sprint-change-proposal-2026-08-27.md.` |
| `spec-videos-and-voices-views` | `> **Status: SUPERSEDED IN PART (2026-08-27).** Views shipped as client tabs; assign/commit UI replaced by clip assignment. See sprint-change-proposal-2026-08-27.md.` |
| `spec-multi-agent-a2a` | `> **Status: DELIVERED (2026-08-27).** Never entered epics.md; recorded as Post-plan Epic A in the same proposal.` |
| `spec-factory-source-of-truth` | `> **Status: DELIVERED (2026-08-27).** Merged as PR #20; recorded as Post-plan Epic B.` |

The `spec-3-2-*` implementation artifacts already carry `status: done` /
superseded headers — leave them.

---

## 5. Implementation Handoff

**Scope: Moderate.** Requirement text and backlog realignment. No code, no
tests, no replan.

**Executed by:** the Correct Course session, in batch, after CodeSoup's
approval. All edits are to files under `_bmad-output/planning-artifacts/` and
`_bmad-output/specs/`.

**Not touched:** any file under `apps/`, any test, any `.memlog.md` history
file, `docs/`.

**Success criteria:**
- `prd.md` §4.4/§4.5 and FR-5 describe the shipped clip-based and A2A system;
  no reference to `voice_contributions`, `COMMITTED`, `POST /runs/{id}/assign`,
  `POST /runs/{id}/commit`, `discard`, or `approve_run` survives except in a
  dated `[SUPERSEDED]` note.
- `epics.md` records Epic 1 and Epic 3 as delivered, adds Epic 4 (A2A) and
  Epic 5 (factory source of truth), and lists the spec-less shipped features
  as out of scope.
- `sprint-status.yaml` shows every epic `done`.
- All seven `SPEC.md` files carry a status line.
- A reader who opens the planning artifacts and then the code finds them
  consistent.

---

## Open Decisions — for CodeSoup

1. **FR-27 model download / size.** — RESOLVED 2026-08-27. `voice_card.tsx`
   and `training_panel.tsx` have no "Download model", no model-size display,
   no "Retrain" (one "Start training" button only), no contributing-videos
   popover, no "View clips" modal. FR-27's rewrite drops all of them.
2. **PRD §4.6/§4.7 vs. appendix.** — RESOLVED 2026-08-27. New feature
   sections §4.6 (A2A) and §4.7 (factory source of truth).
3. **Epic naming.** — RESOLVED 2026-08-27. "Post-plan Epic A" (A2A) and
   "Post-plan Epic B" (factory source of truth), keeping Epics 1–3 as the
   original plan of record.
