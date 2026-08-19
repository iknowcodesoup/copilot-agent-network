---
title: 'Story 3.3: Trigger Training Explicitly or Automatically, Independent of Ingestion'
type: 'feature'
created: '2026-08-15'
status: 'done'
review_loop_iteration: 0
context: []
baseline_commit: '377fd6c2a4d1e5b45dd917fc552b83516aeac0ce'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `commit_run` (Story 3.2, `routes/voice.py`) writes `voice_contributions` rows but starts no training — the docstring says so explicitly. A `Voice` has no path from `AWAITING_COMMIT` to `TRAINING`, whether automatic or on-demand.

**Approach:** Add a `POST /voices/{id}/train` route, a `VoiceTrainingReconciler` + per-voice LangGraph mirroring `VoiceRunReconciler`/`voice_pipeline_graph.py`'s dual-driver design (interval sweep + `wake()` fast path, atomic lease claim), and call `training_reconciler.wake(voice_id)` from `commit_run` right after a voice's first contribution lands.

## Boundaries & Constraints

**Always:**
- New/changed persistence via SQLAlchemy 2.0 async, `Base.metadata.create_all`, no raw SQL (NFR4).
- Training runs on its own LangGraph, one per voice — a new `voice_training_graph.py`, not a modification of `voice_pipeline_graph.py` (FR21).
- `VoiceRow` gains `leased_until`/`lease_owner` columns and a `VoiceRepository.claim_voices`/`claim_voice`/`release_voice`/`update_voice` set, mirroring `repositories/voice_runs.py`'s `_claim_where`/`update_run` exactly (same atomic `UPDATE ... WHERE phase NOT IN RESTING AND lease free ... RETURNING`).
- `VoicePhase` gains a `RESTING_PHASES = frozenset({AWAITING_COMMIT, READY, FAILED})` module constant (mirrors `models/voice.py`'s existing one for `VoiceRunPhase`) — `TRAINING`/`EXPORTING` are the only claimable phases.
- Training's graph node calls `gateway.start_job(character=voice.name, stage=STAGE_TRAIN)`, matching `_training_node_factory`'s existing call shape — `voice.name` is the character key since `get_voice_by_name` already guarantees uniqueness.
- `commit_run` (`routes/voice.py`) calls `training_reconciler.wake(voice_id)` once per committed voice, after `create_contribution` — same synchronous-trigger shape as `retry_run`'s existing `reconciler.wake(run.id)`.
- `POST /voices/{id}/train` always sets `phase = TRAINING` and calls `wake(voice_id)`, whether or not a job is already running — mirrors "Retrain is always available" (epic context) rather than `approve_run`'s single-allowed-phase 409 guard. Reject only 404 unknown voice.
- New settings follow existing `VOICE_*` naming in `config.py`: `VOICE_TRAINING_RECONCILE_INTERVAL_SECONDS` (default `15.0`), `VOICE_TRAINING_LEASE_SECONDS` (default `60.0`) — real defaults, never bare `None`.
- Reconciler wiring in `main.py` follows the existing `VoiceRunReconciler` block exactly: constructed only `if app.state.voice_factory_gateway is not None`, `.start()`/`.shutdown()` lifecycle, `app.state.voice_training_reconciler = None` default.

**Ask First:** None expected.

**Never:**
- Do not modify `voice_pipeline_graph.py`'s existing nodes or `VoiceRunReconciler` — ingestion stays untouched (FR21).
- Do not add a `checkpoint_path`-writing EXPORTING→READY transition beyond what `_training_node_factory`/`_exporting_node_factory` already do for runs — mirror the same poll/advance/fail shape, do not redesign it.
- Do not touch `routes/voices.py`'s existing `create_voice`/`get_voice` handlers beyond adding the new route.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Auto-trigger, first contribution | `commit_run` creates a voice's first `voice_contributions` row | `training_reconciler.wake(voice_id)` called; voice claimable and advances to `TRAINING` | N/A |
| Explicit train, happy path | Voice exists, `AWAITING_COMMIT`; `POST /voices/{id}/train` | 202, `phase` → `TRAINING`, `wake(voice_id)` called | N/A |
| Explicit train, unknown voice | Voice id doesn't exist | Rejected, nothing started | 404 |
| Explicit train, already training | Voice `phase == TRAINING` | 202, retrain proceeds anyway (new job starts) | N/A |
| Claim race | Two API instances both wake the same voice | Only one claims via lease; the other's tick finds no claimable row | N/A |

</frozen-after-approval>

## Code Map

- `apps/pythonapi/pythonapi/core/voice_pipeline_graph.py:48-98,320-338` -- `VoiceRunState`/`_route_by_phase`/`_training_node_factory` shape to mirror in a new `voice_training_graph.py`; one node per `VoicePhase`, conditional entry routes to the current phase's node, every node edges to `END`.
- `apps/pythonapi/pythonapi/core/voice_factory_gateway.py:164-172` -- `start_job(**fields)`, already generic/stage-parameterized; no new gateway method needed. `STAGE_TRAIN`/`STAGE_EXPORT` constants at lines 54-63.
- `apps/pythonapi/pythonapi/workers/voice_run_reconciler.py` (whole file, 271 lines) -- `VoiceRunReconciler` to mirror as `VoiceTrainingReconciler` in a new `workers/voice_training_reconciler.py`: `__init__` (40-69), `start`/`shutdown` (70-78), `wake()` (80-87), `_loop`/`_wait_for_work` (99-114), `tick()` (125-138), `reconcile_run` (140-165, rename `reconcile_voice`), `_advance` (167-199, calls `graph.ainvoke`).
- `apps/pythonapi/pythonapi/repositories/voice_runs.py:284-337,349-356` -- `_claim_where`, `update_run`, `_resting_phase_values`, `_lease_is_free` to mirror in `repositories/voices.py` as `claim_voices`/`claim_voice`/`release_voice`/`update_voice`.
- `apps/pythonapi/pythonapi/models/orm.py:71-129` (`VoiceRunRow` lease columns `leased_until`/`lease_owner`, lines 125-126) and `131-151` (`VoiceRow`, add the same two columns).
- `apps/pythonapi/pythonapi/models/voices.py:15-26` -- `VoicePhase` enum (already has `AWAITING_COMMIT`/`TRAINING`/`EXPORTING`/`READY`/`FAILED`); add `RESTING_PHASES` constant alongside.
- `apps/pythonapi/pythonapi/models/voice.py:38` -- `RESTING_PHASES` precedent for `VoiceRunPhase` to copy the pattern from.
- `apps/pythonapi/pythonapi/repositories/voices.py:18-27` -- `VoiceRepository` Protocol; add `claim_voices`/`claim_voice`/`release_voice`/`update_voice` to Protocol + `InMemoryVoiceRepository` + `PostgresVoiceRepository`.
- `apps/pythonapi/pythonapi/repositories/voice_contributions.py:23-28` -- `list_contributions_for_voice`, already exists; used to detect "first contribution" if the graph's entry node needs a contribution-count check (it doesn't strictly need to — `commit_run` already knows it just created the first row).
- `apps/pythonapi/pythonapi/routes/voice.py:399-443` (`commit_run`) -- inject `get_required_voice_training_reconciler`, call `.wake(voice_id)` after each `create_contribution`.
- `apps/pythonapi/pythonapi/routes/voices.py:61-73` -- insert `POST /voices/{voice_id}/train` after `get_voice`, reusing `_load_voice` (24-28) for the 404.
- `apps/pythonapi/pythonapi/dependencies.py:95-129` -- `get_required_voice_repository`/`get_required_voice_run_reconciler`-style providers; add `get_required_voice_training_reconciler`.
- `apps/pythonapi/pythonapi/main.py:233-244` (repository wiring), `264-281` (`VoiceRunReconciler` construction/start/shutdown) -- mirror block for `VoiceTrainingReconciler`, guarded the same `if gateway is not None` way.
- `apps/pythonapi/pythonapi/config.py:47-56` -- `VOICE_RECONCILE_INTERVAL_SECONDS`/`VOICE_LEASE_SECONDS` precedent; add the two new `VOICE_TRAINING_*` settings beside them.
- `apps/pythonapi/tests/test_voice_assign_commit.py` -- fixture pattern (`make_voice`, in-memory repo fixtures, composed client override) to mirror in new `apps/pythonapi/tests/test_voices_train.py`.

