---
id: SPEC-copilotkit-hook-surface
companions:
  - brownfield.md
  - hook-policy.md
  - implementation-plan.md
  - verification.md
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate. Source documents listed in frontmatter are for traceability — consult them only if you need narrative rationale or prose color this contract intentionally omits.

# CopilotKit Hook Surface

## Why

The application exists to show AG-UI and the CopilotKit hooks, but uses only one: `useAgentContext` hands the agent a run list and nothing else. The agent reads a summary and does nothing — it cannot see what the user sees, and it cannot do what the user does. This closes that gap for the hook policy and plumbing that hold regardless of view design, while deferring the concrete tool inventory until `spec-videos-and-voices-views` lands and rewrites the action set this spec would otherwise target. See `brownfield.md` for the verified evidence behind the gap.

## Capabilities

- **CAP-1**
  - **intent:** Read-only state the agent needs — which run is open, and which action is legal in each ingestion phase — is published into the prompt via `useAgentContext`, placed in the component that owns the data so a collapsed card publishes no context.
  - **success:** Asking the agent which run is open names the expanded one. Collapsing every card means the agent no longer reports clip detail.

- **CAP-2**
  - **intent:** The agent can run a cheap, reversible browser action — expanding a run — proving the outbound tool loop end to end against `spec-agui-tool-loop`.
  - **success:** Asking the agent to open a different run causes that run's card to expand in the browser.

- **CAP-3**
  - **intent:** Starter prompt suggestions are seeded from the runs currently on screen, so they stay relevant as the run list changes.
  - **success:** Suggestions shown to the user change when the set of runs on screen changes.

- **CAP-4**
  - **intent:** A visible run-status indicator shows the agent is working, sourced from `useAgent`.
  - **success:** The sidebar header reflects the agent's run status (working vs. idle) during an active run.

## Constraints

- Every hook choice follows the fixed Need-to-Hook policy table. It is stable and does not change when `spec-videos-and-voices-views` lands. See `hook-policy.md`.
- The v1 hooks `useCopilotReadable` and `useCopilotAction` do not exist in `@copilotkit/react-core/v2` and must never be used. See `hook-policy.md` for the translation mapping.
- Placement rule: `useAgentContext` lives in the component that owns the data, not in one central file, so the agent sees exactly what the screen shows and no more.

## Non-goals

- The concrete Phase 2 tool inventory — classifying each Videos/Voices view action as `useFrontendTool` or `useHumanInTheLoop` — is out of scope for this pass. Writing it against today's `approve_run` would produce a spec that `spec-videos-and-voices-views` deletes. See Open Questions.
- The pythonapi tool-call plumbing itself does not change here; that is `spec-agui-tool-loop`, which this spec depends on.

## Success signal

With the selected run published as context and the phase-legality context in place, asking the agent "which run is open" names the expanded one, and asking it to open a different run expands that card. Suggestions update as the visible run list changes, and the sidebar shows the agent working during a run.

## Assumptions

None — the source design was concrete enough to distill directly.

## Open Questions

- Once `spec-videos-and-voices-views` lands, what is the concrete tool inventory for the new Videos and Voices actions, classified by the policy table in `hook-policy.md` — which become `useFrontendTool` (reversible) and which become `useHumanInTheLoop` (costly or destructive, e.g. commit assignments, train, discard)?
