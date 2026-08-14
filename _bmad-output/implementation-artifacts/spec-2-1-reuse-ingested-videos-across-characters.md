---
title: 'Reuse Ingested Videos Across Characters'
type: 'feature'
created: '2026-08-13'
status: 'done'
review_loop_iteration: 1
context: []
baseline_commit: '106c957b210985eb372e426420cd9cbe706f6cfe'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Video ingestion (download, transcribe, diarize) is scoped per character on both sides of the `copilot_agent_network` / `star-trek-voyicer` boundary. Claiming the same YouTube video for a second character re-runs the full pipeline instead of reusing cached artifacts, because the control API stores and reads everything under `work/<character>/youtube/<video_id>/` and the gateway routes are path-scoped by character.

**Approach:** Decouple ingestion artifacts from character in `star-trek-voyicer` (video-scoped storage, ingest stages that no longer require a character) and move four of the five `VoiceFactoryGateway`-bound routes to video-scoped paths in both repos. Add two new video-scoped routes (`GET /videos`, `GET /videos/{id}/speakers`) so the dashboard can browse ingested videos independent of character.

## Boundaries & Constraints

**Always:**
- All five gateway-bound routes (`get_clips`, `update_clips`, `set_speaker_map`, `stream_clip_audio`, `get_training_progress`) move together in this one change (NFR3) — never split into separate rollouts.
- `get_training_progress` stays character-scoped (training has no `video_id` concept) — only its call sites/tests move alongside the other four; its scoping is unchanged.
- Changes in `star-trek-voyicer` and their callers in `copilot_agent_network` land in the same change — never deploy one repo ahead of the other.
- No migration script for existing `work/<character>/youtube/*` directories — accept a one-time re-ingest in development (PRD Open Question 2, resolved).
- Any new Postgres access uses SQLAlchemy 2.0 async — no raw SQL.

**Ask First:**
- Whether `stage_youtube_commit`/`review.py` fan-out logic needs anything beyond the mechanical path change to keep working post-move.
- Whether `GET /videos` needs pagination now, or a full list is acceptable (no existing precedent either way).

**Never:**
- Do not write a migration script for pre-existing ingested videos.
- Do not change `stage_train`/`stage_export`/`stage_sample` or any character-only pipeline stage.
- Do not add a durable `voices`/Voice entity — that is Epic 3.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Reuse across characters | Video already ingested for character A; operator claims it for character B | No download/transcribe/diarize step runs; cached artifacts reused by video ID (FR12) | N/A |
| First ingest | Video ID not yet under `work/youtube/<id>/` | Full pipeline runs as today, writes to the new video-scoped path | N/A |
| List videos | `GET /videos` | Ingested video IDs + diarization status, no character scoping (FR13) | N/A |
| List speakers | `GET /videos/{id}/speakers` | Detected speaker labels + clip counts for that video, no character scoping (FR13) | 404 if video ID unknown |
| Training progress | `GET /voice/runs/{id}/training` | Unchanged: character-scoped via `primary_character`, no `video_id` | N/A |
| Existing dashboard flows | Speaker board, clip review, approve, clip audio against migrated routes | No functional regression (SM-4) | N/A |

</frozen-after-approval>

## Code Map

