# Deferred Work

Entries added by review triage. Not modified retroactively — new findings append, existing entries stay as written.

- source_spec: `_bmad-output/implementation-artifacts/spec-2-1-reuse-ingested-videos-across-characters.md`
  summary: `write_speaker_map` merges the request into the existing `speaker_map.json` with a plain read-modify-write and no file locking, so two concurrent `PUT /videos/{id}/speaker-map` calls for the same video can race and silently drop one writer's update.
  evidence: Round-2 review (blind-hunter, edge-case-hunter) found the merge has no atomic compare-and-swap. The spec's own Boundaries & Constraints explicitly scope full concurrent-review handling to Story 2.2 ("this story only needs to stop these writes from silently destroying data, not fully solve concurrent review"), so a true simultaneous-write race is out of this story's bar by design.

- source_spec: `_bmad-output/implementation-artifacts/spec-2-1-reuse-ingested-videos-across-characters.md`
  summary: `committed.csv` and `review.csv` are now shared across every character's commit/patch runs against a video, with no locking around the read-modify-write, whereas before this story each character had its own file.
  evidence: Round-2 review (blind-hunter, edge-case-hunter) flagged this as a new concurrency surface. Same rationale as the speaker-map race above — full concurrent-claim safety is explicitly Story 2.2's job per the spec's frozen Boundaries & Constraints.

- source_spec: `_bmad-output/implementation-artifacts/spec-2-1-reuse-ingested-videos-across-characters.md`
  summary: `star-trek-voyicer`'s HTTP job API (`api.py` `_build_command`) still requires a `character` for `--stage youtube-search`, while the CLI (`main.py`) has exempted `youtube-search` from that requirement since before this story.
  evidence: Confirmed by diffing both files against `HEAD`: `main.py`'s CLI already excluded `youtube-search` pre-diff; `api.py`'s pre-diff code required a character for every stage except `smoketest`, unchanged by this story for `youtube-search` specifically. Pre-existing inconsistency, not introduced or worsened by this change — round-2 review (blind-hunter, edge-case-hunter) surfaced it incidentally because this diff touched the adjacent exemption logic for the youtube-ingest stages.

- source_spec: `_bmad-output/implementation-artifacts/spec-2-1-reuse-ingested-videos-across-characters.md`
  summary: Every route in `copilot_agent_network/apps/pythonapi/pythonapi/routes/voice.py` collapses any `VoiceFactoryError` into a generic 502 "did not answer" response, including a 404 the factory itself raised (e.g. an unknown `video_id`) — so a not-found case is indistinguishable from the factory being down. The gateway also reads `payload["videos"]`/`payload["speakers"]` via bare subscript, matching the file's existing bare-subscript pattern elsewhere (e.g. `get_job_state`'s `payload["state"]`), so a malformed factory response raises an uncaught `KeyError` (raw 500) instead of the intended 502.
  evidence: Verified by reading `routes/voice.py`: every `except VoiceFactoryError` handler (list_characters, list_videos, get_video_speakers, get_clips, update_clips, get_clip_audio, etc.) uses the same `_unavailable` → 502 helper with no `_not_found` counterpart anywhere in the file. This is the file's established, systemic error-handling design, not something this story's two new routes deviate from or introduce.

- source_spec: `_bmad-output/implementation-artifacts/spec-2-1-reuse-ingested-videos-across-characters.md`
  summary: `GET /videos` walks the full `work/youtube/` tree and re-parses each video's `review.csv` synchronously on every request, with no pagination.
  evidence: The spec's own Boundaries & Constraints already flagged this exact question as "Ask First: whether GET /videos needs pagination now, or a full list is acceptable (no existing precedent either way)" and left it open. The implementation chose the simpler unpaged answer. Revisit if video counts grow enough for this to become a real latency concern.

