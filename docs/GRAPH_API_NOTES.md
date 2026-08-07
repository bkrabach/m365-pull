# Microsoft Graph + Browser API notes

Hard-won findings from debugging this app against live Microsoft Graph. Every claim
below is backed by a measurement taken against a real tenant, not by documentation.

**If you forked this codebase or used it as a reference, read this file.** Several of
these are silent-failure bugs: the app returns a plausible-looking short answer and
nothing logs an error. They were each found by a human noticing missing data on screen,
not by any automated check.

---

## 1. `/me/chats` is NOT sorted by default

The default ordering of `/me/chats` is not sorted by any date field. Pages arrive in an
order that crosses back and forth in time.

```
DEFAULT ORDER (no $orderby):
  page 1: newest 2026-08-07T09:18  oldest 2026-05-05T13:42
  page 2: newest 2026-08-07T01:55  oldest 2026-08-03T18:13   <-- NEWER than page 1's oldest
  page 3: newest 2026-08-07T00:41  oldest 2025-11-11T20:28
```

**Consequence:** any "stop paginating once this page is older than my window" heuristic
is invalid. The content of the current page tells you nothing about later pages. A prior
version of this app stopped after two consecutive out-of-window pages and silently
dropped meeting chats that lived on page 7+ — it surfaced 2 recordings where 15 existed.

**Do not** reintroduce a page-content-based early stop. Paginate until the cursor is
exhausted, with a page cap as a runaway backstop only, and report loudly when the cap
is what stopped you.

## 2. `$orderby` gives you real ordering — and silently drops chats

Passing `$orderby=lastMessagePreview/createdDateTime desc` *does* produce strictly
monotonic pages, and returns full 50-item pages where the unordered walk dribbles out
~20:

```
$orderby=lastMessagePreview/createdDateTime desc:
  page 1: newest 2026-08-07T10:13  oldest 2026-07-31T18:48
  page 2: newest 2026-07-30T22:30  oldest 2026-07-06T22:22
  page 3: newest 2026-07-06T21:16  oldest 2026-06-08T23:52
  ... strictly descending through page 6
```

**But it excludes chats with a null `lastMessagePreview`:**

```
first 150 chats, unordered:  35 with null lastMessagePreview
first 150 chats, ordered:     0
full ordered walk:           40 pages / 1998 chats, only 3 nulls, more still pending
$orderby ... asc          →  BadRequest: "Ascending direction is not supported"
```

Those chats are **not empty**. A sampled one — `chatType=meeting`, updated that same day —
returned 20 messages, all `messageType: unknownFutureValue` (the same class that call
recording events belong to):

```
GET /me/chats/{null-preview-chat}/messages → 200
  messages: 20   types: unknownFutureValue   recordings: 0
```

So `$orderby` is a viable fast path only if paired with a way to enumerate the
null-preview set. Used naively with an early stop, it silently drops ~23% of chats.

## 3. `lastUpdatedDateTime` is not an activity signal

The tenant bumps `lastUpdatedDateTime` on dormant chats for reasons that involve no
message at all — roster changes, policy sweeps. Of 100 chats showing `lastUpdatedDateTime`
of *today*:

```
33  had no lastMessagePreview at all
31  had lastMessagePreview dated 2020–2023
```

Using it as a proxy for "recent activity" inflated an 8-chat day into 123 rows of
6-year-old chats. Use `lastMessagePreview.createdDateTime` — it is the timestamp of the
last actual message, cannot move backward, and therefore is always ≥ any real activity.

## 4. Recording events do not bump `lastUpdatedDateTime`

Measured on a live chat:

```
"Amplifier Releases Shareout"
  lastUpdatedDateTime         = 2026-08-06T18:31:33
  lastMessagePreview.created  = 2026-08-06T22:02:57   <-- 3.5 HOURS LATER
  eventDetail                 = #microsoft.graph.callRecordingEventMessageDetail
```

A chat whose only recent activity is a recording can have a stale `lastUpdatedDateTime`.
Any cache keyed on that field will report "unchanged" and skip the chat forever — the
recording becomes permanently invisible with no error anywhere.

## 5. `0001-01-01T00:00:00` null-date sentinels

Some chats carry `lastUpdatedDateTime = "0001-01-01T00:00:00"` — the .NET null-date
sentinel. It parses to a **valid but hugely negative** timestamp, so `isNaN()` guards do
not catch it, and one such chat poisons any `Math.min()` over a page. Guard for it
explicitly and fail toward inclusion.

## 6. `getAllMessages` is application-only

The docs contradict themselves — the reference page lists delegated as "Not supported"
while the Teams API billing page lists `GET /me/chats/getAllMessages` as an Export API.
Graph settles it:

```
GET /me/chats/getAllMessages  →  HTTP 412 PreconditionFailed
  "Requested API is not supported in delegated context"
```

There is no delegated-permission endpoint that returns messages across all of a user's
chats with a server-side date filter. From a no-backend SPA, per-chat enumeration is the
only option available.

## 7. `403 AclCheckFailed` is expected, permanent, and not an error

Meeting chats a user can see but is not a roster member of return:

```
403 Forbidden — InsufficientPrivileges
  "AclCheckFailed-The initiator 8:orgid:<oid> is not a member of the roster <guid>
   in the generic thread 19:meeting_...@thread.v2"
```

This never succeeds on retry. Treat it as a typed skip, not a failure — one inaccessible
chat must not abort enumeration of the rest, and logging it as an error with a stack
trace makes a healthy run look broken. Note that the browser's own devtools network log
still shows the red 403; that cannot be suppressed from JavaScript.

---

## 8. `showSaveFilePicker()` requires transient user activation

Not a Graph issue, but the same silent-failure shape. `window.showSaveFilePicker()`
requires *transient user activation* — granted by a click, expiring after roughly five
seconds, and consumed on use. Any code that fetches before saving will race that window:

```
recording transcript → fast fetch  → picker fires in-window → works
chat messages        → paginated   → window expired         → throws every time
bulk (chat first)    → chat burns the activation without opening a dialog
                       → the recordings behind it fail too  → "0 of 3 artifacts saved"
```

The error is explicit once surfaced:

```
Failed to execute 'showSaveFilePicker' on 'Window':
  Must be handling a user gesture to show a file picker.
```

This app now writes via `Blob` + object-URL + anchor click (`src/destinations/browser.ts`),
which has no activation requirement and no per-file dialog. The trade-off is that the
user no longer picks a destination and Chrome may prompt once for multiple downloads.
If you need the picker, call it in the click handler **before any `await`**.

---

## The pattern worth internalizing

Every bug above failed **silently**. Nothing threw. Nothing logged. The app returned a
shorter list, or saved zero files, and looked like it had worked.

Two habits caught all of them:

1. **Probe live, don't reason.** Three separate hypotheses on this codebase were
   plausible, internally consistent, and wrong — each died to a single real API call.
   When behavior and belief disagree, spend the request.
2. **Fail toward inclusion, and be loud when truncating.** A missing-date field, an
   unparseable timestamp, an inaccessible chat: none should silently shrink the result
   set. If a cap or a guard stops you early, say so in the UI.
