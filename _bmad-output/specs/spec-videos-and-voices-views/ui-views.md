# UI Views — Videos And Voices Views

## Navigation

Tab or nav segment between **Videos** and **Voices** views. (CAP-1)

## Videos view

- Table of ingestion runs: video title, source URL, speaker count, diarization status (DOWNLOADING/DIARIZING/AWAITING_REVIEW). (CAP-2)
- Each row expands to show detected speaker clips. Status badge shows "awaiting assignment" or "assigned to voice X". (CAP-2)
- Click to open the review panel (`speaker_board`, renamed). Replace the free-text name input with a combobox that searches existing voices or creates a new one inline. (CAP-2)
- Action buttons: "Assign speakers" (open combobox, not auto-train), "Commit assignments" (lock in assignments, create contributions), "Discard" (reset to AWAITING_REVIEW). (CAP-3)
- Multiple videos can be reviewed and assigned in parallel; commit them one at a time or in batch. (CAP-3)

## Voices view

- Card grid or table of voices: name, status (AWAITING_COMMIT/TRAINING/EXPORTING/READY/FAILED), total clip count, model size (if READY). (CAP-4)
- Each voice card shows a "contributing videos" badge (e.g. "3 videos") with a popover listing each video, its clip count from that video, and assignment date. (CAP-4)
- Action buttons: "View clips" (list all clips across all videos), "Retrain" (explicit trigger), "Download model" (if READY). (CAP-4)
- If a voice has AWAITING_COMMIT contributions, show a banner "ready to train?" with a "Train now" button. (CAP-4)

## Data queries needed

- `GET /voices` — list all voices with current phase and checkpoint (if available). (CAP-4)
- `GET /voices/{id}` — fetch voice + array of contributions (video_id, speaker_label, clip_count, committed_at). (CAP-4)
- `POST /voices` — create new voice (name only). (CAP-2)
- `GET /runs` — list ingestion runs (video-scoped, ingestion phase only, no training phases). (CAP-2)

All four routes come from `spec-multi-voice-data-model`.
