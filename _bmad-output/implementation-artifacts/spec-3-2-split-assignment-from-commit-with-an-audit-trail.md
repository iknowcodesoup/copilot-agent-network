---
title: 'Story 3.2: Split Assignment From Commit, With an Audit Trail'
type: 'feature'
created: '2026-08-15'
status: 'in-progress'
review_loop_iteration: 0
context: []
baseline_commit: 'ce64368cecbae25fd8798d79e9b4bf41a5d2dba6'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The only existing way to route a run's speakers to a destination is `approve_run` (`routes/voice.py:306`), which conflates "assign speakers" and "start the commit/train pipeline" into one call, and it assigns to a bare character-name string, not a Voice entity (Story 3.1). There is no record of which video contributed which speaker to which voice.

**Approach:** Add two new run-scoped routes — `POST /voice/runs/{run_id}/assign` (stores a speaker→voice mapping, does not touch the run's phase) and `POST /voice/runs/{run_id}/commit` (turns that mapping into immutable `voice_contributions` rows and advances the run to a new terminal `COMMITTED` phase) — plus the `voice_contributions` table and its repository. `GET /voices/{id}` (Story 3.1) starts returning real contributions instead of always `[]`.

## Boundaries & Constraints

**Always:**
- New persistence via SQLAlchemy 2.0 async, `Base.metadata.create_all`, no raw SQL, no Alembic (NFR4).
- `VoiceContributionRepository` follows the established shape: `Protocol` + `InMemoryVoiceContributionRepository` + `PostgresVoiceContributionRepository`, one `AsyncSession(self._engine)` per method.
- `voice_contributions` is append-only: no update method, only `create_contribution` and read queries.
- The new routes live in `routes/voice.py`, sibling to `approve_run`/`retry_run`, under the existing `/voice/runs/{run_id}/...` path family (not a new top-level router) — matches every other run-scoped action already there.
- Assign and commit both require the run to be `AWAITING_REVIEW` (404 if the run doesn't exist, 409 otherwise) — mirrors `approve_run`'s existing guard.
- Assign is a full replace of the run's stored assignment (mirrors `approve_run`'s `run.speaker_map = assignment.speaker_map` — whole-map replace, not merge), so it can be called more than once before commit.
- Neither route calls `VoiceFactoryGateway` — no factory/network call. Assign and commit are DB-only; wiring a voice's clips into an actual training run is Story 3.3's job, triggered off the contribution rows this story creates.

**Ask First:** None expected.

**Never:**
- Do not rename `VoiceRunRow.phase`/`VoiceRun.phase` to `ingest_phase`. FR17's "tracked separately" is already true structurally (separate columns on separate tables — `VoiceRunRow.phase` vs. `VoiceRow.phase`); a column rename would touch ~10 files (`voice_pipeline_graph.py`, `voice_run_reconciler.py`, every route and test referencing `.phase`) for no behavioral gain. Add `COMMITTED` as a new value on the existing `VoiceRunPhase` enum instead.
- Do not modify or remove `approve_run`, `retry_run`, or the legacy character-scoped `POST /voice/commit` (Epic 2) — they stay as-is, untouched by this story.
- Do not trigger training, call `gateway.start_job`, or touch `voice_pipeline_graph.py`'s node graph — Story 3.3.
- Do not implement "Discard" (reset to `AWAITING_REVIEW`) — that's a Story 3.5 UI action with no new backend route implied by its AC.
- Commit must not run when nothing was assigned — no contribution rows from an empty assignment.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Assign, happy path | Run in `AWAITING_REVIEW`, 2+ voices exist; `POST .../assign {"assignments": {"SPEAKER_00": "<voice_id>"}}` | 200, `run.voice_assignments` stored, `run.phase` unchanged | N/A |
| Assign, unknown voice | `assignments` references a voice id that doesn't exist | Rejected, nothing stored | 404 |
| Assign, wrong phase | Run in `DOWNLOADING`/`DIARIZING`/`COMMITTED`/etc. | Rejected | 409 |
| Commit, happy path | Run `AWAITING_REVIEW` with a prior assignment `{"SPEAKER_00": voice_id}` | 201, one `voice_contributions` row per assigned (non-null) speaker, `run.phase` → `COMMITTED` | N/A |
| Commit, nothing assigned | Run `AWAITING_REVIEW`, `run.voice_assignments` empty | Rejected, no rows created | 400 |
| Commit, wrong phase | Run not `AWAITING_REVIEW` | Rejected | 409 |
| Fetch voice after commit | `GET /voices/{voice_id}` for a voice with contributions | 200, `contributions` lists the real rows (video id/title, speaker label, run id, created_at) | N/A |

</frozen-after-approval>

## Code Map

- `apps/pythonapi/pythonapi/routes/voice.py:306-341` -- `approve_run`, the closest existing analog (phase guard, `_load_run`, `update_run`) to mirror for the two new handlers; insert them directly after (new code starts at line 343).
- `apps/pythonapi/pythonapi/models/voice.py:14-36` -- `VoiceRunPhase` enum (add `COMMITTED = "committed"`) and `RESTING_PHASES` (add `VoiceRunPhase.COMMITTED` — a committed run needs no further reconciling, same reasoning as `READY`/`FAILED`).
- `apps/pythonapi/pythonapi/models/voice.py:93-141` -- `VoiceRun`; add `voice_assignments: dict[str, str | None] = Field(default_factory=dict)` (speaker_label → voice_id, parallel to but distinct from the existing character-keyed `speaker_map` at line 110).
- `apps/pythonapi/pythonapi/models/orm.py:71-126` -- `VoiceRunRow`; add `voice_assignments: Mapped[dict] = mapped_column(JSONB, default=dict)`, same style as `speaker_map` (line 96).
- `apps/pythonapi/pythonapi/models/orm.py:129-150` -- `VoiceRow`; no field changes, just the join target for the new table below.
- `apps/pythonapi/pythonapi/models/orm.py` (new class) -- `VoiceContributionRow(Base)`: string PK, `voice_id`/`run_id` as `ForeignKey` columns (mirror `ChunkRow.document_id`, `orm.py:37-39`, the only existing FK example), `speaker_label: Mapped[str]`, `created_at` only (append-only, no `updated_at`), `Index` on `voice_id` and on `run_id`, unique constraint on `(voice_id, run_id, speaker_label)`.
- `apps/pythonapi/pythonapi/models/voices.py:35-48` -- `Voice`; change `contributions: list` to `contributions: list[VoiceContribution] = Field(default_factory=list)` (currently untyped and always empty per Story 3.1's documented boundary).
- `apps/pythonapi/pythonapi/models/voices.py` -- add `VoiceContribution` (id, voice_id, run_id, video_id, video_title, speaker_label, created_at), `RunAssignRequest` (`assignments: dict[str, str | None]`), `RunAssignResponse` (run_id, voice_assignments), `RunCommitResponse` (`contributions: list[VoiceContribution]`) — named with a `Run`/`VoiceContribution` prefix to avoid colliding with `models/voice.py`'s existing `CommitRequest`/`CommitResponse` (Epic 2, character-scoped, unrelated).
- `apps/pythonapi/pythonapi/repositories/voices.py:18-27,74-93` -- `VoiceRepository` Protocol and `_row_from_voice`/`_voice_from_row` converters; `get_voice_by_name` already satisfies FR22's "fetch by name" — no change needed there.
- `apps/pythonapi/pythonapi/repositories/voice_runs.py:309-337,359-416` -- `update_run`, `_row_from_run`, `_run_from_row`; add `voice_assignments` to each mapping, same pattern as `speaker_map`.
- `apps/pythonapi/pythonapi/repositories/voice_contributions.py` (new) -- `VoiceContributionRepository(Protocol)`: `create_contribution(contribution) -> None`, `list_contributions_for_voice(voice_id) -> list[VoiceContribution]` (join `VoiceContributionRow` to `VoiceRunRow` for `video_id`/`video_title`). Mirror `repositories/voices.py`'s three-class shape exactly.
- `apps/pythonapi/pythonapi/routes/voices.py:57-62` -- `get_voice`; after loading the voice, call `VoiceContributionRepository.list_contributions_for_voice(voice_id)` and set it on the returned `Voice` instead of leaving `contributions` empty.
- `apps/pythonapi/pythonapi/dependencies.py:95-97` -- `get_required_voice_run_repository`/`get_required_voice_repository` (no-guard style); add `get_required_voice_contribution_repository` alongside.
- `apps/pythonapi/pythonapi/main.py:63-75` (imports), `217-221` (repository wiring), `295-301` (router registration, already includes `voice.router` and `voices.router`) -- wire `app.state.voice_contribution_repository` unconditionally on `postgres_engine`, same pattern as `voice_repository`. No new router to register (routes land in the existing `voice.router`).

## Tasks & Acceptance

**Execution:**
- [ ] `models/voice.py` -- add `VoiceRunPhase.COMMITTED`, add it to `RESTING_PHASES`, add `VoiceRun.voice_assignments` -- new terminal phase + assignment storage
- [ ] `models/orm.py` -- add `VoiceRunRow.voice_assignments`; add `VoiceContributionRow` (FKs to `voices`/`voice_runs`, unique `(voice_id, run_id, speaker_label)`) -- schema for the audit trail (FR19)
- [ ] `models/voices.py` -- type `Voice.contributions` as `list[VoiceContribution]`; add `VoiceContribution`, `RunAssignRequest`, `RunAssignResponse`, `RunCommitResponse` -- request/response + contribution schema
- [ ] `repositories/voice_runs.py` -- map `voice_assignments` through `update_run`, `_row_from_run`, `_run_from_row` -- persist the new field
- [ ] `repositories/voice_contributions.py` (new) -- `VoiceContributionRepository` Protocol + `InMemoryVoiceContributionRepository` + `PostgresVoiceContributionRepository` (`create_contribution`, `list_contributions_for_voice` joined to run for video id/title) -- storage layer (FR19, FR22)
- [ ] `routes/voice.py` -- `POST /runs/{run_id}/assign` (404 unknown run, 409 wrong phase, 404 unknown voice id, full-replace `voice_assignments`) and `POST /runs/{run_id}/commit` (404/409 same guards, 400 empty assignment, create one contribution per non-null assignment, set `phase = COMMITTED`) -- the two required routes (FR17, FR18, FR19)
- [ ] `routes/voices.py` -- `get_voice` populates `contributions` from `VoiceContributionRepository` instead of leaving it empty -- closes the loop FR16 left open in Story 3.1
- [ ] `dependencies.py` -- `get_required_voice_contribution_repository` -- DI provider
- [ ] `main.py` -- import + wire `voice_contribution_repository` -- app assembly
- [ ] `tests/test_voice.py` or new `tests/test_voice_assign_commit.py` -- cover all seven I/O matrix rows

**Acceptance Criteria:**
- Given a run in `AWAITING_REVIEW` and two voices exist, when `POST /voice/runs/{id}/assign` maps a speaker to each, then both are stored on the run and `phase` is unchanged (FR17, FR18)
- Given a prior assignment exists, when `POST /voice/runs/{id}/commit` is called, then exactly one `voice_contributions` row is created per assigned (non-null) speaker and `phase` advances to `COMMITTED` (FR18, FR19)
- Given contributions exist for a voice, when `GET /voices/{id}` is called, then the response's `contributions` lists them, each traceable to its run and video (FR22)

## Spec Change Log

## Design Notes

**Why `/voice/runs/{run_id}/assign` and not a bare `/runs/{id}/assign`?** The epics.md FR text writes the short form, but no top-level `/runs` router exists — every run-scoped action (`approve`, `retry`, clips, logs) already lives under `voice.router`'s `/voice/runs/{run_id}/...` prefix. Adding a second router for just these two routes would fragment one resource across two path families for no benefit; this reads the FR text as shorthand for the existing namespace.

**Why a separate `voice_assignments` field instead of reusing `speaker_map`?** `speaker_map` is keyed to character-name strings and is pushed straight to the voice factory host via `gateway.set_speaker_map` (`routes/voice.py:331`) as part of the legacy `approve_run` flow. This story's assignment is Voice-ID-scoped and DB-only — conflating the two would mean either breaking the legacy flow's shape or overloading one field with two incompatible value types.

## Verification

**Commands:**
- Hand off to `litert-subagent`: `nx test pythonapi` -- expected: full suite passes, including new tests for all seven I/O matrix rows, with the existing `test_voice.py`/`test_voices.py` suites unaffected
- `nx run pythonapi:format` -- expected: clean
- `nx lint pythonapi` -- expected: no new violations
