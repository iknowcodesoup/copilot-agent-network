# Brownfield Notes — Video-Scoped Ingestion

Verified against `star-trek-voyicer` at commit `5b88eae`.

## Current gaps

- **Filesystem (the only real blocker).** `video_dir_for` builds `work/<character>/youtube/<video_id>/`, so videos nest inside character namespaces (`main.py:127-140`). Re-ingesting the same video for a second character repeats download, transcribe, and diarize.
- **Preprocess.** Skips when `training/config.json` exists (`main.py:496-498`). New clips in `dataset/` do not regenerate the training config; today a person deletes `config.json` by hand. `stage_resample` always reruns (`main.py:484-491`), so preprocess is the only stale step.
- **Control API.** Every clip and speaker-map route is character-scoped, in the form `/characters/{character}/videos/{video_id}/...` (`api.py:553-617`). No route lists ingested videos on their own.
- **Commit has no endpoint.** It runs as a job stage through `POST /jobs` with `stage: "youtube-commit"`.

## Already built — do not rebuild

- `speaker_map.json` is already video-scoped and multi-character. `load_speaker_targets` reads `{speaker_label: character}` from the video directory (`review.py:143-163`), and `_resolve_target` routes one video's clips to several characters (`review.py:173-185`). `stage_youtube_commit` marks every dataset that gained clips (`main.py:466-476`). Only the file path needs to move.
- `count_by_speaker` returns speaker label to clip count (`diarize.py:119-124`). `GET /videos/{id}/speakers` can call it directly.
- `JobRequest.character` is already `str | None = None` (`api.py:110`). The character tie lives in the `_video_dir` path helper, not in the model.

## Gateway call sites affected (CAP-2, CAP-3 breaking-change constraint)

`VoiceFactoryGateway` in `copilot_agent_network` binds to the five moved routes (`voice_factory_gateway.py:170-210`):

- `get_clips`
- `update_clips`
- `set_speaker_map`
- `get_training_progress` — stays character-scoped, does not move
- `stream_clip_audio`

## Cross-spec note

The multi-character routing already works: `commit_reviewed_clips` reads `speaker_map.json` and sends each speaker's clips to that character's dataset (`review.py:143-185`), and `stage_youtube_commit` marks every dataset that gained clips (`main.py:466-476`). So this spec is mostly a path move plus a route move, not new routing logic.

This spec changes the HTTP contract that `copilot_agent_network` consumes. `spec-multi-voice-data-model` owns the pythonapi data model that sits behind it. The gateway URL change must land with this spec, not with that one, because the break happens the moment the routes move.
