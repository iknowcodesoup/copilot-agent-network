# Agent Contracts

Per-agent MUST / MUST NOT catalog, skills, Agent Card requirements, and the
A2A task model. Referenced from `SPEC.md` CAP-1 through CAP-4.

## Orchestrator Agent

**MUST:**

- Receive user requests from the existing AG-UI endpoint.
- Classify the request at a high level into one of the routing categories below.
- Decide when to use the Research Agent.
- Decide when to use the Voice Agent.
- Support requests that require both agents.
- Return a final user-facing response.
- Hide specialist implementation details from the user.

**MUST NOT:**

- Implement document retrieval.
- Implement voice processing.
- Access Qdrant directly for delegated research.
- Access the voice factory directly for delegated voice work.
- Create an agent for every tool.

**Routing categories:**

```text
research
voice
research_and_voice
general
```

Deterministic rules first. An LLM router only when the request cannot be
classified safely with simple rules.

## Research Agent

**MUST:**

- Expose an A2A endpoint.
- Publish an Agent Card.
- Accept research questions.
- Use the existing `RagPipeline`.
- Return an answer with source references when available.
- Return a clear no-results response when the corpus has no relevant content.

**MUST NOT:**

- Start voice runs.
- Modify voice run state.
- Call the voice factory.
- Become a general-purpose autonomous agent.

**Skill:** `research`

**Example request:**

> Research the repository documentation for the requirements for voice training.

**Example result:**

```json
{
  "answer": "Voice training requires ...",
  "sources": [
    {
      "document_id": "doc-123",
      "title": "piper-training.md"
    }
  ]
}
```

## Voice Agent

**MUST:**

- Expose an A2A endpoint.
- Publish an Agent Card.
- Accept voice workflow requests.
- Use the existing voice API and voice factory.
- Preserve the existing durable run state model.
- Support human review where the current workflow requires it.
- Return run identifiers and status information.

**MUST NOT:**

- Own the RAG pipeline.
- Query Qdrant for normal voice operations.
- Duplicate voice run persistence.
- Replace the existing voice reconciler.

**Skills:**

```text
voice_search
voice_run
voice_status
voice_review
```

## Agent Card (both specialists)

Use the current released A2A specification supported by the selected SDK;
pin the SDK and protocol version at implementation time. No custom JSON
protocol may be presented as A2A.

Well-known location:

```text
/.well-known/agent-card.json
```

Each Agent Card must declare:

- Agent name.
- Agent description.
- Service URL.
- Protocol version.
- Supported capabilities.
- Supported skills.
- Input modes.
- Output modes.

Use standard A2A task operations supported by the selected SDK — at minimum
message send, task retrieval, and task cancellation. Use streaming only if
it reduces implementation complexity. Do not implement push notifications
in the first version.

## Task Model

A delegated task must have:

- A unique task ID.
- A correlation ID or context ID.
- A clear input.
- A clear result.
- A terminal state.

The Orchestrator records, per task:

```text
user request
orchestrator decision
target agent
A2A task ID
task result
final response
```

Never full agent reasoning. Never hidden chain-of-thought.

## Security

- The first local implementation may use unauthenticated internal A2A calls.
- Production configuration must support authenticated A2A calls.
- Agent Cards must not contain secrets.
- Network access should restrict specialist agents to trusted callers.
- Validate all A2A inputs before execution.
- Do not allow a remote agent to call arbitrary local functions.

## Design rule

Use an agent when the component has an independent capability and a useful
agent boundary. Use a normal function or service when it does not. Favor
simple boundaries over agent count — the system must demonstrate that A2A
provides value, and must never use A2A as decoration.
