---
name: leanspec-sdd
description: Spec-Driven Development methodology for AI-assisted development. Use when working in a LeanSpec project.
compatibility: Requires leanspec CLI or @leanspec/mcp server
metadata:
  author: LeanSpec
  version: 0.1.0
  homepage: https://leanspec.dev
---

# LeanSpec SDD Skill

Teach agents how to run Spec-Driven Development (SDD) in LeanSpec projects. This skill is an addon: it **does not replace** MCP or CLI tools.

## When to Use This Skill

Activate this skill when any of the following are true:

- The repository contains a specs/ folder or .lean-spec/config.json
- The user mentions LeanSpec, specs, SDD, or spec-driven planning
- The task requires multi-step changes, breaking changes, or design decisions

## Core Principles

1. **Context Economy**: Keep specs under 2000 tokens when possible. Split large specs.
2. **Discovery First**: Always run board/search before creating new specs.
3. **Intent Over Implementation**: Capture why first, then how.
4. **Progressive Disclosure**: Keep SKILL.md concise; use references for details.
5. **No Manual Frontmatter**: Use tools to update status, tags, dependencies.

## Core SDD Workflow

### 1) Discover

- Get the project state: run `board` (or `leanspec board`).
- Search for related work before creating anything: `search` (or `leanspec search "query"`).

### 2) Design

- If a spec is needed, create it with `create` (or `leanspec create`).
- Prefer standard templates and keep scope clear.
- Validate token count using `tokens` (or `leanspec tokens`).

### 3) Implement

- Update spec status to `in-progress` **before coding**.
- Document decisions and progress **inside the spec** as work happens.
- Link dependencies using `link`/`unlink` as they are discovered.

### 4) Validate & Complete

- Run `validate` (or `leanspec validate`) before completion.
- Ensure all checklist items are checked.
- Update status to `complete` only when criteria are met.

## Tool Reference

Use MCP tools when available. Use CLI as fallback.

| Action         | MCP Tool          | CLI Command                                 |
| -------------- | ----------------- | ------------------------------------------- |
| Project status | `board`           | `leanspec board`                            |
| List specs     | `list`            | `leanspec list`                             |
| Search specs   | `search`          | `leanspec search "query"`                   |
| View spec      | `view`            | `leanspec view <spec>`                      |
| Create spec    | `create`          | `leanspec create <name>`                    |
| Update status  | `update`          | `leanspec update <spec> --status <status>`  |
| Dependencies   | `deps`            | `leanspec deps <spec>`                      |
| Link / unlink  | `link` / `unlink` | `leanspec link <spec> --depends-on <other>` |
| Token count    | `tokens`          | `leanspec tokens <spec>`                    |
| Validate       | `validate`        | `leanspec validate`                         |

## Best Practices (Summary)

- Keep AGENTS.md **project-specific only**; put SDD methodology here.
- Never create spec files manually; use `create`.
- Keep specs short and focused; split when >2000 tokens.
- Always check dependencies and link specs that block each other.
- Document trade-offs and decisions as they happen.

See detailed guidance in:

- [references/WORKFLOW.md](./references/WORKFLOW.md)
- [references/BEST-PRACTICES.md](./references/BEST-PRACTICES.md)
- [references/EXAMPLES.md](./references/EXAMPLES.md)

## Setup & Activation

### Project-level installation

Place this folder in:

- $PROJECT_ROOT/.lean-spec/skills/leanspec-sdd/

### User-level installation (optional)

Agent-specific skill folders may include:

- ~/.codex/skills/leanspec-sdd/
- ~/.cursor/skills/leanspec-sdd/

Exact paths vary by tool. See https://agentskills.io for current locations.

### Auto-activation hints

If the tool supports auto-activation, detect:

- .lean-spec/config.json
- specs/ folder
- AGENTS.md referencing the skill

## Compatibility Notes

- Works with any Agent Skills-compatible tool (Claude, Cursor, Codex, Letta, Factory).
- Requires either LeanSpec MCP tools or CLI access to manage specs.
- This skill is additive and does not change existing LeanSpec tooling.
