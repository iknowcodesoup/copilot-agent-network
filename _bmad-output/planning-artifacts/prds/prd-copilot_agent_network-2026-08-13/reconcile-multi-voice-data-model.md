---
title: Reconciliation — Multi-Voice Data Model
prd_section: §4.4, §5, §9
source: _bmad-output/specs/spec-multi-voice-data-model/ (SPEC.md, brownfield.md, implementation-plan.md, verification.md, data-model.md, .memlog.md)
checked: 2026-08-13
---

# Reconciliation — Multi-Voice Data Model

**Input:** `spec-multi-voice-data-model` (SPEC.md + 4 companions) vs. PRD §4.4 "Multi-Voice Data Model" (FR-16–FR-22), §5 Non-Goals, §9 Assumptions Index.

**Verdict:** Mostly faithful compression. FR-16 through FR-22 map cleanly to CAP-1 through CAP-5, and FR-20's `[ASSUMPTION]` tag correctly mirrors the spec's own Assumptions section (both treat the explicit-trigger and auto-trigger-on-first-contribution paths as intentionally concurrent, not a placeholder — no gap there). Three gaps found below.

## Gaps

1. **Backwards schema claim: PRD says `voice_runs` "gains columns," spec says it is trimmed.**
   PRD §4.4's Feature-specific NFR states: *"The `voice_runs` table gains columns for this change and is dropped/recreated in development."* The same phrase repeats in §5 Non-Goals ("No migration tooling ... for the `voice_runs` schema change"). The spec says the opposite: `voice_runs` "is trimmed, not dropped: it keeps only `id, source_url, video_id, video_title, ingest_phase, speaker_map (JSONB)`. Training-related columns move to `voices`" (SPEC.md Constraints; confirmed in `data-model.md`'s "Trimmed table" section, which lists `primary_character`, `phase`, `checkpoint_path`, and training-stage columns as *dropped* from `voice_runs`, not added). This reads like phrasing carried over from an unrelated, already-shipped `voice_runs` change (the webhook/lease columns described in the root `CLAUDE.md`), misapplied here. It inverts the direction of the schema change.
   **Fix:** Change both occurrences to something like: *"`voice_runs` is trimmed (training-related columns move to the new `voices` table); `voices` and `voice_contributions` are new tables created via `Base.metadata.create_all`."* Drop the "dropped/recreated in development" claim unless it's independently confirmed — the spec's own `Base.metadata.create_all` constraint is scoped to "the new tables," not to altering `voice_runs`.

2. **Two of the spec's three explicit non-goals aren't restated in PRD §5.**
   SPEC.md's Non-goals section lists three items: (a) multi-character clip-merge logic doesn't change, (b) *"the frontend does not change here"* (owned by `spec-videos-and-voices-views`), and (c) *"the video-scoped filesystem layout and gateway routes do not change here"* (owned by `spec-video-scoped-ingestion`). PRD §5 restates only (a). Items (b) and (c) are implied indirectly through §4.4's description ("Depends on 4.3 for its gateway contract and filesystem layout," "upstream dependency for 4.5") but never appear as explicit non-goals, so a reader scanning §5 alone would miss that 4.4 itself touches neither the frontend nor the filesystem/gateway layer.
   **Fix:** Add two bullets to §5: "No frontend or UI change is made in 4.4 — that is 4.5's scope" and "No change to the video-scoped filesystem layout or gateway routes in 4.4 — that is 4.3's scope."

3. **`POST /voices` (create) and `GET /voices/{id}` (fetch + contributions) aren't named as testable FRs, unlike assign/commit/train.**
   `data-model.md`'s Routes section lists five routes: `assign`, `commit`, `train`, plus `POST /voices` (create a named voice) and `GET /voices/{id}` (fetch a voice plus its contributions). PRD FR-18 and FR-20 name the assign/commit/train routes explicitly and testably. FR-16 only asserts that a Voice is "represented ... via a `voices` table," which covers the entity's existence but not the create/fetch HTTP contract as a testable behavior. The granularity is inconsistent — some routes are elevated to FR-level, two are not.
   **Fix:** Either fold a line into FR-16 ("...exposed via `POST /voices` to create and `GET /voices/{id}` to fetch a voice with its contributions") or accept the current abstraction level and drop the explicit route citations from FR-18/FR-20 for consistency.

## Checked, no gap

- **FR-20 framing vs. spec.** PRD's `[ASSUMPTION]` tag on FR-20 ("both trigger paths are supported concurrently, since the source spec did not pick one exclusively") matches SPEC.md's own Assumptions entry almost verbatim ("both paths are treated as valid entry points into the same voice graph"). Elevating this to PRD §8 Open Question 3 doesn't contradict the spec — it just asks for stakeholder confirmation of an assumption the spec itself flagged, which is a reasonable PRD-level move even though the spec's own "Open Questions" section reports none outstanding.
