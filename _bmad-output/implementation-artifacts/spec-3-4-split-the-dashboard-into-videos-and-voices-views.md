---
title: 'Story 3.4: Split the Dashboard into Videos and Voices Views'
type: 'feature'
created: '2026-08-15'
status: 'done'
review_loop_iteration: 0
context: []
baseline_commit: 'd8d41ca519409012fb0ca9b36cca892f11efac51'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `app/page.tsx` is one page holding the entire run list (search, start, expand-to-review). Stories 3.5 and 3.6 need two separately addressable views — one for ingestion/assignment, one for voice training — and neither has anywhere to land yet.

**Approach:** Add two Next.js App Router segments, `app/videos/page.tsx` and `app/voices/page.tsx`, reachable through a shared nav bar rendered once in `layout.tsx` (client-side navigation, no full reload). Relocate the existing run-list content verbatim into the Videos view. The Voices view is a minimal placeholder shell — 3.6 populates it. `app/page.tsx` redirects to `/videos`.

## Boundaries & Constraints

**Always:**
- Use Next.js App Router segments (`app/videos/page.tsx`, `app/voices/page.tsx`), not client-side tab state — the context requires each view be independently reachable, and a route segment is URL-addressable while still navigating client-side with no full reload.
- Add a `nav.tsx` (or similarly named) component under `app/features/nav/` rendered from `layout.tsx`, above `{children}`, so it persists across navigations alongside `ChatSidebar` and stays mounted the same way the chat sidebar does.
- Move `app/page.tsx`'s existing JSX (header, "New run" toggle, `VideoSearch`, run list with `RunCard`) into `app/videos/page.tsx` verbatim — same component tree, same hooks (`useVoiceRuns`, `RunCard`, `VideoSearch`), same behavior. This is a relocation, not a redesign.
- `app/page.tsx` becomes a server-side redirect to `/videos` (`redirect("/videos")` from `next/navigation`).
- `app/voices/page.tsx` is a minimal placeholder — page header ("Voice models") and a short "Coming in Story 3.6" or empty-state message. No data fetching, no voice list, no cards.
- Nav highlights the active segment (e.g. via `usePathname()`), matching existing shadcn styling already in the codebase (`components/ui/button` variants) rather than introducing a new nav component library.
- `QueryProvider`, `CopilotProvider`, and `VoiceLiveState` stay mounted at the root layout exactly as today — nav is additive, it does not restructure provider nesting.

**Ask First:** None expected.

**Never:**
- Do not touch `voice_api.ts`, `run_card.tsx`, `speaker_board.tsx`, `training_monitor.tsx`, or any backend route — this story moves existing UI, it does not add a voice list, training controls, or new API calls (that is 3.5/3.6).
- Do not remove `TrainingMonitor` from `RunCard` even though the epic context ultimately moves training display to the Voices view — that redesign is out of scope here; 3.4 only relocates the page, unchanged.
- Do not add a `/voices` data-fetching hook or card component — the Voices view content is Story 3.6's scope.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Visit root | User navigates to `/` | Redirected to `/videos`, run list renders as it does today | N/A |
| Navigate Videos → Voices | User clicks "Voices" in nav while on `/videos` | Client-side nav to `/voices`, no full page reload, chat sidebar state (e.g. open conversation) survives | N/A |
| Navigate Voices → Videos | User clicks "Videos" in nav while on `/voices` | Client-side nav to `/videos`, run list re-renders (react-query cache already warm) | N/A |
| Active tab styling | User is on `/videos` | "Videos" nav item shows active/selected style, "Voices" does not | N/A |

</frozen-after-approval>

## Code Map

- `apps/agentic-executor/src/app/page.tsx` (97 lines) -- entire current dashboard body to relocate into `app/videos/page.tsx`; replace this file's content with a `redirect("/videos")`.
- `apps/agentic-executor/src/app/layout.tsx:1-40` -- root layout; add the new nav component between `<VoiceLiveState />` and `{children}`, update the comment at lines 29-32 which currently says "No nav: the dashboard is the only page" (now false).
- `apps/agentic-executor/src/app/features/chat/chat_sidebar.tsx` -- precedent for a persistent, always-mounted component rendered from `layout.tsx`; new nav component follows the same mounting pattern.
- `apps/agentic-executor/src/components/ui/button.tsx` -- existing `Button` variants (`variant="outline"`/`"secondary"` etc., already used in `page.tsx:39-45`) to reuse for nav item styling instead of introducing `tabs.tsx`.
- `apps/agentic-executor/src/app/features/voices/voice_api.ts:303` (`useVoiceRuns`), `run_card.tsx` (whole file), `video_search.tsx` (whole file) -- imports that move with the relocated JSX; import paths from the new `app/videos/page.tsx` location go from `./features/voices/...` to `../features/voices/...` (one directory deeper).
- No existing `app/voices/` or `app/videos/` directories -- both are new.
- `apps/pythonapi/pythonapi/routes/voices.py` -- confirmed no `GET /voices` (list) endpoint exists yet; the placeholder Voices view must not attempt to call one.

