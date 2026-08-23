# Voice Agent

The Voice Agent is the A2A boundary in front of the existing voice pipeline.
It wraps that pipeline. It does not replace any part of it.

## Skills

| Skill          | Answers                                       |
| -------------- | --------------------------------------------- |
| `voice_search` | Which videos match a search                   |
| `voice_run`    | Start a run for a video                       |
| `voice_status` | Where a run or a voice has reached            |
| `voice_review` | What is waiting for a human review            |

## What it must not do

- It must not own the RAG pipeline.
- It must not query Qdrant for normal voice operations.
- It must not duplicate voice run persistence.
- It must not replace the reconciler.

The last two matter most. `voice_runs.phase` is the state machine, and
`VoiceRunReconciler` is its only writer. The Voice Agent reads that state and
asks for work to start. It never writes a phase itself.

## Why the boundary is thin

Everything durable already exists: the phase column, the lease, the
reconciler, the event stream. An agent that re-implemented any of it would
create a second source of truth for state that takes days to move through.

So the agent adds one thing only, an A2A surface, and delegates the rest.

## Human review

`awaiting_review` is the one transition a person makes. The agent reports
that a run is waiting. It does not approve clips on the operator's behalf.

See [agent-network](agent-network.md) for how the Orchestrator reaches it.
