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
