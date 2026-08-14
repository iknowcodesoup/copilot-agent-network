# Brownfield Notes — Videos And Voices Views

From frontend code review.

## Current gaps

- **Single view.** `apps/agentic-executor/src/app/page.tsx` renders all runs in one list (95 lines). No separation between ingestion and voice management.
- **Speaker assignment.** `features/voices/speaker_board.tsx` (lines 31-212) is scoped to one run. Speaker naming is a free-text `Input` (lines 121-133), not a searchable list of existing voices.
- **Approval action.** `approve()` (lines 93-99) posts the whole speaker map and starts training in one step. No intermediate "assign but don't train" state.
- **Run status.** `useVoiceRuns()` hook returns a flat array. No grouping by voice, no way to see which videos contributed to a voice.

## Cross-spec note

The `speaker_board` review flow stays the same (play clips, review quality). This spec changes only the naming action (combobox instead of free text) and separates assignment from training.
