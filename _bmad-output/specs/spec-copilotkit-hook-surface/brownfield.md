# Brownfield Notes — CopilotKit Hook Surface

## Current gap

`useAgentContext` in `features/voices/voice_event_stream.tsx` (line 188) hands the agent a run list. Nothing else. So the agent reads a summary and does nothing. Two gaps follow: it cannot see what the user sees, and it cannot do what the user does.

## Context the agent cannot see today

- Which run the user opened (`expandedRunId`, `page.tsx` line 22).
- The speakers and clips of the open run.
- Training progress and checkpoints.
- Video search results.
- The character list.
- The phase state machine itself.

## Scope note

Specs `spec-multi-voice-data-model` and `spec-videos-and-voices-views` rewrite the action inventory: `approve_run` becomes assign, commit, and train; new Videos and Voices views replace the single list. So this spec fixes the policy and the plumbing now, and names the concrete tool inventory only after `spec-videos-and-voices-views` lands (see Open Questions in `SPEC.md`).
