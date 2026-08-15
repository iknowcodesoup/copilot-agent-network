---
title: 'Story 3.1: Create the Durable Voice Entity'
type: 'feature'
created: '2026-08-15'
status: 'in-progress'
review_loop_iteration: 0
context: []
baseline_commit: '546f5cd201a451e9d06f02974b9bded0e8f48f52'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A Voice today only exists implicitly as a `primary_character` string on a `voice_run` row, so training data from a second video can't be routed to the same voice as a durable, queryable entity. FR16 requires a `voices` table with its own identity and phase, created via `POST /voices` and fetched via `GET /voices/{id}`.

**Approach:** Add a new `voices` table, Pydantic schema, repository (Protocol + in-memory + Postgres, mirroring `voice_runs.py`), and two routes. Move the one genuinely orphaned training column (`checkpoint_path`, which has no write path today) off `voice_runs` onto `voices`, satisfying NFR4's "training-related columns move to voices" for the part that's safe to move without a voice-run association yet.

## Boundaries & Constraints

**Always:**
- All new persistence is SQLAlchemy 2.0 async via `Base.metadata.create_all` — no raw SQL, no Alembic (NFR4).
- `VoiceRepository` follows the `voice_runs.py` shape exactly: a `Protocol`, an `InMemoryVoiceRepository` test double, and a `PostgresVoiceRepository` that opens one `AsyncSession(self._engine)` per method (not a shared/injected session).
- Voice `name` is unique — the combobox (Story 3.5) and "fetch by name" (FR22) both depend on names uniquely identifying a voice.
- `app.state.voice_repository` is wired unconditionally on `postgres_engine` (Postgres if configured, else in-memory) — not gated behind `voice_factory_gateway`/`VOICE_FACTORY_URL`, mirroring `voice_run_repository` (`main.py:217-221`). Creating a voice must work even without the factory configured.
- New route module stays async throughout (NFR1).

**Ask First:** None expected — this story is additive except for the one documented column removal below.