## Tasks & Acceptance

**Execution:**
- [x] `apps/agentic-executor/src/app/features/nav/dashboard_nav.tsx` (new) -- client component with "Videos" and "Voices" links (`next/link`), active-segment styling via `usePathname()` -- shared nav reachable from both views
- [x] `apps/agentic-executor/src/app/videos/page.tsx` (new) -- move `app/page.tsx`'s full current body here unchanged, fixing relative import paths -- Videos view now hosts the existing ingestion/review flow
- [x] `apps/agentic-executor/src/app/voices/page.tsx` (new) -- minimal placeholder header + "coming soon" message, no data fetching -- Voices view shell for Story 3.6 to populate
- [x] `apps/agentic-executor/src/app/page.tsx` -- replace body with `redirect("/videos")` -- root now forwards to the default view
- [x] `apps/agentic-executor/src/app/layout.tsx` -- render `DashboardNav` above `{children}`, update stale "No nav" comment -- nav persists across both views alongside the chat sidebar

**Acceptance Criteria:**
- Given the app loads at `/`, when the redirect resolves, then the run list renders at `/videos` exactly as it did on the old root page
- Given a user is mid-conversation in the chat sidebar, when they navigate between Videos and Voices, then the conversation state is not lost (chat sidebar stays mounted)
- Given a user is on either view, when they look at the nav, then the current view is visually distinguishable from the other

## Spec Change Log

- User directive (not a review finding): no e2e/UI/Playwright tests for this story, this epic, or any other epic — UX is not final and will be redesigned, so UI test investment is premature. The I/O & Edge-Case Matrix above is verified manually only; no automated coverage is expected or required for its rows.
- Round-1 review (edge-case-hunter) found `DashboardNav`'s active-tab check dereferenced `usePathname()` without a null guard — `usePathname()` can return `null` outside a router context. Patched: `apps/agentic-executor/src/app/features/nav/dashboard_nav.tsx` now checks `pathname !== null && pathname === item.href`. Re-ran `nx lint`/`nx typecheck` via litert-subagent — both pass.

## Verification

**Commands:**
- Hand off to `litert-subagent`: `nx lint @agentic-executor/agentic-executor` -- expected: no new violations
- Hand off to `litert-subagent`: `nx typecheck @agentic-executor/agentic-executor` -- expected: clean, no new errors
- Hand off to `litert-subagent`: `nx test @agentic-executor/agentic-executor` -- expected: existing suite passes unaffected

**Manual checks (if no CLI):**
- Run `nx dev @agentic-executor/agentic-executor`, visit `/`, confirm redirect to `/videos` and that the run list, "New run" flow, and expand-to-review all behave identically to before the split.
- Click "Voices" in the nav, confirm placeholder renders, click back to "Videos", confirm no full page reload (check network tab / no flash) and any open chat conversation persists.

## Suggested Review Order

**Route split**

- Entry point: root now forwards to the default view instead of rendering the dashboard directly.
  [`page.tsx:8`](../../apps/agentic-executor/src/app/page.tsx#L8)

- The former root page body, relocated unchanged — same hooks, same JSX, only import paths shifted one level.
  [`videos/page.tsx:20`](../../apps/agentic-executor/src/app/videos/page.tsx#L20)

- Minimal placeholder shell with no data fetching, deferring content to Story 3.6.
  [`voices/page.tsx:6`](../../apps/agentic-executor/src/app/voices/page.tsx#L6)

**Shared nav**

- Active-segment styling reuses existing `Button` variants via Base UI's `render` prop composition rather than a new nav library.
  [`dashboard_nav.tsx:17`](../../apps/agentic-executor/src/app/features/nav/dashboard_nav.tsx#L17)

- Null-guarded pathname comparison, patched after edge-case review flagged `usePathname()` can return `null`.
  [`dashboard_nav.tsx:18`](../../apps/agentic-executor/src/app/features/nav/dashboard_nav.tsx#L18)

**App wiring**

- Nav mounted once above `{children}`, alongside `ChatSidebar`, so both persist across the Videos/Voices split.
  [`layout.tsx:36`](../../apps/agentic-executor/src/app/layout.tsx#L36)
