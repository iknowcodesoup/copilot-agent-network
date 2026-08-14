# Epic 1 Context: Agent Tool-Calling on the Voices Dashboard

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

This epic closes the agent's tool-calling loop end to end, backend and frontend together. Today a tool the browser registers is invisible to the model: the completion call never passes it through and never emits a tool-call event. This epic makes the backend forward registered tool definitions to the model and stream back correctly ordered tool-call events, then wires the Voices dashboard to register one frontend tool (expanding a run), publish phase-aware context about what's on screen, seed suggestions from visible runs, and show whether the agent is working or idle. It matters because the backend half alone has no user-visible outcome — only the full loop lets an evaluator ask the agent to act on the dashboard and get a state-aware answer back, which is what proves the agent can perceive and act on the UI rather than only narrate it.

## Stories

- Story 1.1: Forward Tool Definitions and Stream Tool-Call Events
- Story 1.2: Cap Runaway Tool-Calling
- Story 1.3: Publish Run and Phase Context to the Agent
- Story 1.4: Let the Agent Expand a Run
- Story 1.5: Seed Starter Suggestions From Visible Runs
- Story 1.6: Show Agent Working/Idle Status

## Requirements & Constraints

- Tool definitions on the incoming request must map to the model's tool-calling shape with automatic tool choice; a request with no tools must behave exactly as today (FR1).
- A model tool call must stream as a start event, one or more ordered argument-delta events, then an end event, with reassembled argument text matching exactly what the model sent (FR2).
- Once tool calls are emitted the server ends the run and takes no further action — it never blocks waiting for a tool result, because frontend tools execute in the browser (FR3).
- The text-message-start event fires only on the first non-empty content delta, so a tool-only turn opens no empty text message and a mixed turn opens exactly one (FR4).
- A tool-calling turn count, computed statelessly from the conversation's messages, is capped by a configurable setting with a real default: a count at the limit is still allowed, a count past it forces a text answer instead of another tool call (FR5).
- The chat agent module's docstring must be rewritten to state tools are supported, replacing outdated text that says otherwise (FR6).
- The currently expanded/selected run is published as read-only agent context, so asking "which run is open" names it correctly (FR7).
- A static, read-only context payload describes each ingestion phase and which actions are legal in it (FR8).
- Context placement follows the owning UI component: collapsing a run card removes that run's context, and the agent stops referencing that run's detail afterward (FR9).
- Exactly one frontend tool lets the agent expand a specified run, wherever runs are currently listed in the UI (FR10).
- Starter prompt suggestions reseed from the runs currently visible on screen whenever that visible set changes (FR11).
- The tool loop stays fully async — no new blocking calls anywhere in it (NFR1).
- Hook selection follows a fixed, binding policy, not a style preference: read-only state uses the context hook, a reversible action uses the frontend-tool hook, a costly/destructive action would use the human-in-the-loop hook, a server-tool custom UI would use the render-tool hook, starter prompts use the suggestions hook, and status uses the agent-status hook. Older CopilotKit v1 hooks are banned from new code (NFR2).
- No server-side tool execution and no synchronous waiting on a tool result — frontend tools run in the browser only.
- The working/idle status indicator (Story 1.6) is a real, testable requirement despite carrying no FR number — deprioritized to acceptance-criterion level, not because it's untestable.
- Live-session success test for this epic: an evaluator asks the agent to expand a run and gets a correct, state-aware follow-up answer, with no manual UI interaction in between. Watch for the counter-signal: a tool-call turn count climbing routinely toward the cap means thrashing, not capability.

## Technical Decisions

- The HTTP route that accepts the agent run is unaffected; the change is entirely in how the completion call and event stream are built beneath it.
- The backend half shares no dependency with the voice-pipeline work and could run in parallel with it, but story order within this epic still matters: no frontend story delivers a working tool call until the backend forwards tool definitions and streams tool-call events first.
- Every piece of on-screen state the agent needs is a maintained context or tool hook pair — a second surface that must keep tracking the UI as it evolves, not just the UI itself.

## UX & Interaction Patterns

- Primary flow (realizes both user journeys this epic targets): an evaluator on the Voices dashboard asks the agent, in the sidebar, to open a specific run (e.g., "the latest video"). The agent expands that run's card in the browser directly — no page reload, no click from the user. With the run expanded, the evaluator asks what they can do with it right now, and the agent answers from that run's actual ingestion phase rather than a generic capability list. Collapsing the card makes the agent stop referencing that run's detail.
- The chat sidebar header reflects whether the agent is actively working or idle during a run.
- Starter prompt suggestions shown in the chat sidebar track whatever runs are currently visible on the dashboard.

## Cross-Story Dependencies

- Stories 1.3 through 1.6 (frontend) depend on Story 1.1 (backend tool forwarding and event streaming) shipping first — no frontend tool call can succeed until the backend forwards tool definitions to the model.
- This epic as a whole is built last in the overall workspace build order, after the epics that rework the Videos/Voices dashboard itself. That lets this epic's frontend hooks target the dashboard's final shape directly, with no separate rework story needed later.
- The concrete tool inventory for further dashboard actions (assign, commit, discard, train) and how each should classify under the hook policy is an explicitly open question deferred beyond this epic — do not build against it here.
