---
name: leanspec-workflow
description: This skill provides guidance for creating, updating, and managing LeanSpec specifications. Use this skill when working with specs, using LeanSpec CLI/MCP tools, tracking implementation status, or understanding spec dependencies.
---

## Steps

### 1. Check Project Status

Before any spec work, always check context first:

```bash
leanspec board    # View project state
leanspec search "topic"  # Find related specs
```

### 2. Managing Specs

| Action         | MCP Tool | CLI Fallback                                   |
| -------------- | -------- | ---------------------------------------------- |
| Project status | `board`  | `leanspec board`                              |
| List specs     | `list`   | `leanspec list`                               |
| Search specs   | `search` | `leanspec search "query"`                     |
| View spec      | `view`   | `leanspec view <spec>`                        |
| Create spec    | `create` | `leanspec create <name>`                      |
| Update spec    | `update` | `leanspec update <spec> --status <status>`    |
| Link specs     | `link`   | `leanspec link <spec> --depends-on <other>`   |
| Unlink specs   | `unlink` | `leanspec unlink <spec> --depends-on <other>` |
| Dependencies   | `deps`   | `leanspec deps <spec>`                        |
| Token count    | `tokens` | `leanspec tokens <spec>`                      |

### 3. Core Rules

| Rule                                | Details                                                                                                               |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| **NEVER edit frontmatter manually** | Use `update`, `link`, `unlink` for: `status`, `priority`, `tags`, `assignee`, `transitions`, timestamps, `depends_on` |
| **ALWAYS link spec references**     | Content mentions another spec -> `leanspec link <spec> --depends-on <other>`                                         |
| **Track status transitions**        | `planned` -> `in-progress` (before coding) -> `complete` (after done)                                                 |
| **No nested code blocks**           | Use indentation instead                                                                                               |

### 4. SDD Workflow

```
BEFORE: board -> search -> check existing specs
DURING: update status to in-progress -> code -> document decisions -> link dependencies
AFTER:  update status to complete -> document learnings
```

**Status tracks implementation, NOT spec writing.**

### 5. Update Specs During Implementation

Every 2-4 completed tasks, update the active spec:

1. **Save progress** - `leanspec update <spec>` to record completed items
2. **Document decisions** - Add notes about implementation choices made
3. **Update checklist** - Mark completed items in the Plan section
4. **Track blockers** - Note any issues encountered

### 6. Token Thresholds

| Tokens      | Status             |
| ----------- | ------------------ |
| <2,000      | Optimal            |
| 2,000-3,500 | Good               |
| 3,500-5,000 | Consider splitting |
| >5,000      | Must split         |

### 7. When to Use Specs

| Write spec          | Skip spec                  |
| ------------------- | -------------------------- |
| Multi-part features | Bug fixes                  |
| Breaking changes    | Trivial changes            |
| Design decisions    | Self-explanatory refactors |

## Common Mistakes

| Don't                      | Do Instead                            |
| -------------------------- | ------------------------------------- |
| Create spec files manually | Use `create` tool                     |
| Skip discovery             | Run `board` and `search` first        |
| Leave status as "planned"  | Update to `in-progress` before coding |
| Edit frontmatter manually  | Use `update` tool                     |

## First Principles (Priority Order)

1. **Context Economy** - <2,000 tokens optimal, >3,500 needs splitting
2. **Signal-to-Noise** - Every word must inform a decision
3. **Intent Over Implementation** - Capture why, let how emerge
4. **Bridge the Gap** - Both human and AI must understand
5. **Progressive Disclosure** - Add complexity only when pain is felt
