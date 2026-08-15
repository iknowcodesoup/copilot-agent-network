---
title: 'Skip Redundant Preprocessing'
type: 'feature'
created: '2026-08-14'
status: 'done'
review_loop_iteration: 1
context:
  - '{project-root}/_bmad-output/specs/spec-video-scoped-ingestion/implementation-plan.md'
baseline_commit: 'eac21681e3b9f4e006bb2727b8dc385c6e9d5564'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `stage_preprocess` only checks whether `training/config.json` exists, so it never regenerates the training config after new clips land in a character's dataset. Today an operator works around this by deleting the file by hand.

**Approach:** Compare a small sidecar fingerprint (clip count plus a hash of `resampled/metadata.csv` — the actual input `piper_train.preprocess` consumes, not `dataset/metadata.csv`) written by this stage against that input's current state. Regenerate `training/config.json` when they differ; skip when they match.

## Boundaries & Constraints

**Always:**
- The regenerate/skip decision reads local files only (`resampled/metadata.csv`, the sidecar) — no network or Docker call needed to decide. It fingerprints `resampled/`, not `dataset/`, because `stage_resample` and `stage_preprocess` are independently runnable stages (`main.py` `STAGES`) — fingerprinting `dataset/` would misdetect "new clips" that haven't actually reached preprocessing's real input yet.
- Write the sidecar only after `run_docker(...)` succeeds, so an interrupted or failed preprocess run is retried next time, not mistaken for up to date.
- Skip only when BOTH `training/config.json` exists AND the sidecar fingerprint matches the current dataset — a partially-cleared `training/` directory must always regenerate, not silently stay stale.
- All changes land in `star-trek-voyicer` only. No `copilot_agent_network` change is needed: `voice_factory_gateway.py`'s `STAGE_PREPROCESS` already reaches this stage generically via `gateway.start_job`.

**Ask First:** If `piper_train.preprocess`'s own output already includes a dataset manifest or fingerprint this stage could reuse instead of writing a new sidecar, ask before duplicating it.

**Never:**
- Do not change `stage_resample` (`main.py:481-489`) — it always reruns by design; out of scope.
- Do not change `run_docker`'s preprocess arguments (`main.py:496-511`).
- Do not add a database-backed freshness tracker — stay filesystem-only, matching `committed.csv` and `speaker_map.json`'s existing pattern.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| New clips resampled | `resampled/metadata.csv` fingerprint differs from the sidecar (or no sidecar yet) | Runs `piper_train.preprocess`, regenerates `config.json`, writes a fresh sidecar (FR15) | N/A |
| No new clips | Fingerprint matches the sidecar and `config.json` exists | Prints a skip message, no Docker call, sidecar unchanged (FR15) | N/A |
| New clips landed but not yet resampled | `dataset/metadata.csv` changed but `--stage resample` has not rerun, so `resampled/metadata.csv` is unchanged | Fingerprint still matches the sidecar — skip. Nothing new was actually fed to preprocess, so skipping is correct; the operator must rerun `--stage resample` first for the new clips to be picked up | N/A |
| Sidecar present, `config.json` missing | `training/` was partially cleared by hand | Treated as stale — regenerates as if the fingerprint mismatched | N/A |
| First-ever preprocess for a character | No `training/` dir, no sidecar | Runs preprocess, writes the fingerprint sidecar for the first time | N/A |
| `dataset/resampled/metadata.csv` missing | Character has no resampled data yet (never ran `--stage resample`) | Raises a clear, readable error naming the missing file and the required stage — never an unhandled `FileNotFoundError` | Readable error, no Docker call |
| Sidecar file exists but is not valid JSON | A prior `_write_sidecar` was interrupted (crash, disk full, kill mid-write) | Treated as no sidecar present — regenerates rather than raising | N/A |

</frozen-after-approval>

## Code Map

