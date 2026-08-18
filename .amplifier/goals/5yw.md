# Lane 5yw — browser download fails on Safari (Mac)

## Objective
Investigate work-tracker item **m365_pull-5yw**, root-cause the Safari/Mac download
failure from the code, implement the most likely fix, and make failure detection honest.

## Exit condition
Complete when **either** the item reaches a terminal state, **or** it is conclusively
demonstrated it cannot, naming the blocker.

Terminal states (pick one, name it):
- **PENDING-HUMAN** — a candidate fix implemented + `npm run typecheck` clean +
  committed+pushed, BUT it cannot be verified here (no Mac/Safari on this Linux box).
  THIS IS THE EXPECTED OUTCOME: the fix ships to the branch and the human verifies on
  Safari. Name exactly what the human must do to verify.
- **PASS** — only if you can genuinely verify on Safari (you cannot from this host, so
  do not claim PASS).
- **FAIL-<reason>** / **BUDGET**.

## Where you work — ONLY here
- Working dir: this worktree. Branch: `gb/m365ui/5yw`, base `d099be1`.
- Do NOT touch the main checkout or sibling worktrees.

## Files you OWN (touch nothing else)
- `src/destinations/browser.ts`
If you find a needed edit outside this file, RECORD it as a residual and STOP.

## The bug (from static analysis — confirm in code)
`saveTextFile()` in `src/destinations/browser.ts` (~:53-88): Blob + URL.createObjectURL +
a hidden `<a download>` appended to body, clicked, then `anchor.remove()` called
SYNCHRONOUSLY in the same frame as the click (~:74-76); returns `{ saved: true }`
UNCONDITIONALLY (~:83).
Safari suspects: (a) synchronous anchor.remove() in the same frame as click — Safari
needs the anchor to survive a tick; defer removal (e.g. setTimeout) and delay
revokeObjectURL. (b) `saved:true` returned without observing acceptance → a Safari
failure surfaces to the user as SUCCESS (silent). Make the reported outcome reflect
whether the download was actually initiated where detectable.
Do NOT reintroduce `showSaveFilePicker` (removed deliberately — see the comment block
~:25-52; it requires transient user activation that expires during the Graph fetch).

## Host + capability limits
- Linux/aarch64. NO Safari, NO macOS, NO browser here. You cannot run or verify the fix
  in a browser. Reason from the code + known Safari behavior; ship a candidate;
  terminate PENDING-HUMAN with the verification steps.

## Discipline
- Commit early, push always (branch `gb/m365ui/5yw`). NEVER merge to main.
- Time bound → BUDGET terminal state if exceeded; still commit.

## Final act — DONE.json
Add `DONE.json` to `.gitignore` FIRST, then write `DONE.json` in the worktree root:
`{lane:"5yw", session_id:<your own session id>, verdict:"PARTIAL"|"COMPLETE"|"BLOCKED",
branch:"gb/m365ui/5yw", head:<sha>, pushed:true|false,
items:["m365_pull-5yw:PENDING-HUMAN"], residuals:[...],
pending_human:["verify download on Safari/Mac: <steps>"], suite:"typecheck:<pass>"}`
(verdict PARTIAL is correct when the code is done but verification is deferred to a human.)

## KNOWN
- Verify with `npm run typecheck` (NO test suite). Worktree has no node_modules — run
  `npm install` before typecheck.
- Keep the change minimal and self-contained to this one file.
