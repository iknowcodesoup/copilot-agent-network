# Implementation Plan — Video-Scoped Ingestion

Ordered technical steps toward the capabilities in `SPEC.md`. HOW detail; the kernel states WHAT and success only.

- [ ] Change `video_dir_for(character, url)` to `video_dir_for(url)`, returning `work/videos/<video_id>`. Drop `character` from its memo key. Keep character directories for `dataset/`, `resampled/`, and `training/` only. (CAP-1)
- [ ] Update the five ingest stages in `main.py` to call the new helper. `stage_youtube_commit` keeps its character argument, because a dataset still belongs to one character. (CAP-1)
- [ ] Add `GET /videos` (video IDs with diarization status) and `GET /videos/{id}/speakers` (labels and clip counts, from `count_by_speaker`). (CAP-2)
- [ ] Move `GET/PATCH /videos/{id}/clips`, `PUT /videos/{id}/speaker-map`, and `GET /videos/{id}/clips/{clip_id}/audio` off the `/characters/{character}` prefix. Change `_video_dir(character, video_id)` to `_video_dir(video_id)`. (CAP-2)
- [ ] Give the commit stage a multi-video payload: `{video_id: {speaker_label: character}}`. `commit_reviewed_clips` already routes across characters, so pass it the selected video directories instead of one character's `youtube/` folder. (CAP-3)
- [ ] Fix `stage_preprocess`. `training/config.json` is written by `piper_train.preprocess` and does not record the dataset, so compare against a sidecar this stage writes itself (clip count plus a hash of `dataset/metadata.csv`). Rerun preprocess when they differ. (CAP-4)
- [ ] Move `speaker_map.json` with the rest of the video artifacts. Its content and readers do not change.
- [ ] **Breaking change — migrate the orchestrator.** `VoiceFactoryGateway` in `copilot_agent_network` binds to the five moved routes (`voice_factory_gateway.py:170-210`): `get_clips`, `update_clips`, `set_speaker_map`, `get_training_progress`, and `stream_clip_audio`. Update the URLs in the same change, or the `/api/voice` dashboard breaks. Only `get_training_progress` stays character-scoped.
- [ ] Decide the migration path for existing `work/<character>/youtube/*` directories: move them, or accept a one-time re-ingest in development. See Open Questions in `SPEC.md`.