- `star-trek-voyicer/apps/jeanlucrecord/main.py:491-511` `stage_preprocess(character)` -- replace the presence-only skip (lines 493-495) with a fingerprint comparison against `resampled/`, not `dataset/`; write the sidecar after `run_docker` succeeds; print a message on the regenerate path too, not only on skip.
- `star-trek-voyicer/apps/jeanlucrecord/main.py:485` (inside `stage_resample`) -- the existing `resampled_dir = APP_DIR / "work" / character / "resampled"` construction; mirror this exact path in `stage_preprocess` rather than introducing a second helper. Do not edit `stage_resample` itself.
- `star-trek-voyicer/apps/jeanlucrecord/main.py:159` `run_docker(...)` -- existing call this stage already makes; wrap it, do not change its arguments.
- `star-trek-voyicer/apps/jeanlucrecord/main.py:1-7` -- add `import hashlib` and `import json` next to the existing stdlib imports.
- New pure helpers near `stage_preprocess`: `_metadata_fingerprint(directory: Path) -> dict` (clip count + SHA-256 of `directory/metadata.csv`; raise a clear, readable error -- e.g. `SystemExit` with a message naming the missing file and `--stage resample` -- if `metadata.csv` is absent, matching the file's existing precondition-error pattern such as `stage_youtube_commit`'s "No ingested YouTube videos found"), `_load_sidecar(training_dir: Path) -> dict | None` (return `None` on missing file AND on `json.JSONDecodeError` -- a corrupt sidecar must be treated as absent, not raise), `_write_sidecar(training_dir: Path, fingerprint: dict) -> None`. All three Path-parameterized so tests don't need to patch `APP_DIR`.
- `star-trek-voyicer/apps/jeanlucrecord/tests/test_main.py` -- new file. No existing test targets `stage_preprocess` (`tests/test_review.py` and `tests/test_api.py` cover `commit_reviewed_clips` and the HTTP layer only). Reuse `tests/conftest.py`'s existing `sys.path` pattern rather than duplicating the insert inline.
- `_bmad-output/specs/spec-video-scoped-ingestion/implementation-plan.md:10` -- the design decision (CAP-4) this story implements. Note for anyone reading that companion doc later: it names `dataset/metadata.csv` as the hash source; this spec's Round-1 review found that wrong (see Spec Change Log) and this spec's Approach is the corrected version.

## Tasks & Acceptance

**Execution:**
- [x] `star-trek-voyicer/apps/jeanlucrecord/main.py` -- add `_metadata_fingerprint(directory)` returning `{clip_count, metadata_hash}` from `directory/metadata.csv`, raising a readable error if the file is missing -- pure comparison basis for both AC's
- [x] `star-trek-voyicer/apps/jeanlucrecord/main.py` -- add `_load_sidecar`/`_write_sidecar` for `training/dataset-fingerprint.json`, with `_load_sidecar` treating a missing OR corrupt (invalid JSON) sidecar identically as "no sidecar" -- persists the last-preprocessed fingerprint without becoming a new crash surface
- [x] `star-trek-voyicer/apps/jeanlucrecord/main.py:491-511` `stage_preprocess` -- fingerprint `resampled/metadata.csv` (not `dataset/metadata.csv`); skip only when `config.json` exists AND the sidecar matches; otherwise run `run_docker(...)`, print that it's regenerating, then write the new sidecar -- delivers both AC's without the stale-resampled-data gap
- [x] `star-trek-voyicer/apps/jeanlucrecord/tests/test_main.py` -- new file; unit-test `_metadata_fingerprint` and the skip/regenerate decision directly; one test monkeypatching `run_docker` to assert it is NOT called when the fingerprint matches; one test proving new clips in `dataset/` alone (without updating `resampled/`) do NOT trigger a stale regenerate -- skip is correct until `resampled/` actually changes; one test for the missing-`metadata.csv` readable error; one test for a corrupt sidecar file being treated as absent

**Acceptance Criteria:**
- Given new clips have landed in a character's dataset since the last preprocess, when preprocessing runs, then the training config is regenerated (FR15)
- Given no new clips have landed since the last preprocess, when preprocessing runs again, then it is a no-op (FR15)

## Design Notes

The fingerprint is deliberately filesystem-only and cheap: `metadata.csv`'s row count plus a SHA-256 of its bytes, stored as `training/dataset-fingerprint.json` next to `config.json`. This follows the pipeline's existing file-based state pattern (`committed.csv`, `speaker_map.json`) instead of adding a database dependency for a single-host GPU pipeline. Requiring both `config.json` and a matching sidecar before skipping — not just a matching sidecar — means a partially-cleared `training/` directory always regenerates rather than silently staying stale.