**Never:**
- Do not rename `voice_runs.phase` to `ingest_phase` or narrow its enum in this story. That rename is meaningful only once Story 3.2's `assign`/`commit` routes exist to replace the current `COMMITTING` control flow — doing it now would leave `VoiceRunReconciler` and `voice_pipeline_graph.py` referencing phases with no coherent replacement.
- Do not move `current_epoch`/`current_loss` off `voice_runs` in this story. `record_progress` (the webhook's only write path for them) has no `voice_id` to target until Story 3.2's assign step exists — moving them now breaks the webhook with nothing to replace it.
- Do not build `voice_contributions`, the assign/commit routes, or any training trigger — Stories 3.2 and 3.3.
- `GET /voices/{id}` returns `contributions: []` always in this story — no contribution data exists yet to query.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Create voice | `POST /voices {"name": "Picard"}`, no existing voice named "Picard" | 201, new `voices` row: generated id, phase=`AWAITING_COMMIT`, checkpoint_path=None | N/A |
| Duplicate name | `POST /voices {"name": "Picard"}` when a voice named "Picard" already exists | Rejected, no row created | 409 Conflict |
| Fetch existing | `GET /voices/{id}` for an id that exists | 200, Voice body with `contributions: []` | N/A |
| Fetch missing | `GET /voices/{id}` for an unknown id | Not found | 404, matching `routes/voice.py`'s `_load_run` pattern |

</frozen-after-approval>

## Code Map

- `apps/pythonapi/pythonapi/models/orm.py:71-127` -- `VoiceRunRow`; remove `checkpoint_path` (line 108); add new `VoiceRow(Base)` below it in the same style (string PK, `Index("idx_voices_phase", "phase")`, unique index on `name`, `server_default=func.now()` timestamps).
- `apps/pythonapi/pythonapi/models/voice.py:14-29,93-141` -- `VoiceRunPhase` enum and `VoiceRun` model to mirror; remove `checkpoint_path` from `VoiceRun` (line 118).
- `apps/pythonapi/pythonapi/models/voices.py` (new) -- `VoicePhase(StrEnum)` (`AWAITING_COMMIT`, `TRAINING`, `EXPORTING`, `READY`, `FAILED`, per epic-3-context), `Voice`, `VoiceRequest`, `VoiceResponse` — mirror `models/orders.py`'s minimal Request/Status pairing.
- `apps/pythonapi/pythonapi/repositories/voice_runs.py` -- pattern to mirror in full: `Protocol` (35-82), `InMemoryVoiceRunRepository` (85-181), `PostgresVoiceRunRepository` (183-347), module-level `_row_from_run`/`_run_from_row` converters (359-416). Remove `checkpoint_path` from `update_run` (326), `_row_from_run` (375), `_run_from_row` (405).
- `apps/pythonapi/pythonapi/repositories/orders.py` -- simplest repo template (few methods, same three-class shape).
- `apps/pythonapi/pythonapi/repositories/voices.py` (new) -- `VoiceRepository(Protocol)`: `create_voice`, `get_voice`, `get_voice_by_name`.
- `apps/pythonapi/pythonapi/routes/voice.py:79-83,215-220` -- `_load_run` 404-helper pattern to mirror as `_load_voice`.
- `apps/pythonapi/pythonapi/routes/orders.py` -- simplest route template (`APIRouter(prefix=...)`, `Depends`, `response_model`, `status_code`).
- `apps/pythonapi/pythonapi/routes/voices.py` (new) -- `POST ""`, `GET "/{voice_id}"`.
- `apps/pythonapi/pythonapi/dependencies.py:95-97` -- `get_required_voice_run_repository` (no-guard style); add `get_required_voice_repository` right after.
- `apps/pythonapi/pythonapi/main.py:63-75` (imports), `217-221` (repository wiring), `295-301` (router registration) -- wire the new repository and router the same way `voice_run_repository`/`voice.router` are wired.
- `apps/pythonapi/pythonapi/core/voice_pipeline_graph.py:353` -- `_exporting_node_factory` reads `run.checkpoint_path`; change to a literal `None` (the field it read was already always unset — no code ever wrote it).
- `apps/pythonapi/tests/test_voice.py:1-50` -- app-import/TestClient conventions to mirror in a new `tests/test_voices.py`.

## Tasks & Acceptance

**Execution:**
- [x] `models/orm.py` -- remove `VoiceRunRow.checkpoint_path`; add `VoiceRow` -- new entity + column trim (FR16, NFR4)
- [x] `models/voices.py` (new) -- `VoicePhase`, `Voice`, `VoiceRequest`, `VoiceResponse` -- schema for the new entity (FR16)
- [x] `models/voice.py` -- remove `checkpoint_path` from `VoiceRun` -- matches the ORM trim
- [x] `repositories/voices.py` (new) -- `VoiceRepository` Protocol + `InMemoryVoiceRepository` + `PostgresVoiceRepository` (`create_voice`, `get_voice`, `get_voice_by_name`) -- storage layer (FR16)
- [x] `repositories/voice_runs.py` -- drop `checkpoint_path` from `update_run`, `_row_from_run`, `_run_from_row` -- column no longer exists
- [x] `routes/voices.py` (new) -- `POST /voices` (409 on duplicate name via `get_voice_by_name`), `GET /voices/{id}` (404 via `_load_voice`, `contributions: []`) -- the two required routes (FR16)
- [x] `dependencies.py` -- `get_required_voice_repository` -- DI provider
- [x] `main.py` -- import + wire `voice_repository` (unconditional on `postgres_engine`) + register `voices.router` -- app assembly
- [x] `core/voice_pipeline_graph.py:353` -- `checkpoint=run.checkpoint_path` → `checkpoint=None` -- column removed, value was already always `None`
- [x] `tests/test_voices.py` (new) -- cover all four I/O matrix rows -- new behavior needs coverage

**Acceptance Criteria:**
- Given no voice exists named "Picard", when `POST /voices {"name": "Picard"}` is called, then a `voices` row is created with a generated id, `phase=AWAITING_COMMIT`, `checkpoint_path=None` (FR16)
- Given a voice already exists named "Picard", when `POST /voices {"name": "Picard"}` is called again, then it is rejected with 409 and no second row is created
- Given a voice exists, when `GET /voices/{id}` is called, then it returns the voice with `contributions: []` (FR16)
- Given no voice exists with a given id, when `GET /voices/{id}` is called, then it returns 404
- Given the schema change lands, when the app starts against a fresh dev database, then `voice_runs` no longer has a `checkpoint_path` column and the app boots and serves existing voice-run routes without error (NFR4)

## Spec Change Log

## Design Notes

**Why not move `current_epoch`/`current_loss` too, since NFR4's own text says "training-related columns move to voices"?** Both are written by exactly one path, `VoiceRunRepository.record_progress`, called from the factory's training webhook using only a `run_id`. There is no `voice_id` to write those values onto until Story 3.2 gives a run an assigned voice. Moving them now means either stranding the webhook (no-op) or inventing an assign step early — out of order with the epic's own dependency chain (3.1 → 3.2 → 3.3). `checkpoint_path` is different: grep confirms zero write sites anywhere in the app (only one read, in the exporting node, of a value nothing ever set) — moving it is a pure rename with no behavior at stake.

**Why 409 on duplicate name, when the epics.md AC doesn't test it?** FR22 (Story 3.2) requires "fetch a voice by name," and FR25's combobox is search-or-create — both only make sense if a name uniquely identifies one voice. Enforcing it now avoids a silent data-integrity gap Story 3.2 would otherwise inherit.

## Verification

**Commands:**
- Hand off to `litert-subagent` per this repo's standing rule: `nx test pythonapi` -- expected: full suite passes including new `tests/test_voices.py`, and the existing `tests/test_voice.py` suite still passes unchanged (confirms the `checkpoint_path` removal didn't break anything else)
- `nx run pythonapi:format` -- expected: clean, no diffs
- `nx lint pythonapi` -- expected: no new violations
