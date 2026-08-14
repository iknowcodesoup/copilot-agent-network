# Hook Policy — CopilotKit Hook Surface

This policy is stable. It does not change when `spec-videos-and-voices-views` lands.

## Need-to-hook table

| Need | Hook | Rule |
| --- | --- | --- |
| Read-only state into the prompt | `useAgentContext` | No side effect |
| Agent runs a browser function | `useFrontendTool` | Cheap and reversible |
| Agent proposes, a person approves | `useHumanInTheLoop` | Costly or destructive |
| Custom UI for a server-run tool | `useRenderTool` | Later, when RAG tools move |
| Starter prompts | `useConfigureSuggestions` | Seeded from current state |
| Run status indicator | `useAgent` | Shows the agent is working |

## The version trap

`useCopilotReadable` and `useCopilotAction` are v1 hooks. `@copilotkit/react-core/v2` does not export them. Translate every doc snippet:

- `useCopilotReadable` becomes `useAgentContext`.
- `useCopilotAction` with a `handler` becomes `useFrontendTool`.
- `useCopilotAction` with `renderAndWaitForResponse` becomes `useHumanInTheLoop`.

## Placement rule

Put `useAgentContext` in the component that owns the data, not in one central file. A shut card mounts none of its children, so a shut card publishes no context. The agent then sees what the screen shows, and no more.