It fingerprints `resampled/metadata.csv`, not `dataset/metadata.csv`. `piper_train.preprocess` reads `--input-dir work/{character}/resampled` (main.py:502-503), and `stage_resample`/`stage_preprocess` are independently runnable CLI stages, so a dataset change that hasn't been resampled yet must not look like "new input" to preprocess — it isn't yet. Fingerprinting `resampled/` makes "no-op" correct in that case (nothing new has actually reached preprocess's input), and makes "regenerate" correct once `--stage resample` catches `resampled/` up.

## Verification

**Commands:**
- (in `star-trek-voyicer`) confirm the repo's test command before running -- expected: `tests/test_main.py` passes, including the new fingerprint/skip coverage and the resample-ordering test

**Manual checks:**
- Commit new clips to a character's dataset, run `--stage resample` then `--stage preprocess`: `training/config.json`'s mtime updates and the console prints the regenerate path, not the skip message.
- Run `--stage preprocess` again immediately with no new commits: console prints the skip message and `config.json`'s mtime does not change.
- Commit new clips but do NOT rerun `--stage resample`; run `--stage preprocess` alone: console prints the skip message (correct — nothing new reached `resampled/` yet).

## Suggested Review Order

**Skip/regenerate decision**

- Entry point — fingerprints `resampled/`, not `dataset/`; this is the round-1 review's core correction (see Spec Change Log).
  [`main.py:557`](../../../star-trek-voyicer/apps/jeanlucrecord/main.py#L557)

- Skip requires both `config.json` AND a matching sidecar — a partially-cleared `training/` always regenerates.
  [`main.py:570`](../../../star-trek-voyicer/apps/jeanlucrecord/main.py#L570)

- Regenerate message now names which of three causes triggered it, for expensive-GPU-rerun debuggability.
  [`main.py:574`](../../../star-trek-voyicer/apps/jeanlucrecord/main.py#L574)

**Fingerprint computation**

- Clip count + SHA-256 of `metadata.csv`; missing/unreadable/non-UTF-8 input raises a clean `SystemExit`, not a raw traceback.
  [`main.py:496`](../../../star-trek-voyicer/apps/jeanlucrecord/main.py#L496)

**Sidecar persistence (crash-safe)**

- Missing OR corrupt (bad JSON, bad UTF-8, vanished file) sidecar both read as "absent" — round-2 review's patch.
  [`main.py:526`](../../../star-trek-voyicer/apps/jeanlucrecord/main.py#L526)

- Atomic temp-file-then-replace write, so a crash mid-write can never leave the sidecar `_load_sidecar` has to defend against.
  [`main.py:546`](../../../star-trek-voyicer/apps/jeanlucrecord/main.py#L546)

**Tests**

- Proves the round-1 bug is closed: dataset changes alone (no resample) stay a no-op.
  [`test_main.py:215`](../../../star-trek-voyicer/apps/jeanlucrecord/tests/test_main.py#L215)

- Covers the round-2 corrupt-sidecar and atomic-write patches.
  [`test_main.py:95`](../../../star-trek-voyicer/apps/jeanlucrecord/tests/test_main.py#L95), [`test_main.py:112`](../../../star-trek-voyicer/apps/jeanlucrecord/tests/test_main.py#L112)

## Spec Change Log

- **Finding:** Round-1 automated review (blind-hunter, verification-gap; corroborated independently by both) -- `_dataset_fingerprint` hashed `dataset/metadata.csv`, but `piper_train.preprocess` actually consumes `resampled/metadata.csv`. Because `--stage resample` and `--stage preprocess` are independently runnable, running preprocess alone after a dataset change (without an intervening resample) would detect the mismatch, regenerate against **stale** `resampled/` data, then write a sidecar recording the *new* dataset fingerprint -- permanently masking that stale audio was used, with no test catching it.
  **Amended:** Frozen Approach, Boundaries & Constraints, and I/O & Edge-Case Matrix now name `resampled/metadata.csv` as the fingerprint source (not `dataset/metadata.csv`), with a new matrix row for "changed but not yet resampled" (correct no-op). Code Map/Tasks updated to fingerprint the `resampled/` dir and add a corresponding ordering test. This is a mechanical correction to which file backs the fingerprint -- the underlying intent (regenerate on new input, skip otherwise) is unchanged.
  **Known-bad state avoided:** silent, permanent masking of stale training data after a standalone `--stage preprocess` run.
  **KEEP:** the sidecar approach (clip count + SHA-256), writing the sidecar only after `run_docker` succeeds, requiring both `config.json` and a matching sidecar to skip, the pure/Path-parameterized helper design, and the `app_dir` test fixture pattern (monkeypatching `main.APP_DIR`, mirroring `test_api.py`'s `WORK_DIR` fixture) -- all correct and unaffected by this change.
  Folded in from the same review round (not separately loop-backed, since code was already being re-derived): defensive handling for a missing `metadata.csv` and a corrupt sidecar file (both previously unhandled crashes), a regenerate-path log message, and reuse of `conftest.py`'s existing `sys.path` pattern instead of duplicating it in the new test file.
