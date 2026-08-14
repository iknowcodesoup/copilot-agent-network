---
input: spec-video-scoped-ingestion (SPEC.md, brownfield.md, implementation-plan.md, verification.md, .memlog.md)
target: prd.md §4.3 Video-Scoped Ingestion (FR-12–FR-15), §5, §8
checked: 2026-08-13
---

# Reconciliation: spec-video-scoped-ingestion → PRD §4.3

## Confirmed correct (no fix needed)

- **Open Question 2 (§8)** carries the migration-path question forward accurately. The PRD's wording ("programmatic move vs. accept one-time re-ingest in development") matches the spec's Open Questions entry word for word in substance. No gap here.
- FR-12 (CAP-1), FR-13 (CAP-2), FR-14's payload shape, and FR-15 (CAP-4) each map cleanly to their source capability with no dropped testable behavior.

## Gaps found

### Gap 1 — NFR misnames one of the five gateway routes
The spec (brownfield.md, implementation-plan.md, and .memlog.md all agree) names the five `VoiceFactoryGateway` call sites this feature breaks as: `get_clips`, `update_clips`, `set_speaker_map`, `get_training_progress`, `stream_clip_audio` — and notes `get_training_progress` is the one route that stays character-scoped (does not move). The PRD's FR-15 NFR drops `get_training_progress` and substitutes an unnamed **"ingestion-trigger route"** that appears nowhere in the spec, brownfield notes, implementation plan, or memlog.
**Fix:** In the FR-15 NFR, replace "stream_clip_audio, plus the ingestion-trigger route" with "stream_clip_audio, and get_training_progress (the only one that stays character-scoped)."

### Gap 2 — 4.3's own non-goals are missing or mislabeled
The spec's Non-goals section lists three items specific to this feature: (a) not rebuilding multi-character clip routing (already works, only the file location moves), (b) not changing the `JobRequest` data model (the character field is already optional), (c) not touching the `voices`/`voice_contributions` tables (owned by 4.4). The PRD's §5 captures only (a), and tags it to **(4.4)** instead of (4.3) — the non-goal is about `spec-video-scoped-ingestion` not rebuilding routing, not about the data-model split. (b) is absent from the PRD entirely.
**Fix:** Add a 4.3 "Out of Scope" note (matching the pattern already used in 4.2/4.5) covering both (a) and (b), and correct the §5 bullet's feature tag from (4.4) to (4.3).

### Gap 3 — §4.3 description overclaims "voices" where the spec says "characters"
The spec's Non-goals explicitly excludes the Voice entity model from this spec's scope ("The pythonapi data model split — that is owned by spec-multi-voice-data-model"), and CAP-3 / FR-14 itself both use "character," matching the commit payload shape `{video_id: {speaker_label: character}}`. But the PRD's 4.3 description preamble says the commit "route[s] speaker labels from one or more videos to **multiple voices** at once." At the point 4.3 ships alone (before 4.4 lands), there is no durable Voice entity to route into — only character-scoped datasets. This is an internal inconsistency (FR-14's own body says "characters") and an overclaim relative to what the spec supports.
**Fix:** Change "multiple voices" to "multiple characters" in the 4.3 description sentence, consistent with FR-14 and the spec's own non-goal.

### Gap 4 (minor) — no success metric covers the breaking-change repair itself
The spec's own "Success signal" includes the `/voices` dashboard continuing to load clip lists, speaker maps, and clip audio once pointed at the moved routes — this is a distinct, testable acceptance check (also verification.md's last line). The PRD's §7 success metrics validate FR-12 (SM-3) but nothing validates that the gateway migration itself leaves the dashboard functional.
**Fix:** Extend SM-3 (or add SM-4) to cover: "The Voices dashboard, pointed at the moved routes, still loads clip lists, speaker maps, and clip audio."