- source_spec: `_bmad-output/implementation-artifacts/spec-2-1-reuse-ingested-videos-across-characters.md`
  summary: `main.py`'s `video_dir_for` (the function that resolves the new shared `work/youtube/<video_id>` path) has no dedicated unit test, because `main.py` imports GPU-dependent packages (`diarize`, `generate_dataset`, etc.) unconditionally at module load, which is why the story's new `test_api.py` deliberately tests `api.py` instead and never imports `main.py`.
  evidence: Round-2 review (verification-gap) confirmed via grep that no test file in `apps/jeanlucrecord/tests/` imports `main.py`, and confirmed by reading `main.py`'s top-level imports that they are unconditional. Closing this gap needs a decision on whether to restructure `main.py`'s imports (e.g. lazy-import the heavy modules) to make it test-importable — a structural change beyond this story's narrow scope, not a mechanical fix.

- source_spec: `_bmad-output/implementation-artifacts/spec-2-3-skip-redundant-preprocessing.md`
  summary: `apps/jeanlucrecord/api.py`'s `GET /characters/{character}/training` still reports `"preprocessed": (training_dir / "config.json").exists()` — the same bare-existence check Story 2.3 replaced inside `stage_preprocess` because it can't tell a stale config from a current one.
  evidence: Round-1 review (verification-gap) confirmed via grep that no test in `test_api.py` or elsewhere asserts on `get_training`'s `preprocessed` field, and that it does not read the new fingerprint sidecar. Out of this story's scope — its AC's cover `stage_preprocess`'s own regenerate/no-op decision, not this HTTP status field — but the two notions of "is preprocessing current" are now inconsistent.

- source_spec: `_bmad-output/implementation-artifacts/spec-2-3-skip-redundant-preprocessing.md`
  summary: The fingerprint sidecar only tracks `resampled/metadata.csv`'s content, never `piper_train.preprocess`'s own invocation parameters (`--language`, `--sample-rate`, `--dataset-format`, hardcoded in `stage_preprocess`). If those constants change later, every existing sidecar still "matches" and `stage_preprocess` keeps skipping regeneration even though the parameters that produced the cached output no longer match what the code would now produce.
  evidence: Round-2 review (blind-hunter) identified this. Pre-existing blind spot -- the old bare `config.json.exists()` check had the identical limitation (no cache invalidation on script-parameter changes either), so this story neither introduces nor worsens it.

- source_spec: `_bmad-output/implementation-artifacts/spec-2-3-skip-redundant-preprocessing.md`
  summary: `stage_preprocess` has no locking or mutual exclusion around its read-fingerprint / run-docker / write-sidecar sequence. Two overlapping invocations for the same character could both observe "stale," both launch `run_docker` concurrently, and race on `config.json` and the sidecar file.
  evidence: Round-2 review (blind-hunter) identified this. Pre-existing, systemic to the whole stage-based CLI -- no other stage in `main.py` (e.g. `stage_youtube_commit`) locks either, and the old presence-only check had the same race. Not introduced or worsened by this story.

- source_spec: `_bmad-output/implementation-artifacts/spec-3-3-trigger-training-explicitly-or-automatically-independent-of.md`
  summary: Neither `PostgresVoiceRepository.update_voice` (`repositories/voices.py`) nor its mirror `PostgresVoiceRunRepository.update_run` (`repositories/voice_runs.py`) scope their `UPDATE` to `lease_owner`. A reconciler instance whose lease already expired can still overwrite a newer owner's phase/job-id write if its own write lands after the new owner's.
  evidence: Round review (blind-hunter, edge-case-hunter) flagged this for the new `VoiceRepository.update_voice`. Confirmed by reading `voice_runs.py`'s `update_run`: it uses the identical `session.get` + attribute-mutation pattern with no `WHERE lease_owner = :owner` guard, so this is the established codebase pattern for both entities, not a regression this story introduced.

- source_spec: `_bmad-output/implementation-artifacts/spec-3-3-trigger-training-explicitly-or-automatically-independent-of.md`
  summary: `POST /voices/{id}/train` and the auto-trigger in `commit_run` both clear `Voice.voyicer_job_id` to start a fresh job without calling `gateway.cancel_job()` on any job the cleared id pointed to, so a superseded training/export job can keep running on the factory host, untracked and unbilled-for by the app.
  evidence: Round review (blind-hunter, edge-case-hunter) flagged this for the new `/train` route. Confirmed by reading `voice_pipeline_graph.py`'s `_advance`/`_fail`, which do the identical "clear `voyicer_job_id`, never cancel" on every ingestion phase transition — this is the established pattern the new training graph mirrors, not a new gap.

