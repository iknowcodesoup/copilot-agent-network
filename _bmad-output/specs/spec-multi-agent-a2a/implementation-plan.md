# Implementation Plan

Six-phase build order. Each phase's tests are the ones listed for it in
`verification.md` that its scope makes possible.

## Phase 1 — Agent boundaries

- Extract the current chat logic into the Orchestrator Agent.
- Define Research Agent interfaces.
- Define Voice Agent interfaces.
- Keep existing business logic intact.

## Phase 2 — Research Agent

- Add the Research Agent.
- Connect it to `RagPipeline`.
- Add the Agent Card.
- Add A2A task handling.
- Add the small project documentation corpus (`repo-and-deployment.md`).
- Add tests.

## Phase 3 — Voice Agent

- Add the Voice Agent.
- Move voice orchestration behind the agent boundary.
- Preserve the existing voice API and state model.
- Add the Agent Card.
- Add A2A task handling.
- Add tests.

## Phase 4 — Orchestrator delegation

- Add Agent Card discovery.
- Add A2A client support.
- Add deterministic routing.
- Add multi-agent workflow handling.
- Add task correlation.
- Add failure handling.

## Phase 5 — Demonstration

Implement the diagnostic workflow (`architecture-diagrams.md` §
Operational diagnosis — the reference demonstration):

1. Ask the Voice Agent for run information.
2. Ask the Research Agent for relevant troubleshooting information.
3. Combine the results.
4. Return a concise explanation.

## Phase 6 — Documentation

Update the README per `repo-and-deployment.md` § README (Phase 6).
