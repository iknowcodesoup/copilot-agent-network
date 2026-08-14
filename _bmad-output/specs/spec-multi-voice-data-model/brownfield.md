# Brownfield Notes — Multi-Voice Data Model

From pythonapi code review.

## Current gaps

- **Data model.** `VoiceRunRow` (`orm.py:71-127`) is one flat row per video. No `voices` or `speakers` table. Voice name only lives as JSON keys inside one run's `speaker_map` blob. Nothing links two runs as "same voice, different video."
- **Ingestion graph.** `voice_pipeline_graph.py` (lines 63-90) is one graph per video. Nodes are `DOWNLOADING → DIARIZING → AWAITING_REVIEW → COMMITTING → TRAINING → EXPORTING → READY`. The training phases are hard-coded into the ingestion flow.
- **Approval action.** `approve_run` (`routes/voice.py:244-281`) in one call names speakers, commits their clips, and starts training. No separation of concerns: naming, committing, and training are atomic.
- **Repository.** `VoiceRunRepository` (`repositories/voice_runs.py`) only CRUDs by run ID. No query groups runs by voice; no query answers "all videos contributing to voice X."

## Cross-spec note

The existing `stage_youtube_commit` in `star-trek-voyicer` already merges clips from multiple videos under one character. This spec ensures the pythonapi tracks that merge clearly: via the `voice_contributions` table.