- source_spec: `_bmad-output/implementation-artifacts/spec-3-3-trigger-training-explicitly-or-automatically-independent-of.md`
  summary: `VoiceTrainingReconciler.tick()` (`workers/voice_training_reconciler.py`) lets an unexpected exception from `_advance` propagate out of the `try/finally`, aborting the rest of the claimed batch; the remaining claimed voices stay leased until their lease naturally expires rather than being released or retried immediately.
  evidence: Round review (edge-case-hunter) flagged this. Confirmed by reading `voice_run_reconciler.py`'s `tick()`: it has the identical `try/finally` structure with no batch-level exception isolation, so this is inherited from the pattern being mirrored, not introduced by this story.

- source_spec: `_bmad-output/implementation-artifacts/spec-3-3-trigger-training-explicitly-or-automatically-independent-of.md`
  summary: `VoiceRepository.claim_voices`/`claim_voice` (both `InMemoryVoiceRepository` and `PostgresVoiceRepository`) have no test covering the `limit` parameter's batching behavior or `created_at` tie-breaking order.
  evidence: Round review (blind-hunter) flagged this. The mirrored `VoiceRunRepository.claim_runs` has the identical gap — no batching/ordering test exists for it either, per grep across `apps/pythonapi/tests/`. Pre-existing gap in the pattern being mirrored, not unique to this story.

- source_spec: `_bmad-output/implementation-artifacts/spec-3-4-split-the-dashboard-into-videos-and-voices-views.md`
  summary: `DashboardNav`'s active-tab check (`apps/agentic-executor/src/app/features/nav/dashboard_nav.tsx`) uses an exact `pathname === item.href` match, so it will not highlight "Videos" or "Voices" once either view grows nested routes (e.g. `/videos/[id]`).
  evidence: Blind-hunter and edge-case-hunter both flagged this independently. No nested routes exist under `/videos` or `/voices` yet — Story 3.4 only adds the two top-level segments — so this is a forward-looking gap, not a current defect.

- source_spec: `_bmad-output/implementation-artifacts/spec-3-4-split-the-dashboard-into-videos-and-voices-views.md`
  summary: Neither `apps/agentic-executor/src/app/videos/page.tsx` nor `apps/agentic-executor/src/app/voices/page.tsx` sets a route-specific `<title>` metadata export, so the browser tab/history title stays whatever the root layout's static `metadata.title` ("Agentic Executor") already is, unchanged across both views.
  evidence: Blind-hunter flagged this. Pre-existing: the single old dashboard page never set per-page metadata either, so this story neither introduces nor worsens it.

- source_spec: `_bmad-output/implementation-artifacts/spec-3-4-split-the-dashboard-into-videos-and-voices-views.md`
  summary: The new `<nav>` element in `dashboard_nav.tsx` has no `aria-label`, so a screen reader cannot distinguish it by name from any other landmark region on the page (e.g. if the chat sidebar or a future region also uses `<nav>`).
  evidence: Blind-hunter flagged this. Cheap fix but not spec-mandated; deferred rather than patched inline since it's an accessibility enhancement, not a functional gap.

- source_spec: `_bmad-output/implementation-artifacts/spec-3-4-split-the-dashboard-into-videos-and-voices-views.md`
  summary: `apps/agentic-executor-e2e/src/example.spec.ts` navigates to `/` and asserts the dashboard `h1`, with a comment claiming "One page: the dashboard is the app." Both are now stale — `/` redirects to `/videos` rather than rendering the dashboard directly — though the assertion still passes coincidentally because `VideosPage` renders the same heading text.
  evidence: Verification-gap review confirmed by reading the file. Not touched by this story's diff, and per explicit user directive no Playwright/e2e/UI test work is being done for this app right now (UX is not final), so fixing the stale comment/assertion is deferred rather than patched.
