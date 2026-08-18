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

## 9. Loop `.loop` → `?format=html` is documented but does not work

Graph v1.0 [documents `loop` as a supported source extension](https://learn.microsoft.com/en-us/graph/api/driveitem-get-content-format?view=graph-rest-1.0)
for both `format=html` (`loop, fluid, wbtx, whiteboard`) and `format=pdf`. Delegated
`Files.Read` is listed as the least-privileged permission.

**Measured 2026-08-07 with delegated `Files.Read.All` from a browser SPA: it fails on
every file, in both formats.**

```
4 OneDrive-resident .loop files, each tried twice:

  html →  HTTP 406   "An exception occurred while executing within the Sandbox"
  pdf  →  HTTP 500   "An exception occurred while executing within the Sandbox"
```

Same exception text under two different status codes — one broken component, not two
bugs. PDF is not a viable fallback for HTML.

The request reaches the right service and is correctly typed; it is the conversion
itself that throws:

```
https://southcentralus1-mediab.svc.ms/transform/html?provider=spo&inputFormat=loop&docid=...
https://southcentralus1-mediab.svc.ms/transform/pdf ?provider=spo&inputFormat=loop&docid=...
```

**These files were in the documented-supported location.** The `docid` parameter resolves
to `microsoft-my.sharepoint.com/_api/v2.0/drives/...` — OneDrive, not SharePoint Embedded.
This is *not* the known SPE wall (§ below); it is the supported path failing.

### What DOES work — don't rediscover this

| Step | Result |
|---|---|
| MSAL delegated auth from a browser SPA | works |
| `/me/drive/recent` for discovery | **useless** — 1 item, 0 Loop files |
| `/search/query` + KQL `filetype:loop OR filetype:fluid` | **25 hits** (24 `.loop`, 1 `.fluid`) |
| **CORS on the `svc.ms` 302 redirect** | **not a blocker** |
| The conversion | fails 100% |

The CORS result is worth stating loudly because it is undocumented and was the presumed
blocker. `fetch` returned `type=cors`, `redirected=true`, and a **readable body** from
`southcentralus1-mediab.svc.ms`. A CORS rejection would have thrown a `TypeError` with no
body at all. A browser SPA *can* read the response — there just isn't a good one.

### Also note

- A `403 Access denied` (no redirect, Graph-level) appears for files visible in search but
  in another user's drive. Same shape as the roster `403`s in §7 — expected, permanent.
- The widely-circulated "`.loop` files are encrypted, content unavailable" answer is from
  **January 2024** and is contradicted by current documentation. It is stale in a
  *different* way than reality: the docs now promise a conversion that doesn't run.

### Untested

Whether this fails for **all** callers or only delegated ones. An app-only/backend token
was not tried — that needs a client secret, which a no-backend SPA cannot hold. If someone
tests app-only and it succeeds, the finding narrows to "delegated conversion is broken."
Until then the honest scope is: **delegated, browser SPA, 8 attempts, 0 successes.**

---

## 10. Recording transcripts: the `media/transcripts` SP path is now app-whitelist-gated

Downloading a Teams meeting **recording transcript** regressed. The recording-file
strategy in `src/sources/teams-recordings.ts` — resolve the share to a driveItem, then
read `media/transcripts` from SharePoint REST v2.1 with a SharePoint-resource token —
now returns **HTTP 403** from a live run:

```
GET https://{spHost}/_api/v2.1/drives/{driveId}/items/{itemId}
      ?select=name,media/transcripts&$expand=media/transcripts
Authorization: Bearer <token for https://{spHost}/.default>

403 Forbidden
{"error":{"code":"accessDenied","message":"For protected mp4 file, this API is only
 supported for whitelisted apps, your app id 63231eb0-9b53-4342-8ac4-5209d618684e is
 not whitelisted."}}
```

### This is the app-identity gate, NOT a missing SharePoint scope

The distinction matters because the two failures look similar but have opposite fixes,
and only one of them is fixable in this codebase.

- **The token was accepted.** The request reached the SharePoint media service and came
  back with a *semantic* rejection that names our concrete Entra app id. A missing
  SharePoint API permission fails **earlier and differently**: `getSpToken()`'s
  `acquireTokenSilent({ scopes: ["https://{spHost}/.default"] })` throws (nothing
  consented for that resource) and falls back to redirect — or the API answers with a
  generic `401` / permission-ACL `403`. It does not answer with "your app id … is not
  whitelisted."
- **`accessDenied` here is authorization, downstream of authentication**, keyed to an
  app-identity **allow-list Microsoft maintains** for *protected* mp4 media. "Protected"
  = the recording's mp4 is rights-protected/encrypted; its `media/transcripts` expansion
  and the `streamContent` download pipeline are restricted to Microsoft first-party app
  identities (Stream / Teams / the SharePoint & OneDrive web clients).
- **No consentable permission changes app identity.** There is no scope you can add to
  the app registration to get onto that list. Adding `AllSites.Read` / `Sites.Read.All`
  (the perms this file's header calls for) gets you a *valid token* — which is exactly
  what we already have, and exactly what gets refused.

Why the reference Chrome extension (`bkrabach/teams-transcript-md`) still works and we
don't: it runs in the **first-party web origin** on the user's session cookies (the
Stream/SharePoint web app's *own* whitelisted identity). We call cross-origin with a
**third-party Entra app** bearer token. The code already knew this in spirit —
`teams-recordings.ts:257` notes "The Chrome extension can get away with cookies; we
cannot." The whitelist gate is the sharp edge of that same difference.

### No delegated Graph transcript path exists for the general case

Confirmed by reasoning over already-measured facts (this box has no Graph/SharePoint
token or network — analysis is code + prior probes, **not** a live re-run):

| Candidate delegated path | Verdict |
|---|---|
| `GET /me/onlineMeetings/{id}/transcripts` (+ `getAllTranscripts`) | Organizer-only. Returns only meetings the signed-in user **organized**. The scraper's job is non-organizer meetings. (Stated in `teams-recordings.ts:7-9`.) |
| `GET /users/{organizerId}/onlineMeetings/getAllTranscripts` | Requires `meetingOrganizerUserId`; the delegated call requires you to **be** that user. A prior probe returned **400** without the organizer id. Not usable for arbitrary participants. |
| App-only `OnlineMeetingTranscript.Read.All` / `OnlineMeetingRecording.Read.All` (the app holds these) | Needs an **app-only token** (client secret) **and** a Teams application access policy (`New-CsApplicationAccessPolicy`, admin PowerShell). A no-backend browser SPA **cannot hold a secret** (see §6 for the same no-backend wall). And it would not bypass this SharePoint protected-mp4 gate anyway — that's a separate control. |
| SharePoint `media/transcripts` + `streamContent` rewrite (this file's strategy) | **Is** the gated surface. Both the `$expand` and the `.../streamContent?is=1&applymediaedits=false` download hit the protected-media pipeline. |

### Verdict: BLOCKED-external

There is **no in-code alt-path** that restores non-organizer recording-transcript
download from this no-backend SPA + third-party app model. The only resolutions are
Microsoft-side:

1. **Whitelist the app.** Get app id `63231eb0-9b53-4342-8ac4-5209d618684e` added to
   Microsoft's allow-list for the protected-mp4 media API. This is a Microsoft-controlled
   list, not a self-service consent — there is no known public request flow for a
   third-party app. The exact gated endpoint to cite in any request:
   `GET https://{spHost}/_api/v2.1/drives/{driveId}/items/{itemId}?$expand=media/transcripts`.
2. **Run in a first-party origin/cookie context** — i.e. a browser extension at the
   Stream/SharePoint web origin (the reference-extension architecture), which uses the
   session's own whitelisted identity. That is an **architecture change**, not an edit to
   this SPA.

### Recommended in-code follow-up (graceful degradation — NOT a fix)

This does not recover the transcript; it stops one expected-permanent 403 from looking
like a scary generic failure, matching the house pattern for §7 `AclCheckFailed` and
`CrossTenantRecordingError`. It spans two files (the second is outside this lane's
ownership, so it is recorded, not applied here):

- `teams-recordings.ts` — in `fetchRecordingTranscripts`, when the metadata response is
  403 and the body matches `not whitelisted` / `protected mp4`, throw a typed
  `ProtectedRecordingError` (discriminant `protectedRecording = true`, mirroring
  `CrossTenantRecordingError`) instead of the generic `Error(...)`.
- `main.ts` `downloadRecordingTranscript` catch (~:3778) — add an
  `else if ((err as {protectedRecording?: boolean}).protectedRecording)` branch that
  sets a calm status ("protected recording — Microsoft only allows first-party apps to
  download it") and returns a new typed outcome counted separately from `fail`, the way
  `cross-tenant` already is (~:3819, :3825).

Until then, the whitelist 403 lands in the generic `fail` bucket: it shows
`Error: SharePoint metadata: 403 … not whitelisted` and logs a `console.error`.

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
