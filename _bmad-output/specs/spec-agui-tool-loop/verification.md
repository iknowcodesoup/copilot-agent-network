# Verification — AG-UI Tool Loop

- [ ] A run with no tools behaves exactly as it does today. (CAP-1)
- [ ] A tool call emits Start, then Args, then End, in that order. (CAP-2)
- [ ] Argument fragments reassemble into the JSON the model sent. (CAP-2)
- [ ] A turn with text and a tool call emits both, and opens one text message. (CAP-4)
- [ ] A follow-up run carrying a `tool` message produces a final text answer. (CAP-3)
- [ ] A model that keeps calling tools stops at `LLM_MAX_TOOL_TURNS`. (CAP-5)
- [ ] End to end: register one throwaway frontend tool in the browser, ask for it, and read the answer in the chat.
- [ ] `nx test pythonapi` passes.
