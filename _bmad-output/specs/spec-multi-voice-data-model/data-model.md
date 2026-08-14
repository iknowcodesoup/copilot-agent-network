# Data Model — Multi-Voice Data Model

## New tables

**`voices`**

| Column | Notes |
| --- | --- |
| `id` | |
| `name` | |
| `phase` | One of `AWAITING_COMMIT → TRAINING → EXPORTING → READY`, or `FAILED`. |
| `checkpoint_path` | Optional — first training uses the base model. |
| `created_at` | |
| `updated_at` | |

The durable voice entity. (CAP-1, CAP-4)

**`voice_contributions`**

| Column | Notes |
| --- | --- |
| `id` | |
| `voice_id` | |
| `run_id` | |
| `video_id` | |
| `speaker_label` | |
| `clip_count` | |
| `committed_at` | |

The link between a voice and the video runs that fed it. One row per (voice, run, speaker) triple. Immutable after creation — an audit trail. (CAP-1, CAP-5)

## Trimmed table

**`voice_runs`** — keeps only:

```
id, source_url, video_id, video_title,
ingest_phase (DOWNLOADING/DIARIZING/AWAITING_REVIEW/COMMITTED),
speaker_map: JSONB
```

Dropped from the current `VoiceRunRow` (`orm.py:71-127`): `primary_character`, `phase` (the values `COMMITTING/TRAINING/EXPORTING/READY`), `checkpoint_path`, and training-stage columns — these move to `voices`. (CAP-2)

## Split graphs

- **Ingest graph** — one per video, ingestion-only.
- **Voice graph** — one per voice, triggered when a contribution commits. Handles `TRAINING → EXPORTING → READY`.

## Routes

- `POST /runs/{id}/assign` — assign one video's speaker labels to voices (new or existing). Records proposed assignments; `ingest_phase` stays `AWAITING_REVIEW`. (CAP-3)
- `POST /runs/{id}/commit` — lock in assignments, create contributions, move `ingest_phase` to `COMMITTED`. Trigger voice graphs for affected voices. (CAP-3)
- `POST /voices/{id}/train` — explicit manual trigger (or auto-trigger on first contribution). Kicks off the voice's training graph. (CAP-4)
- `POST /voices` — create a named voice. (CAP-1)
- `GET /voices/{id}` — fetch a voice plus its contributions. (CAP-5)

## Repository methods

Fetch voices by name; list contributions for a voice; retrieve all videos that fed a voice. (CAP-5)
