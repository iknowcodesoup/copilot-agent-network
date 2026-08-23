# Verification

Test catalog and acceptance checklist. Referenced from every CAP in
`SPEC.md`.

## Unit tests

- Orchestrator routing (all four categories).
- Research Agent skill handling.
- Voice Agent skill handling.
- Agent Card generation (both specialists).
- A2A task creation.
- A2A task completion.
- A2A task failure.
- A2A task cancellation.
- Specialist unavailable (each specialist, independently — CAP-5).
- Research result with no sources.
- Research result with sources.
- Voice run delegation.

## Integration tests

- `Orchestrator -> A2A -> Research Agent -> RAG Pipeline -> result`
- `Orchestrator -> A2A -> Voice Agent -> mock Voice Factory -> result`

Both mock the external system at their boundary (RAG corpus fixture, mock
voice factory). Neither requires a real GPU training job — CI must not
require a GPU.

## End-to-end test

One e2e test for the combined diagnostic workflow (`architecture-diagrams.md`
§ Operational diagnosis): ask why a run is slow, assert the response reflects
both the Voice Agent's run data and the Research Agent's troubleshooting
content.

## Acceptance checklist

- [ ] The existing AG-UI entry point remains functional.
- [ ] The Orchestrator is the only UI-facing agent.
- [ ] The Research Agent is independently addressable.
- [ ] The Voice Agent is independently addressable.
- [ ] Both specialist agents expose valid Agent Cards.
- [ ] The Orchestrator can discover both specialist agents.
- [ ] The Orchestrator can delegate a research task through A2A.
- [ ] The Orchestrator can delegate a voice task through A2A.
- [ ] The Orchestrator can use both agents for one request.
- [ ] A2A task IDs appear in logs and traces.
- [ ] Research uses the existing RAG pipeline.
- [ ] Voice operations do not require RAG.
- [ ] The existing voice state machine (`voice_runs.phase`) remains the source of truth.
- [ ] `VoiceRunReconciler` remains the source of truth for external run updates.
- [ ] No custom protocol is presented as A2A.
- [ ] No unnecessary agent layer is introduced.
- [ ] CI does not require a GPU.
- [ ] Existing tests continue to pass.
- [ ] New A2A tests pass.
- [ ] The README documents the new architecture.
