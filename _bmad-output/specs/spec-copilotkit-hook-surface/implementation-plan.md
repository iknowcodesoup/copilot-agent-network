# Implementation Plan — CopilotKit Hook Surface

Ordered technical steps toward the capabilities in `SPEC.md`. HOW detail; the kernel states WHAT and success only. See `hook-policy.md` for the policy referenced.

## Phase 1 — safe before `spec-videos-and-voices-views`, touches no run data model

- [ ] Publish the selected run id with `useAgentContext` in `page.tsx`, so "approve this one" resolves. (CAP-1)
- [ ] Publish a static `useAgentContext` describing the phases and which action is legal in each. The model then reasons instead of guessing. (CAP-1)
- [ ] Add `useConfigureSuggestions`, seeded from the runs on screen. (CAP-3)
- [ ] Add one `useFrontendTool` that changes view state only, such as expanding a run. It proves the loop end to end against `spec-agui-tool-loop` and risks nothing. (CAP-2)
- [ ] Add `useAgent` to show run status in the sidebar header. (CAP-4)

## Phase 2 — after `spec-videos-and-voices-views` lands

- [ ] Re-read `SPEC.md` and write the tool inventory against the Videos and Voices views. Classify each action by the policy table in `hook-policy.md`: reversible actions become `useFrontendTool`, and actions that spend GPU time or destroy data become `useHumanInTheLoop`. (Open Question in `SPEC.md`)
- [ ] Publish context from each new view, next to the hook that fetches it.
