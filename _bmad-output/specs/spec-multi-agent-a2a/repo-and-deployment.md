# Repository Structure and Deployment

Proposed layout, local dev topology, and the Research Agent's seed corpus.
This is HOW/layout detail — the module names and paths may change if they
fit the existing architecture better; the boundaries in `agent-contracts.md`
are what's load-bearing.

## Proposed repository structure

```text
apps/
  pythonapi/
    pythonapi/
      agents/
        orchestrator/
        research/
        voice/
      a2a/
        client.py
        models.py
        discovery.py
      ...

  agentic-executor/
    ...

specs/
  multi-agent-a2a.md
```

Do not create a new application for every agent unless deployment isolation
requires it. Separate agent boundaries logically first; run them in separate
processes only if required to prove remote A2A communication.

## Local development topology

```text
orchestrator:8000
research-agent:8001
voice-agent:8002
```

Specialist agents should be independently startable. The Orchestrator
should discover their Agent Cards from configuration — do not hard-code
specialist capabilities in the router when Agent Card discovery can provide
them. No service-discovery infrastructure is required; a configured URL is
enough:

```text
RESEARCH_AGENT_A2A_URL=http://research-agent:8001
VOICE_AGENT_A2A_URL=http://voice-agent:8002
```

## Research Agent seed corpus

The RAG pipeline has no required business dependency on the voice workflow
— do not create an artificial one. Add a small documentation corpus so the
Research Agent is useful even with no voice run active. Suggested tree
(exact location may differ):

```text
docs/
  voice-training/
    dataset-requirements.md
    diarization.md
    piper-training.md
    troubleshooting.md
  architecture/
    agent-network.md
    voice-agent.md
    research-agent.md
  operations/
    training-runs.md
    troubleshooting.md
```

The requirement is that the documents are real project knowledge, not
placeholder text — see `SPEC.md` Open Questions for who authors them.

## README (Phase 6)

Update the README to show: AG-UI, Orchestrator, A2A, Research Agent, Voice
Agent, RAG, Voice Factory — and document why each protocol exists. Do not
claim that RAG is part of normal voice processing.
