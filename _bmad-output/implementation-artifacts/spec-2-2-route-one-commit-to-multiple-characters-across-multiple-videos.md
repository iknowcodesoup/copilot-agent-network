---
title: 'Route One Commit to Multiple Characters Across Multiple Videos'
type: 'feature'
created: '2026-08-14'
status: 'in-review'
review_loop_iteration: 0
context: []
baseline_commit: '64759bd62ed44d297def8f2d3ce5f521471848ee'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Committing reviewed clips today needs one job per character (`stage_youtube_commit(character)`, launched via `POST /jobs`). An operator who reviewed speaker labels across several videos, for several characters, must submit one commit per character and has no single call that applies a `{video_id: {speaker_label: character}}` payload in one shot.

**Approach:** Add a batched commit path spanning both repos: a new control-API route in `star-trek-voyicer` that writes every video's speaker-map entries from the payload (merge semantics, same as `PUT /speaker-map`) and then runs one in-process commit pass across the shared `work/youtube/` directory; a matching gateway method and `POST /voice/commit` route in `copilot_agent_network` that call it. `commit_reviewed_clips` already fans a single commit call out to every character any video's map names — this story only needs a payload-driven entry point, not new clip-routing logic.

## Boundaries & Constraints

**Always:**
- Both repos' changes land in the same change — never deploy one ahead of the other (same pairing rule as Story 2.1).
- Reuse `write_speaker_map`'s existing merge-and-conflict-raise behavior (`SpeakerMapConflict` → HTTP 409) for every video in the payload before committing.
- The commit pass covers the whole shared `work/youtube/` directory (existing `commit_reviewed_clips` scan), not only the videos named in this call's payload — already-mapped-but-uncommitted work from earlier calls is picked up too, matching today's idempotent behavior.
- Any keep=1 clip whose speaker label is absent from its video's map is left uncommitted, exactly as today.
- Any new Postgres access uses SQLAlchemy 2.0 async, no raw SQL.

**Ask First:**
- Whether the batched commit runs synchronously in the HTTP request (fast filesystem op, no GPU) or still goes through the `/jobs` subprocess model.

**Never:**
- Do not silently route an undiarized clip (no `speaker_label`) to any character's dataset when there is no single "committing character" — `commit_reviewed_clips`'s `out_dir` fallback must become optional (`None` = skip, not guess) for this batched path.
- Do not touch `approve_run` or the reconciler's single-run `_committing_node_factory` path — this is a new, run-independent route, not a replacement.
- Do not add a durable Voice entity — that is Epic 3.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Multi-video, multi-character commit | Payload names 2 videos, 3 characters total, all speakers already diarized | Every named character's dataset grows from every matching video/speaker pair, one call (FR14) | N/A |
| Conflicting speaker-map entry | Payload reassigns a label a prior claim already set differently | No maps written, no commit run | 409, same shape as `PUT /speaker-map` |
| Unknown video id | Payload names a video not under `work/youtube/` | No maps written for that video | 404 |
| Undiarized/unmapped clip present | A keep=1 clip has no speaker_label, or a label absent from its map | Clip stays uncommitted | N/A (silent skip, not an error) |
| Already-committed clip | Clip id already in that video's `committed.csv` | Skipped, counted separately | N/A |

</frozen-after-approval>

## Code Map

