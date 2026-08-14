# Implementation Plan — Videos And Voices Views

Ordered technical steps toward the capabilities in `SPEC.md`. HOW detail; the kernel states WHAT and success only. See `ui-views.md` for the screen designs referenced.

- [ ] Create `videos_view.tsx`: table of runs, status badges, expand/collapse for clips, speaker count. (CAP-1, CAP-2)
- [ ] Create `voice_card.tsx`: display voice name, status, clip count, contributing-videos popover, action buttons. (CAP-4)
- [ ] Create `voice_speaker_combobox.tsx`: searchable dropdown of existing voices + "Create new" option. Replace the free-text input in the speaker review panel. (CAP-2)
- [ ] Refactor `speaker_board.tsx`: swap name input for combobox. Split actions into "assign", "commit", "discard" (three separate buttons). (CAP-2, CAP-3)
- [ ] Update main layout (`page.tsx`): add tab navigation for Videos / Voices views. Route to `videos_view.tsx` and new `voices_view.tsx`. (CAP-1)
- [ ] Create `voices_view.tsx`: render voice cards in a grid. Add "Train now" banner when a voice has pending contributions. Add "View all clips" modal. (CAP-4)
- [ ] Update hooks: `useVoiceRuns` (ingestion runs only), add `useVoices` (fetch all voices with contributions), add `useVoiceContributions` (fetch contributions for one voice). (CAP-2, CAP-4)
- [ ] Update API calls: new `POST /voices`, new `GET /voices/{id}`, split `routes/voice.py` endpoints (per `spec-multi-voice-data-model`). (CAP-2, CAP-3, CAP-4)
