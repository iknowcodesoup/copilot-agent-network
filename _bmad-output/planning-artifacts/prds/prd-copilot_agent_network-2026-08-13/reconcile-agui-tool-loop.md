---
input: spec-agui-tool-loop
prd_section: "PRD §4.1 Agent Tool-Calling Loop (FR-1–FR-6)"
checked: 2026-08-13
---

# Reconciliation: spec-agui-tool-loop → PRD §4.1

## Verdict

Faithful compression. All five spec capabilities (CAP-1–CAP-5) and all three
constraints map cleanly onto FR-1–FR-6, with no dropped testable behavior, no
overclaiming, and correct handling of the spec's empty Assumptions/Open
Questions sections (nothing to carry forward, and the PRD carries forward
nothing — consistent). Two low-materiality gaps found, both nitpicks rather
than substantive loss.

## Gaps

### 1. FR-5's turn-cap boundary is worded more loosely than the spec's

**Spec (CAP-5 success):** "the server answers with text instead of another
tool call once the count **exceeds** `LLM_MAX_TOOL_TURNS`" — an explicit,
unambiguous boundary (allowed at the limit, blocked past it).

**PRD (FR-5):** "capped at `LLM_MAX_TOOL_TURNS`" — this phrasing does not say
whether a turn count equal to the limit is the last one allowed or the first
one blocked. Since this FR will likely seed acceptance criteria for a story,
the ambiguity risks an off-by-one implementation.

**Fix:** Reword FR-5 to match the spec's precise language, e.g. "capped: past
`LLM_MAX_TOOL_TURNS` tool-calling turns, the server forces a text answer."

### 2. Spec's explicit non-goals aren't restated anywhere in the PRD

**Spec (Non-goals):** (a) `routes/agent.py` does not change; (b) this spec
touches no data model or screen, and is unaffected by (and does not affect)
`spec-video-scoped-ingestion`, `spec-multi-voice-data-model`, and
`spec-videos-and-voices-views`.

**PRD:** §4.1 and §5 state what 4.1 *does* (backend-only) but never state the
independence claim explicitly. It's inferable from the feature structure (no
dependency edge is drawn from 4.1 to 4.3/4.4/4.5), but a reader doing
epic/story sequencing has to infer parallelizability rather than read it.
(a) is pure implementation detail and is fine to leave out of a PRD.

**Fix:** Optional — add one clause to §5 Non-Goals: "4.1 shares no
dependency with the voice-pipeline threads (4.3–4.5); it can proceed in
parallel with them." Low priority; not a loss of testable content.

## Not gaps (checked and confirmed clean)

- All 5 CAPs → FR-1–FR-6, one-to-one, no watering down of success criteria.
- All 3 Constraints (Settings default, stateless/no-wait server, docstring
  rewrite) → FR-5, FR-3's Out of Scope note, and FR-6 respectively.
- Spec's Assumptions ("None") and Open Questions ("None") → PRD §8/§9 rightly
  carry forward nothing from this source.
- Cross-spec dependency note (4.2 needs 4.1 first) → captured verbatim in
  PRD §4.2's description.
- No PRD claim in §4.1 exceeds what the spec supports.
