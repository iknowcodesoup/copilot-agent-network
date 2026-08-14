---
input: spec-copilotkit-hook-surface (SPEC.md, brownfield.md, hook-policy.md, implementation-plan.md, verification.md, .memlog.md)
checked against: prd.md §4.2 (FR-7–FR-11), cross-checked with §5, §6.1/§6.2, §7, §8
verdict: faithful compression overall — 3 minor gaps, no overclaiming
---

# Reconciliation — CopilotKit Hook Surface

## Summary

FR-7 through FR-11 map cleanly onto the spec's CAP-1, CAP-2, CAP-3, and the
placement rule. The Phase-2 deferral non-goal and its open question both
carry forward into PRD §5/§6.2/§8 accurately. No PRD assertion in §4.2 claims
anything the source spec does not support. Three minor gaps found, each a
one-line fix — none block the finalize step.

## Gaps

### 1. The status-indicator rationale is inaccurate, not just the omission

PRD §4.2's `[NOTE FOR PM]` excuses leaving the working/idle indicator
unnumbered because it is "a status-display detail, not a testable
capability." SPEC.md's CAP-4 has the same shape as CAP-1–CAP-3 (which *did*
become FR-7/8, FR-10, FR-11): an intent line and an explicit success
line — "The sidebar header reflects the agent's run status (working vs.
idle) during an active run." That is testable; it's only `verification.md`
that never turns it into a checklist item (a gap in the spec itself, not the
PRD). Leaving CAP-4 out of the numbered FRs is a defensible altitude call —
but the stated reason is false on the spec's own text.

**Fix:** Reword the note to something like "deprioritized as an
acceptance-criterion-level item, not because it's untestable" — or just
promote it to an FR/consequence alongside FR-7–FR-11 to match its siblings.

### 2. One of the spec's two non-goals has no PRD counterpart

SPEC.md's Non-goals list two items: (a) the deferred Phase 2 tool inventory
— captured in PRD §4.2 Out of Scope, §5, and §6.2 — and (b) "The pythonapi
tool-call plumbing itself does not change here; that is `spec-agui-tool-loop`,
which this spec depends on." Item (b) has no explicit line anywhere in PRD
§4.2 or §5. The 4.1/4.2 split description implies it, but the boundary is
never stated the way the Phase-2 deferral is.

**Fix:** Add a bullet to §4.2 Out of Scope or §5: "4.2 does not modify
pythonapi's tool-call handling — that is 4.1's scope entirely."

### 3. Hard constraints are demoted to prose "Notes" instead of a peer NFR block

SPEC.md's Constraints section (fixed Need-to-Hook policy table, the v1-hook
ban, the placement rule) are binding and explicitly "stable" — they don't
change with future work on this dashboard. Every other feature in the PRD
(4.1, 4.3, 4.4) gets its constraints promoted to a "Feature-specific NFRs"
subsection. 4.2 has no such subsection; the policy table and v1-hook ban
live only in an informal "Notes" bullet. A reader generating epics/stories
from this PRD could reasonably read "Notes" as advisory color rather than a
hard rule, which is the opposite of how the source spec frames it.

**Fix:** Retitle (or duplicate) the hook-policy/v1-ban bullet as a
"Feature-specific NFRs" subsection under 4.2, matching the other four
features' treatment.

## Confirmed non-issues

- **Status-indicator scope:** still listed in §6.1 MVP Scope ("4.2 Phase 1:
  ... status indicator") despite having no FR number, so nothing is actually
  dropped from scope — only gap 1's rationale wording is off.
- **Open Question 1 (§8):** faithfully mirrors SPEC.md's Open Question,
  including the `useFrontendTool` vs. `useHumanInTheLoop` framing and the
  commit/train/discard examples.
- **Overclaiming:** none found. Every FR-7–FR-11 assertion traces directly to
  a SPEC.md capability, the placement-rule constraint, or an
  implementation-plan line; nothing in §4.2 exceeds what the source spec
  supports.
