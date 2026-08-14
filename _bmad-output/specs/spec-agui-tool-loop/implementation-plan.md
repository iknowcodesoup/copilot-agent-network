# Implementation Plan — AG-UI Tool Loop

Ordered technical steps toward the capabilities in `SPEC.md`. HOW detail; the kernel states WHAT and success only.

- [ ] Add `_to_openai_tools(tools)` to `chat_agent.py`. Map the AG-UI `Tool` shape (name, description, parameters) onto the OpenAI function shape. (CAP-1)
- [ ] Pass `tools=` and `tool_choice="auto"` only when the input carries tools. (CAP-1)
- [ ] Accumulate `delta.tool_calls` by index. Emit Start, Args, and End in order. (CAP-2)
- [ ] Open `TextMessageStartEvent` lazily, on the first non-empty content delta. (CAP-4)
- [ ] Add `LLM_MAX_TOOL_TURNS` to `Settings` in `config.py` with a real default. (CAP-5)
- [ ] Rewrite the module docstring. It states the opposite of the new behaviour.