**`star-trek-voyicer` (host control API, separate repo):**
- `apps/jeanlucrecord/api.py` L553-627 -- five routes to move: `get_clips`(553), `patch_clips`(568), `put_speaker_map`(597), `get_clip_audio`(610) go video-scoped; `get_training`(619) stays character-scoped; add `GET /videos`, `GET /videos/{video_id}/speakers`
- `apps/jeanlucrecord/api.py` L415 `_video_dir(character, video_id)`, L406/L55 `_check_name`/`SAFE_NAME` -- path resolution changes from `WORK_DIR/character/youtube/video_id` to `WORK_DIR/youtube/video_id`
- `main.py` L127-140 `video_dir_for(character, url)` -- drop `character` param; producer of all video artifacts
- `main.py` L108-114 `YOUTUBE_INGEST_STEPS`, ingest stages (`youtube-download/transcribe/chunk/diarize/review`) -- decouple from required `character` positional arg
- `main.py` L457 `stage_youtube_commit(character)` -- signature unchanged, but its `youtube_dir` scan must move from `work/<character>/youtube` to the shared `work/youtube` (round-1 finding: doing this naively broke ownership -- see below)
- `src/review.py` `commit_reviewed_clips` (scans every video dir under `youtube_dir`), `load_speaker_targets` (returns `None` when a video has no `speaker_map.json`), `_resolve_target` (falls back to `out_dir`, i.e. the committing character's own dataset, whenever `speaker_targets` is falsy) -- **round-1 root cause**: this fallback was correct when `youtube_dir` held only the committing character's own videos (no map = the video's one implicit owner). It is unsafe once `youtube_dir` is shared: `stage_youtube_review` auto-writes `review.csv` with `keep=1` rows *before* any human review or `speaker_map.json` exists (`main.py` L379-384), so any character's commit run can sweep up another character's not-yet-approved video and silently misattribute its clips. The fix belongs in `commit_reviewed_clips`'s per-video loop: skip a video (do not call `_resolve_target`/copy anything) when `load_speaker_targets` returns `None` for a *shared* scan -- an unmapped video's ownership is genuinely unknown, not "assume it's mine" like before.
- `write_speaker_map` (`src/review.py`) -- writes `map_request.speaker_map` verbatim, replacing the file's prior contents. Safe when one character owns a video's `speaker_map.json` for its whole lifetime; unsafe now that a second character can legitimately claim the same shared video later. `PUT /videos/{id}/speaker-map` (`api.py` `put_speaker_map`) must read the existing map first and merge the request's keys into it rather than overwriting wholesale, so an earlier character's speaker->character assignments survive a later character's claim.
- `PATCH /videos/{id}/clips` (`api.py` `patch_clips`) writes clip keep/speaker-label decisions into the same shared `review.csv` two different characters' runs can now both reach. Round-1 shipped this as a plain overwrite of matching rows with no isolation. Given Story 2.2 ("Route One Commit to Multiple Characters Across Multiple Videos") owns full multi-claimant routing, this story's bar is narrower: decisions must not silently corrupt another character's already-recorded review state. The minimum safe behavior is documented in Tasks below.

**`copilot_agent_network` (this repo):**
- `apps/pythonapi/pythonapi/core/voice_factory_gateway.py` L170-211 -- `get_clips`/`update_clips`/`set_speaker_map`/`stream_clip_audio` drop `character` param and URL segment; `get_training_progress` (L195-197) unchanged; add `list_videos()` and `get_video_speakers(video_id)`
- `apps/pythonapi/pythonapi/routes/voice.py` L174-341 -- `get_speaker_board`(186), `update_clips`(231/234), `approve_run`(269), `get_clip_audio`(301) call sites drop `character` arg; add `GET /videos`, `GET /videos/{id}/speakers` routes
- `apps/pythonapi/pythonapi/models/orm.py` L71-127 `VoiceRunRow` -- no schema change expected; `video_id` already exists on the run row
- `apps/pythonapi/tests/test_voice.py` L111-141 `FakeVoiceFactoryGateway` -- signatures + `self.speaker_maps` tuple shape update; L277/303/320 existing route tests to adjust; add coverage for new `/videos` routes

## Tasks & Acceptance

**Execution:**
- [x] `star-trek-voyicer/apps/jeanlucrecord/api.py` -- change `_video_dir` and the four routes to `WORK_DIR/youtube/{video_id}` (drop the `character` segment); add `GET /videos` and `GET /videos/{video_id}/speakers` -- makes ingestion artifacts addressable by video ID alone
- [x] `star-trek-voyicer/main.py` -- change `video_dir_for` and the youtube-ingest stages to take a video ID/URL without a required `character` -- decouples the producer side to match
- [x] `star-trek-voyicer/src/review.py` `commit_reviewed_clips` -- when scanning a shared `youtube_dir`, skip (do not copy, do not mark committed) any video whose `load_speaker_targets` returns `None` instead of falling back to `out_dir` -- an unmapped video during a shared scan is unclaimed, not owned by whoever happens to run commit next (fixes the round-1 cross-character dataset leak)
- [x] `star-trek-voyicer/src/review.py` `write_speaker_map` / `api.py` `put_speaker_map` -- read the video's existing `speaker_map.json` (if any) and merge the request's keys into it before writing, instead of overwriting the file -- prevents a second character's claim from erasing a first character's earlier assignments
- [x] `star-trek-voyicer/apps/jeanlucrecord/api.py` `patch_clips` -- guard against one character's clip decision silently overwriting a different, already-recorded decision on a shared video's `review.csv` for the same clip (e.g. reject a conflicting change with 409, or otherwise make the conflict visible rather than losing it silently) -- narrow fix; full multi-claimant routing is Story 2.2's job
- [x] `copilot_agent_network/apps/pythonapi/pythonapi/core/voice_factory_gateway.py` -- drop `character` from the four method signatures/URLs; add `list_videos`/`get_video_speakers` -- keeps the gateway's shape matching the moved control-API routes
- [x] `copilot_agent_network/apps/pythonapi/pythonapi/routes/voice.py` -- update the four call sites; add `GET /videos`, `GET /videos/{id}/speakers` handlers -- exposes FR13 to the dashboard
- [x] `copilot_agent_network/apps/pythonapi/tests/test_voice.py` -- update `FakeVoiceFactoryGateway` and existing route tests for the new signatures; add tests for the two new routes, the reuse-no-reingest scenario, and the training-progress-stays-character-scoped case -- covers the I/O matrix
- [x] `star-trek-voyicer` test coverage -- add an HTTP-level test file for `api.py` covering the moved/new routes, plus a `test_review.py`/`test_main.py` case that builds two videos under one shared `work/youtube/` for two different characters (at least one with no `speaker_map.json`) and asserts `stage_youtube_commit` for one character never touches the other's dataset -- this is the regression test round 1 was missing

**Acceptance Criteria:**
- Given a video already ingested for character A, when an operator claims it for character B, then no download/transcribe/diarize subprocess runs and the existing artifacts under `work/youtube/{video_id}/` are read directly (FR12)
- Given the migrated routes, when `GET /videos` is called, then it returns ingested video IDs with diarization status, with no character scoping (FR13)
- Given the migrated routes, when `GET /videos/{id}/speakers` is called, then it returns that video's detected speaker labels with clip counts (FR13)
- Given the Voices dashboard against the migrated routes, when speaker board, clip review, approve, and clip audio are exercised, then behavior is unchanged (SM-4)
- Given two videos under the shared `work/youtube/` directory ingested/reviewed for two different characters, one of them with no `speaker_map.json`, when `stage_youtube_commit` runs for the character whose video *is* mapped, then the unmapped video's clips are never copied into that character's dataset
- Given a shared video already has a `speaker_map.json` written by one character's approval, when a second character approves the same video with a different speaker mapping, then the first character's earlier mapping entries are preserved, not erased
- Given a shared video's clip decision was already recorded via `PATCH /videos/{id}/clips` by one character's run, when a different character's run submits a conflicting decision for the same clip, then the first decision is not silently lost

## Spec Change Log

- **Triggered by:** round-1 code review (blind-hunter, edge-case-hunter, and verification-gap layers, converging independently) found that `stage_youtube_commit`'s directory scan, moved from character-scoped to shared per this story's own design, silently misattributes another character's un-mapped video's clips to whoever commits next -- confirmed by reading `review.py`'s `_resolve_target`/`load_speaker_targets` and `main.py`'s `stage_youtube_review` (which writes `keep=1` rows to `review.csv` automatically, before any human review or `speaker_map.json` exists). Two related findings (blind-hunter, edge-case-hunter): `PUT .../speaker-map` blind-overwrites instead of merging, and `PATCH .../clips` has no isolation between characters sharing a video -- same root cause, same fix category.
  - **What was amended:** Code Map gained the `review.py` ownership-semantics finding; Design Notes' incorrect "commit is unaffected" claim was corrected; Tasks & Acceptance gained three new execution tasks (skip-unmapped-on-shared-scan, merge-not-overwrite speaker-map, guard clip-decision conflicts) and three new acceptance criteria. Intent, Boundaries & Constraints, and the I/O & Edge-Case Matrix were not touched -- the root cause was a technical/design gap, not a captured-intent gap.
  - **Known-bad state avoided:** shipping a feature whose ordinary use (character A ingests a video without diarizing it while character B is mid-review on an unrelated shared video, then B commits) silently corrupts A's training dataset with B's clips, with all tests green because none exercised a multi-video shared directory.
  - **KEEP instructions (round 1 work verified correct, must survive re-derivation):** the four routes' move to `/videos/{video_id}/...` with no character segment; `get_training_progress` staying character-scoped; `_video_dir`/`_review_path`/`video_dir_for` path resolution now under `work/youtube/{id}`; the `GET /videos` and `GET /videos/{id}/speakers` routes and their `VideoSummary`/`VideoSpeakerSummary` models; `_check_name`/`SAFE_NAME` validation on `video_id` staying in place; the `FakeVoiceFactoryGateway` fixture pattern (pythonapi) and the `monkeypatch.setattr(api, "WORK_DIR", tmp_path)` + `TestClient` pattern (star-trek-voyicer) for testing; the CLI argument relaxation in `main.py` for youtube-ingest-family stages. All of round 1's code is preserved in git stashes in both repos (`story-2.1-round-1-pre-bad-spec-fix`) for reference during re-derivation.

## Design Notes

The four clip/speaker/audio routes already resolve to the same on-disk content regardless of `character` in the URL — `character` only builds the path prefix (`_video_dir`, api.py:415), never filters or transforms response data. Dropping it is a mechanical path change, not a data-shape change.

**Correction (round 1 review):** the earlier version of this section claimed `stage_youtube_commit`'s `speaker_map.json` fan-out was "unaffected" by the shared directory. That was wrong — the fan-out mechanism was never the issue; the *scan* was. `commit_reviewed_clips` walking a character-scoped `youtube_dir` and walking a shared one are different safety regimes: the first guarantees every video it finds belongs to the committing character, the second does not. The correct model going forward: an unmapped video encountered during a shared scan is *unclaimed by this commit*, not *owned by this commit*. Only a video with an explicit `speaker_map.json` entry for the committing character is eligible.

Two writes need the same "shared, not owned" correction: `PUT .../speaker-map` must merge into the existing file instead of replacing it, and `PATCH .../clips` must not let one character's decision silently overwrite another's on a clip both can now reach. Story 2.2 owns full multi-claimant routing; this story only needs to stop these writes from silently destroying data, not fully solve concurrent review.

## Verification

**Commands:**
- `nx test pythonapi` -- expected: all tests pass, including updated `test_voice.py` and new `/videos` route tests
- `nx lint pythonapi` -- expected: clean ruff check
- (in `star-trek-voyicer`) confirm the repo's test command before running (check `justfile`/`pyproject.toml`) -- expected: passes

**Manual checks (if no CLI):**
- Ingest a video for one character, then claim it for a second character via the dashboard; confirm no download/transcribe/diarize log lines appear the second time.

## Suggested Review Order

**Path decoupling (the structural change everything else depends on)**

- Video artifacts resolve by video ID alone, no character segment.
  [`api.py:427`](../../../star-trek-voyicer/apps/jeanlucrecord/api.py#L427)

- Producer side of the same path change — where artifacts get written.
  [`main.py:127`](../../../star-trek-voyicer/apps/jeanlucrecord/main.py#L127)

**Cross-character data isolation (round-1 leak fix + round-2 hardening)**

- Commit now scans a shared directory, not one character's own.
  [`main.py:453`](../../../star-trek-voyicer/apps/jeanlucrecord/main.py#L453)

- The actual fix: an unmapped video during a shared scan is skipped, not assumed owned.
  [`review.py:117`](../../../star-trek-voyicer/apps/jeanlucrecord/src/review.py#L117)

- Speaker-map writes merge instead of overwrite, and now reject a silent value change.
  [`review.py:177`](../../../star-trek-voyicer/apps/jeanlucrecord/src/review.py#L177)

- HTTP surface for that guard — 409 on a conflicting reassignment.
  [`api.py:704`](../../../star-trek-voyicer/apps/jeanlucrecord/api.py#L704)

- Clip decisions get the same treatment: persisted-state conflicts plus same-request conflicts.
  [`api.py:620`](../../../star-trek-voyicer/apps/jeanlucrecord/api.py#L620)

**New video-browsing routes (FR13)**

- Control-API routes a dashboard can browse without picking a character first.
  [`api.py:565`](../../../star-trek-voyicer/apps/jeanlucrecord/api.py#L565)

- Gateway methods this repo calls to reach those routes.
  [`voice_factory_gateway.py:172`](../../apps/pythonapi/pythonapi/core/voice_factory_gateway.py#L172)

- FastAPI routes exposing them to the front end, plus their response shapes.
  [`voice.py:108`](../../apps/pythonapi/pythonapi/routes/voice.py#L108)
  [`voice.py:55`](../../apps/pythonapi/pythonapi/models/voice.py#L55)

**Migrated call sites (character dropped, one exception kept)**

- Existing speaker-board/clip-update/clip-audio routes now pass `video_id`, never `character`.
  [`voice.py:207`](../../apps/pythonapi/pythonapi/routes/voice.py#L207)

- `get_training_progress` deliberately still takes `character` — training has no video concept.
  [`voice_factory_gateway.py:206`](../../apps/pythonapi/pythonapi/core/voice_factory_gateway.py#L206)

**Tests**

- Fixture now records the `video_id` each call receives, so a scoping regression would fail.
  [`test_voice.py:56`](../../apps/pythonapi/tests/test_voice.py#L56)

- Proves the same speaker board is reachable from two characters for one video.
  [`test_voice.py:395`](../../apps/pythonapi/tests/test_voice.py#L395)

- Regression test for the round-1 leak: two characters, one unmapped video, no cross-contamination.
  [`test_review.py`](../../../star-trek-voyicer/apps/jeanlucrecord/tests/test_review.py)

- New HTTP-level coverage for the moved and added routes.
  [`test_api.py`](../../../star-trek-voyicer/apps/jeanlucrecord/tests/test_api.py)
