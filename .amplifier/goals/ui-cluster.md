# Lane ui-cluster — refactor-first list-item overhaul + 9 UI/UX items

## Objective
Land 9 work-tracker items that all edit the same list-rendering code, WITHOUT internal
collisions, by doing a small refactor first and then each item in order. Commit after
EACH item so partial progress survives.

## Exit condition
Complete when **either** every item below reaches a terminal state, **or** it is
conclusively demonstrated the remainder cannot, naming the blocker for each. An item
ending FAIL or BLOCKED is a residual, not a failure of the goal. If you hit the time
bound, that is a **BUDGET** stop — commit everything and write DONE.json; do not rush.

Per-item terminal state = PASS (implemented + `npm run typecheck` clean + committed) /
FAIL-<reason> / BLOCKED-<reason>.

## Where you work — ONLY here
- Working dir: this worktree. Branch: `gb/m365ui/ui-cluster`, base `d099be1`.
- Do NOT touch the main checkout or sibling worktrees.

## Files you OWN
- `src/main.ts`, `src/style.css`, `src/cache/ui-state.ts`, `src/cache/prefs.ts`,
  `src/sources/teams-chats.ts`
- You MAY edit `src/cache/ignored.ts` for label constants ONLY.
- HARD CONSTRAINT: do NOT rename the localStorage key `m365-pull.ignored.v1.`
  (src/cache/ignored.ts) or the OneDrive state field `ignored[]`
  (src/state/onedrive-state.ts). Renaming either breaks cross-device merge. Do NOT
  touch `src/sources/teams-recordings.ts` or `src/destinations/browser.ts` (other lanes).

## STEP 0 — Refactor first (do this before any item)
`src/main.ts` has four near-duplicate row builders — `renderContainerRow` (grouped
header), `messagesArtifactRowHtml`, `recordingArtifactRowHtml`, and the flat
`renderChannelRowHtml`. They drift, which is the root cause of most items below. Extract a
SINGLE shared row renderer with a fixed left-column order: [expand-caret slot][checkbox]
[favorite slot][type icon][title/sub][right actions: downloaded-label, download button].
Every row type (grouped header, flat message, flat recording, flat channel, grouped child
rows) must reserve the SAME left columns so they align — flat rows reserve an empty
expand-caret slot; recording rows reserve an empty favorite slot. Commit this refactor
alone, typecheck-clean, before starting items. Most items then become small.

## Items (do in this order; commit after each)
1. **kkc** — alignment + download-button parity. Flat rows align with grouped rows (left
   columns from Step 0). Recording child-rows in grouped view reserve the favorite-star
   space so checkbox→type-icon gap matches chat rows (NOTE: grouped view is the one that's
   currently WRONG; flat view already fine). Make group download buttons match the single
   icon-only ⬇ (strip the emoji/text labels "Download messages"/"…and recordings"),
   preserving the disabled/"nothing to download" state.
2. **84b** — remove the stray greyed ☆ on the "RECORDINGS (n)" group sub-header (it is not
   favoritable). Leave the real group-container recordings ★ working.
3. **81x** — make the grouped chat/channel header favorite (currently a read-only
   `.fav-state` span) an actual toggle. Channel → toggleChannelFavorite(). Chat has two
   streams (messages/recordings) — pick + DOCUMENT the semantics (e.g. toggles messages).
4. **nxq** — move the "· Downloaded {date}" / "Not downloaded yet" text out of the sub-line
   into a label in the right action container, just left of the download button, for all
   row types (add the missing "Not downloaded yet" for single recordings).
5. **aws** — count badges: show messages-count (chats) / threads-count (channels) as a
   badge next to the recordings 🎙 badge in grouped rows, respecting the current lookback
   + filters. Reuse the channel thread-badge tri-state lazy pattern (renderThreadIndicator
   / ensureChannelPreview). Chat message counts don't exist yet — add a lazy, bounded,
   tri-state count (loading→resolved→"N+"); do NOT eagerly paginate every chat at render.
6. **4qr** — rename all USER-FACING "ignore/ignored" strings to "hide/hidden" (keep the
   storage key + OneDrive field, see HARD CONSTRAINT). Add a hide toggle to flat/single
   rows (today only grouped headers have it → flat items can't be hidden). Add a
   hidden-items management view listing all hidden items with per-item Unhide (reuse the
   existing showIgnored filter flag).
7. **dzo** — add view filter toggles for chats / channels / recordings (default all ON),
   persisted in ui-state chatFilter; apply in both the chat filter path
   (applyContainerFiltersAndSort) and channel path (rerenderContainerList).
8. **nhk** — collapse the Teams (channels) picker to a selected-summary (team names, or
   "N teams" when >3) with expand-to-edit; persist collapsed/expanded in prefs.
9. **hkh** — surface the Flat/Grouped toggle outside the Settings panel (a persistent
   control near the list/filter bar); keep persistence; don't leave a desynced duplicate.

## Discipline
- Commit + push after EACH item (branch `gb/m365ui/ui-cluster`). NEVER merge to main.
- Keep `npm run typecheck` clean at every commit. If one item can't typecheck-clean, mark
  it BLOCKED, revert just that item's changes, and continue with the next.
- Do not invent shared singletons/new global stores that another lane might duplicate.

## Host + capability limits
- Linux/aarch64. NO Microsoft auth token / NO Graph access — you cannot run the app with
  real data. Verify via `npm run typecheck` and `npm run build`. Visual verification is
  the orchestrator's job (browser-bridge, later) — do NOT claim visual verification.

## Final act — DONE.json
Add `DONE.json` to `.gitignore` FIRST, then write `DONE.json` in the worktree root:
`{lane:"ui-cluster", session_id:<your own session id>, verdict:"COMPLETE"|"PARTIAL"|"BLOCKED",
branch:"gb/m365ui/ui-cluster", head:<sha>, pushed:true|false,
items:["kkc:<state>","84b:<state>","81x:<state>","nxq:<state>","aws:<state>","4qr:<state>",
"dzo:<state>","nhk:<state>","hkh:<state>"], residuals:[...], pending_human:[...],
suite:"typecheck:<pass|fail>, build:<pass|fail>"}`
verdict=PARTIAL if you hit BUDGET with some items still open — list them in items[] with
their real states.

## KNOWN
- Verify: `npm run typecheck` then `npm run build` (NO test suite). Worktree has no
  node_modules — run `npm install` ONCE before verifying.
- src/main.ts is ~4000 lines; the row builders + FilterState + renderTeamPicker +
  settings panel are the relevant regions. Read before editing.
