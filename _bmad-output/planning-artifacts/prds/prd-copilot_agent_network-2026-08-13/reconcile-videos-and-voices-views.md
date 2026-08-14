# Reconciliation: spec-videos-and-voices-views → PRD §4.5

**Input spec:** `_bmad-output/specs/spec-videos-and-voices-views/` (SPEC.md, brownfield.md, ui-views.md, implementation-plan.md, verification.md, .memlog.md)
**PRD section checked:** §4.5 "Videos & Voices Views" (FR-23–FR-27), plus §5 Non-Goals and §8 Open Questions.

## Verdict

Mostly faithful. FR-23–FR-26 (Videos view: nav split, table/expand, combobox naming, assign/commit/discard) match the spec closely, near-verbatim in places. Non-goals and the (empty) open-questions set from this spec are both correctly reflected — no dropped non-goal, no missing carry-forward question, no PRD-side overclaiming found. The gaps below are all on the Voices-view side (FR-27): the PRD's action set for a voice card is narrower than what `ui-views.md`/`implementation-plan.md` specify.

## Gaps

1. **FR-27 omits the "View clips" action.** `ui-views.md` lists a voice-card action button — "'View clips' (list all clips across all videos)" — implemented as a modal per `implementation-plan.md` ("Add 'View all clips' modal"). FR-27 only names "Train now" and "Download model."
   *Fix:* Add a bullet to FR-27: a "View clips" action opens a modal listing every clip across all contributing videos.

2. **FR-27 omits the "Retrain" action.** `ui-views.md`'s Voices-view action list is "'View clips' ... 'Retrain' (explicit trigger) ... 'Download model'" — a persistent, unconditional re-train action, distinct from the phase-conditional "Train now" banner (which only appears while a voice has `AWAITING_COMMIT` contributions). FR-27 captures the banner but not the standing "Retrain" button.
   *Fix:* Add to FR-27: a "Retrain" action re-triggers `POST /voices/{id}/train` explicitly, independent of the `AWAITING_COMMIT` banner condition.

3. **Minor — card-face "contributing videos" count badge not named.** `ui-views.md`: "Each voice card shows a 'contributing videos' badge (e.g. '3 videos') with a popover listing..." FR-27 jumps straight to describing the popover's contents ("a contributing-videos popover (video, clip count, assignment date)") without naming the visible summary badge that surfaces the count and triggers the popover.
   *Fix:* Reword FR-27 to note the card shows a contributing-videos count badge (e.g., "3 videos") that opens the popover.

## Checked and clean (no gap)

- Non-goals: both SPEC.md non-goals (no pythonapi/data-model change; `speaker_board` playback preserved as-is) are reflected verbatim in the PRD's §4.5 Out of Scope.
- Open questions: SPEC.md states none outstanding for this spec; PRD §8's three open questions correctly trace to other source specs (4.2, 4.3, 4.4), none dropped from this one.
- No PRD overclaim found: every FR-23–FR-27 assertion is directly supported by SPEC.md/ui-views.md/verification.md content; if anything the PRD slightly undercounts (see gaps above) rather than overclaims.
