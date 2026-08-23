# Architecture Diagrams

Target architecture, protocol responsibilities, and example workflow traces.
Referenced from `SPEC.md` Why and Success signal.

## Target architecture

```mermaid
flowchart LR
    UI[Next.js Chat UI]
    ORCH[Orchestrator Agent]
    RAG[Research Agent]
    VOICE[Voice Agent]
    PIPE[RagPipeline]
    QD[(Qdrant)]
    PG[(Postgres)]
    VF[Voice Factory]

    UI -->|AG-UI| ORCH
    ORCH -->|A2A| RAG
    ORCH -->|A2A| VOICE
    RAG --> PIPE
    PIPE --> QD
    PIPE --> PG
    VOICE --> VF
```

## Protocol responsibilities

| Boundary | Protocol | Purpose |
|---|---|---|
| Browser to Orchestrator | AG-UI | User interaction and streamed UI events |
| Orchestrator to specialists | A2A | Agent-to-agent task delegation |
| Research Agent to RAG tools | Existing application interfaces | Document retrieval |
| Voice Agent to voice factory | Existing HTTP/webhook design | Voice workflow execution |

## Example workflows

### Research only

> What are the requirements for a voice training dataset?

```mermaid
sequenceDiagram
    participant User
    participant Orchestrator
    participant Research as Research Agent
    participant RAG as RagPipeline

    User->>Orchestrator: research question
    Orchestrator->>Research: A2A task
    Research->>RAG: retrieve
    RAG-->>Research: answer + sources
    Research-->>Orchestrator: A2A result
    Orchestrator-->>User: answer
```

### Voice only

> Start a voice run for this video.

```mermaid
sequenceDiagram
    participant User
    participant Orchestrator
    participant Voice as Voice Agent
    participant Factory as Voice Factory

    User->>Orchestrator: start voice run
    Orchestrator->>Voice: A2A task
    Voice->>Factory: voice API call
    Factory-->>Voice: run id + status
    Voice-->>Orchestrator: A2A result
    Orchestrator-->>User: run id + status
```

### Research and voice

> Check the training requirements, then tell me if this run is ready for training.

```mermaid
sequenceDiagram
    participant User
    participant Orchestrator
    participant Research as Research Agent
    participant Voice as Voice Agent

    User->>Orchestrator: combined request
    Orchestrator->>Research: A2A task
    Orchestrator->>Voice: A2A task
    Research-->>Orchestrator: A2A result
    Voice-->>Orchestrator: A2A result
    Orchestrator-->>User: combined response
```

The two specialists remain independent; the Orchestrator combines results.

### Operational diagnosis — the reference demonstration

> Why is this voice training run taking so long?

```mermaid
sequenceDiagram
    participant User
    participant Orchestrator
    participant Voice as Voice Agent
    participant Research as Research Agent

    User->>Orchestrator: why is this run slow?
    Orchestrator->>Voice: A2A task — run status + training data
    Voice-->>Orchestrator: A2A result
    Orchestrator->>Research: A2A task — troubleshooting docs
    Research-->>Orchestrator: A2A result
    Orchestrator-->>User: combined explanation
```

This is the primary demonstration of useful multi-agent collaboration and
the basis of `SPEC.md`'s Success signal.

## Trace shape

```text
AG-UI request
  -> Orchestrator
  -> A2A client
  -> Specialist Agent
  -> Specialist tools
  -> A2A response
  -> Orchestrator
```

Recorded per span: `agent.name`, `agent.skill`, `a2a.task_id`,
`a2a.context_id`, `a2a.target`, `a2a.status`. No secrets, no hidden model
reasoning.