- `star-trek-voyicer/apps/jeanlucrecord/src/review.py:66` `commit_reviewed_clips(youtube_dir, out_dir, dataset_dir_for)` -- change `out_dir: Path` to `out_dir: Path | None = None`; in `_resolve_target` (review.py:228) treat `None` as "skip, not fallback" for both the no-map and no-speaker-label branches.
- `star-trek-voyicer/apps/jeanlucrecord/api.py:427` `_video_dir(video_id)` and `api.py:57` `SAFE_NAME`/`_check_name` -- reuse for validating every `video_id`/`character` in the new payload.
- `star-trek-voyicer/apps/jeanlucrecord/api.py:703` `put_speaker_map` -- pattern to follow for the new route: per-video `write_speaker_map` call, `SpeakerMapConflict` -> 409.
- `star-trek-voyicer/apps/jeanlucrecord/api.py` -- add `POST /videos/commit`: validates payload, writes every video's map, calls `commit_reviewed_clips(youtube_dir, out_dir=None, dataset_dir_for)`, returns per-character counts from `CommitResult.committed_by_target` (review.py:29).
- `copilot_agent_network/apps/pythonapi/pythonapi/core/voice_factory_gateway.py:83-224` -- add `commit_clips(assignments: dict[str, dict[str, str]]) -> dict[str, int]` calling the new control-API route.
- `copilot_agent_network/apps/pythonapi/pythonapi/models/voice.py:194` `SpeakerAssignmentRequest` -- add new `CommitRequest(assignments: dict[str, dict[str, str]])` and `CommitResponse(committed: dict[str, int])`, distinct from the single-run assignment model.
- `copilot_agent_network/apps/pythonapi/pythonapi/routes/voice.py:107-135` -- add `POST /voice/commit` alongside the existing run-independent `list_videos`/`get_video_speakers` routes; do not touch `approve_run` (voice.py:274).
- `copilot_agent_network/apps/pythonapi/tests/test_voice.py:56` `FakeVoiceFactoryGateway` -- add `commit_clips`/`commit_calls` fake, following the `..._video_ids` tracking convention.
- `star-trek-voyicer/apps/jeanlucrecord/tests/test_review.py`, `tests/test_api.py` -- extend for `out_dir=None` skip behavior and the new route.

## Tasks & Acceptance

**Execution:**
- [x] `star-trek-voyicer/.../review.py` -- make `out_dir` optional; `None` skips (not fallback) in `_resolve_target` -- removes the need for a nominal "committing character" in a batched, multi-character call
- [x] `star-trek-voyicer/.../api.py` -- add `POST /videos/commit` accepting `{video_id: {speaker_label: character}}`, validating ids/names, merging every map, then one `commit_reviewed_clips` call with `out_dir=None` -- delivers FR14's single-call entry point
- [x] `copilot_agent_network/.../voice_factory_gateway.py` -- add `commit_clips` -- exposes the new route to this repo
- [x] `copilot_agent_network/.../models/voice.py` -- add `CommitRequest`/`CommitResponse` -- typed payload/response shape
- [x] `copilot_agent_network/.../routes/voice.py` -- add `POST /voice/commit` -- exposes FR14 to the dashboard
- [x] `copilot_agent_network/.../tests/test_voice.py` -- fake + route tests for the new endpoint
- [x] `star-trek-voyicer/.../tests/test_review.py` -- test `out_dir=None` skip for unmapped/undiarized rows
- [x] `star-trek-voyicer/.../tests/test_api.py` -- HTTP-level test for `POST /videos/commit`: multi-video/multi-character success, 409 on conflict, 404 on unknown video

**Acceptance Criteria:**
- Given speaker labels reviewed across two ingested videos naming three characters between them, when an operator submits one `POST /voice/commit` payload, then every named character's dataset grows from every video/speaker pair in the payload, in one call (FR14)
- Given a payload reassigns a label a prior claim already set differently, when the request is submitted, then no maps are written and no commit runs, and the response is a 409

## Design Notes

`commit_reviewed_clips` already fans one call out to every character named across the *entire* shared directory's speaker maps — the only missing piece is a payload-driven way to write those maps and trigger one commit pass without naming a single "committing character" for the fallback path. Making `out_dir` optional is the minimal change; it does not alter behavior for the existing single-character CLI path, which still passes a real `out_dir`.

## Verification

**Commands:**
- `nx test pythonapi` -- expected: all tests pass, including new `/voice/commit` coverage
- `nx lint pythonapi` -- expected: clean ruff check
- (in `star-trek-voyicer`) confirm the repo's test command before running -- expected: passes

**Manual checks (if no CLI):**
- Submit a batched commit payload naming two videos and two characters; confirm both characters' `dataset/metadata.csv` gained rows in one request, with no `/jobs` subprocess spawned.
