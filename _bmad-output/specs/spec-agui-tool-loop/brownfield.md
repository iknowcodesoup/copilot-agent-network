# Brownfield Notes — AG-UI Tool Loop

## Current gap

The chat agent cannot call a tool. The docstring in `core/chat_agent.py` (lines 8-12) says so, and the code proves it: the completion call (lines 56-60) passes no `tools=` argument, and the generator never emits a `ToolCall*` event. So every tool the browser registers is invisible to the model. Register twenty and none can fire.

## Already built — do not rebuild

`_to_openai_messages` (lines 80-113) handles `role == "tool"` and copies `tool_calls` onto the assistant message. The inbound half is built. `routes/agent.py` needs no change — it streams whatever the generator yields.

## Why the client resumes (design rationale)

CopilotKit runs a frontend tool in the browser. The server cannot run it. So the run must end and a new run must start. That is the AG-UI contract for frontend tools, and it keeps each run independent.

## Cross-spec note

`spec-copilotkit-hook-surface` depends on this spec. No frontend hook can work until this lands.
