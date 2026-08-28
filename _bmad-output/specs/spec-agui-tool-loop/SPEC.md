---
id: SPEC-agui-tool-loop
companions:
  - brownfield.md
  - implementation-plan.md
  - verification.md
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate. Source documents listed in frontmatter are for traceability — consult them only if you need narrative rationale or prose color this contract intentionally omits.
>
> **Status: DELIVERED (2026-08-27).** Lives in `agents/orchestrator/chat_agent.py` (moved there by the multi-agent A2A build), not `core/chat_agent.py`. CAP-1 through CAP-4 met; `test_agent_tools.py` covers them. **CAP-5 (the `LLM_MAX_TOOL_TURNS` runaway cap) was dropped** — the Orchestrator ends its run after emitting tool calls, so there is no server-side loop to cap. See `_bmad-output/planning-artifacts/sprint-change-proposal-2026-08-27.md`.

# AG-UI Tool Loop

## Why

The chat agent cannot call a tool. The completion call passes no `tools=` argument and the generator never emits a `ToolCall*` event, so every tool the browser registers is invisible to the model — a pain that blocks the purpose of the application, since the agent must be able to execute the things a user can do. This spec builds the outbound half of the tool loop. It touches no data model and no screen, so `spec-video-scoped-ingestion`, `spec-multi-voice-data-model`, and `spec-videos-and-voices-views` neither affect it nor are affected by it. See `brownfield.md` for the verified evidence behind the gap and what already works.

## Capabilities

- **CAP-1**
  - **intent:** The chat agent forwards the AG-UI tool definitions it receives to the model, so a tool the browser registers is visible to the model.
  - **success:** A request carrying `agent_input.tools` maps them onto the OpenAI `tools=` shape with `tool_choice="auto"`. A request carrying no tools omits both arguments and behaves exactly as today.

- **CAP-2**
  - **intent:** When the model calls a tool, the agent emits a complete, correctly ordered AG-UI tool-call event sequence, reassembled from the OpenAI stream's per-index fragments.
  - **success:** A tool call emits `ToolCallStartEvent`, then one or more `ToolCallArgsEvent` in order, then `ToolCallEndEvent`, and the reassembled argument text equals what the model sent.

- **CAP-3**
  - **intent:** After emitting tool calls, the run ends rather than waiting, because a frontend tool runs in the browser and the server cannot run it.
  - **success:** `RunFinishedEvent` is emitted after the tool calls; the server issues no further action for that run. The browser is expected to POST a fresh `RunAgentInput` with the tool result appended to continue.

- **CAP-4**
  - **intent:** A text message only opens on screen when text actually arrives, so a tool-only turn does not leave an empty message in the transcript.
  - **success:** `TextMessageStartEvent` fires on the first non-empty content delta, not before. A turn carrying both text and a tool call emits both, with exactly one text message opened.

- **CAP-5**
  - **intent:** A model that keeps calling tools without producing a final answer is stopped after a configurable number of turns, so the loop cannot run away.
  - **success:** Counting assistant turns in `agent_input.messages` that end in a tool call, the server answers with text instead of another tool call once the count exceeds `LLM_MAX_TOOL_TURNS`. The count is derived from the message list, so the server stays stateless.

## Constraints

- `LLM_MAX_TOOL_TURNS` is a `Settings` field in `config.py` with a real default — not a bare `None`, per project convention that a missing setting must fail loudly at the config boundary, not silently at the call site.
- The server never waits for a tool result. CopilotKit runs frontend tools in the browser; the AG-UI contract for frontend tools is that the run ends and a new run starts, keeping each run independent and the server stateless.
- The module docstring in `chat_agent.py` currently states the agent cannot call tools — it must be rewritten as part of this change, or it will state the opposite of the new behavior.

## Non-goals

- `routes/agent.py` does not change; it already streams whatever the generator yields.
- No data model or screen changes here. `spec-video-scoped-ingestion`, `spec-multi-voice-data-model`, and `spec-videos-and-voices-views` are unaffected by this spec and do not affect it.

## Success signal

Register one throwaway frontend tool in the browser, ask the agent for it, and read the answer in the chat: the tool call streams as Start → Args → End, the run finishes, the browser executes the tool, a follow-up run carries the result, and the agent's final text answer reflects it.

## Assumptions

None — the source design was concrete enough to distill directly.

## Open Questions

None outstanding — the source spec resolved its design questions before this conversion.
