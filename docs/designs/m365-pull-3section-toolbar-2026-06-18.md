# m365-pull — 3-Section Progressive-Disclosure Toolbar (2026-06-18)

**Status: LOCKED — building.** Reorganizes the single dense toolbar into three step-sections,
each of which reduces the previous step's clutter. Per-row list controls (expand, select,
favorite ★, ignore, per-artifact ⬇) are unchanged.

## Header (persistent, all states)
Title · sync badge · ⚙ Settings · Sign out. Not one of the three sections.

## §1 — LOAD  (only section visible before content loads)
Controls: `[ Show from: ▾ <range> ]` · `[ ★ Always include favorites ]` ·
`Include: [✓ Messages] [✓ Recordings]` · `[ ⬇ Load my Teams chats ]` (primary).
- Custom date inputs render inline **only when "Custom range…" is selected** (render-when-custom,
  NOT the `hidden`-attr trick — that was defeated by `display:inline-flex`).
- **Include is a LOAD-SCOPE** (controls what the load pulls), both-on default, can't turn both off
  (block the last one off; tooltip "Include at least one"):
  - Both on → list chats with Messages + Recordings.
  - **Recordings off** → skip the recording scan entirely (faster); messages only.
  - **Messages off** → still enumerate chats + scan for recordings (recordings are discovered via
    chat message events, so enumeration can't be skipped), but don't surface/pull the Messages
    artifact — only recordings in range. Pull the minimum needed for what's left on.
- **During load** → §1's controls are replaced by a step-by-step CHECKLIST: lines resolve
  `·`→`⟳`→`✓` with in-place counts ("Signed in", "Found N chats · ★ K favorites",
  "Scanning recordings… 38/142", "Done"). Per-step error shows `✕ <reason>` + inline Retry on
  that line only. Reports real phase completion, not a timed bar.
- **After load** → §1 collapses to a one-line RECEIPT:
  `✓ N chats · <range> · ★ favorites included   [ Change ]  [ ⟳ Reload ]`
  Reload = re-run same query; Change = re-expand §1 picker.

## §2 — VIEW  (revealed after load)
`[ 🔍 Search ]` · Type chips `[1:1] [Group] [Meeting]` · `[ Sort by: ▾ ]` ·
`[ View: «Flat» Grouped ]` (Flat first **and** default) · `[ ★ Favorites only ]` ·
`[ Hide downloaded ]` · `[ Show ignored ]` (render only when ignored count > 0).

## §3 — DOWNLOAD & BULK ACTIONS  (revealed with §2, visually separate)
`[ Destination: ▾ ]` (+ folder field only when OneDrive) · `[ Download history: ▾ ]`
(rename the "since last download" option → **"since last pull"**) ·
`[ ☑ Select all ]` · `[ Sync favorites (N) ]` · `[ ⬇ Download selected (N) ]` ·
`[ Clear ignored ]` (an ACTION — render only when ignored count > 0).

## Tweaks (apply across the toolbar)
- **No-wrap label pairing:** each `Label: [control]` is one inline-flex `white-space:nowrap` unit;
  the row wraps BETWEEN units, never inside one (fixes "Download history:" orphaning above its
  dropdown). Applies to Show from / Download history / Destination / Sort by / Include / View, and
  the custom-range `From [date] to [date]` cluster.
- Merge the two Include chips → one `Include:` label + `Messages` + `Recordings` chips
  (Transcripts→Recordings).
- View toggle order **Flat then Grouped**, Flat default-active.
- Renames: "Load my Teams containers"→"Load my Teams chats"; "Marked/Favorites only"→"★ Favorites only";
  Refresh→"⟳ Reload" (in the receipt).

## Carry-over bug fixes (folded into this work)
- **Flat default miss:** main.ts:1273 render fallback still resolves to "grouped" when viewMode is
  unset — flip so the render branch defaults to flat (matches the toolbar highlight).
- **mergeStates version:** onedrive-state.ts:182 returns `version: 1` for v2 data — set `version: 2`
  so the v1→v2 migration guard fires once, not every sync.
- Show/Clear-ignored now render only when ignored > 0 (no more always-visible).

## Build order
- **Build A — structure/UI:** the 3 sections + progressive disclosure + loading checklist + receipt
  collapse + all control moves/renames/tweaks + the carry-over bug fixes. Include defaults both-on,
  so load behavior is unchanged in this build.
- **Build B — behavior:** wire Include as a real load-scope (skip recording scan when Recordings off;
  enumerate+scan recordings only, skip message artifact, when Messages off) + block-last-off.