## Tasks & Acceptance

**Execution:**
- [x] `models/voices.py` -- add `VoicePhase.RESTING_PHASES` -- claim-guard constant (FR21)
- [x] `models/orm.py` -- add `leased_until`/`lease_owner` to `VoiceRow` -- lease columns for claim-based reconciling
- [x] `repositories/voices.py` -- add `claim_voices`, `claim_voice`, `release_voice`, `update_voice` to Protocol + both implementations -- mirrors `voice_runs.py`'s claim/update shape (FR20, FR21)
- [x] `core/voice_training_graph.py` (new) -- `VoiceTrainingState`, `build_voice_training_graph(gateway)`, node(s) for `TRAINING`/`EXPORTING` calling `gateway.start_job(character=voice.name, stage=...)` and polling -- the per-voice training LangGraph (FR21)
- [x] `workers/voice_training_reconciler.py` (new) -- `VoiceTrainingReconciler` (`wake`, `tick`, `_advance`, lease claim, interval loop) -- mirrors `VoiceRunReconciler` (FR20, FR21)
- [x] `routes/voice.py` -- `commit_run` calls `training_reconciler.wake(voice_id)` per committed voice -- automatic trigger on first contribution (FR20)
- [x] `routes/voices.py` -- `POST /voices/{voice_id}/train`: 404 unknown voice, else `phase = TRAINING` + `wake(voice_id)`, 202 -- explicit trigger (FR20)
- [x] `dependencies.py` -- `get_required_voice_training_reconciler` -- DI provider
- [x] `main.py` -- construct/start/shutdown `VoiceTrainingReconciler`, wire into `commit_run`'s and the new route's dependencies -- app assembly
- [x] `config.py` -- `VOICE_TRAINING_RECONCILE_INTERVAL_SECONDS`, `VOICE_TRAINING_LEASE_SECONDS` -- settings
- [x] `tests/test_voices_train.py` (new) -- cover all five I/O matrix rows, plus a graph-level test that the training node calls `gateway.start_job` with `stage=STAGE_TRAIN`

**Acceptance Criteria:**
- Given a voice receives its first contribution via `commit_run`, when the commit completes, then the training reconciler is woken and the voice advances toward `TRAINING` (FR20)
- Given a voice already has contributions, when `POST /voices/{id}/train` is called, then training starts regardless of current phase (FR20)
- Given ingestion and training both run, when either advances, then each does so through its own LangGraph with no shared node code (FR21)

## Spec Change Log

## Design Notes

**Why lease/claim on `VoiceRow` instead of a simpler "is any job running" flag?** Multiple API instances can run at once (documented constraint, `voice_runs` already solves this the same way). Reusing the proven claim pattern avoids inventing a second concurrency primitive for a symmetrical problem.

**Why `wake()` from `commit_run` instead of the reconciler discovering new contributions on its own?** Every existing state-changing route in this codebase (`retry_run`, the factory webhook) calls `wake()` directly; the interval sweep is documented everywhere as the backstop, not the primary driver. Matching that keeps one trigger idiom in the codebase instead of two.

## Verification

**Commands:**
- Hand off to `litert-subagent`: `nx test pythonapi` -- expected: full suite passes, including new `test_voices_train.py`, with `test_voice.py`/`test_voices.py`/`test_voice_assign_commit.py` unaffected
- `nx run pythonapi:format` -- expected: clean
- `nx lint pythonapi` -- expected: no new violations

## Suggested Review Order

**Automatic trigger: commit wakes training**

- The docstring states the new contract plainly: commit flips a voice out of `AWAITING_COMMIT` and wakes training, without a factory this is a no-op.
  [`voice.py:412`](../../apps/pythonapi/pythonapi/routes/voice.py#L412)

- One phase flip and one wake per distinct voice, deduplicated across multiple speakers mapping to the same voice.
  [`voice.py:453`](../../apps/pythonapi/pythonapi/routes/voice.py#L453)

**Explicit trigger: retrain on demand**

- Retrain is always allowed regardless of current phase — no 409 guard, unlike `approve_run`'s single-phase pattern.
  [`voices.py:88`](../../apps/pythonapi/pythonapi/routes/voices.py#L88)

**Independent LangGraph for training**

- Entry point for the design: one node per phase, conditional routing, every node edges to `END` — same shape as ingestion, zero shared code.
  [`voice_training_graph.py:51`](../../apps/pythonapi/pythonapi/core/voice_training_graph.py#L51)

- Training node starts the factory job keyed by `voice.name`, since voice names are already unique.
  [`voice_training_graph.py:127`](../../apps/pythonapi/pythonapi/core/voice_training_graph.py#L127)

**Concurrency: claim/lease machinery for voices**

- The atomic `UPDATE ... RETURNING` that gives the database sole authority over who claims a voice.
  [`voices.py:328`](../../apps/pythonapi/pythonapi/repositories/voices.py#L328)

- `RESTING_PHASES` defines which phases are claimable — `TRAINING`/`EXPORTING` only.
  [`voices.py:30`](../../apps/pythonapi/pythonapi/models/voices.py#L30)

**Reconciler: wake/tick dual-driver loop**

- `wake()` is the fast path a route calls; the interval timer is the backstop.
  [`voice_training_reconciler.py:80`](../../apps/pythonapi/pythonapi/workers/voice_training_reconciler.py#L80)

- `_advance` calls the graph and interprets `transient_error`/`changed`/failure into a persist — the reconciler's core decision point.
  [`voice_training_reconciler.py:135`](../../apps/pythonapi/pythonapi/workers/voice_training_reconciler.py#L135)

**App wiring**

- Reconciler constructed and started only when a voice factory is configured, mirroring the existing ingestion reconciler's guard.
  [`main.py:279`](../../apps/pythonapi/pythonapi/main.py#L279)

**Peripherals**

- New lease columns and `voyicer_job_id` on `VoiceRow`.
  [`orm.py:150`](../../apps/pythonapi/pythonapi/models/orm.py#L150)

- New settings, same naming convention as the existing ingestion reconciler's knobs.
  [`config.py:70`](../../apps/pythonapi/pythonapi/config.py#L70)

- Full test coverage of the I/O matrix: auto-trigger, explicit trigger, 404, always-retrainable, claim race.
  [`test_voices_train.py:1`](../../apps/pythonapi/tests/test_voices_train.py#L1)
