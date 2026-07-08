# m365-pull — Unified Containers IA Direction

**Date:** 2026-06-12
**Author:** Layout Architect
**Status:** Exploratory direction — input to a build, not a pixel spec
**Builds on:** [`m365-pull-triage-redo-direction-2026-06-11.md`](./m365-pull-triage-redo-direction-2026-06-11.md) · [`m365-pull-design.md`](./m365-pull-design.md) · [`m365-pull-ia-layout-2026-05-22.md`](./m365-pull-ia-layout-2026-05-22.md)
**Supersedes:** §5 of the 2026-06-11 doc ("keep chats + recordings as separate surfaces"). Reverses it. Everything else in that doc stands and this builds on it.
**Stack reality:** vanilla TS/DOM, no framework, no design system. Every recommendation here is buildable with plain DOM + the existing OneDrive `state.json` model.

---

## 0. The reframe in one line

Yesterday I argued chats and recordings were **two sources** that should share a grammar but not a list. The live data says they were never two sources: **a recording is an artifact produced by a call held inside a chat.** Recordings aren't a sibling of chats — they're *contained by* chats. My §5 rejected a unified list to protect a "container model" that, it turns out, is the exact reason to unify. The container model **is** the unification.

So this doc commits to the user's epiphany — **one list of containers** — and then does the honest engineering work the reframe demands: a row anatomy that survives the cost constraint, artifact toggles that don't recreate the confusion §4 just solved, and a select→sync grammar that preserves "separate files per call."

---

## 1. Verdict: **unify the list.** I'm reversing §5.

**Recommendation: one list of containers. The "Recordings" surface dissolves into a facet of the chat container.** Decisive.

### Why the new evidence flips my own §5

My §5 rejection rested on one sentence: *"sources are structurally heterogeneous… recordings' container model is a relationship a flat unified list would obscure."* Three proven realities dismantle each clause:

1. **They are not heterogeneous sources.** A container = a Teams chat holding 0–N messages **and** 0–N call recordings/transcripts. Recordings attach to 1:1, group, *and* meeting chats — they are sprinkled across the existing chat list, not gathered in a parallel one. There is no coherent place for a recording to live *except on its chat's row.* A separate "Recordings" surface doesn't represent a source; it **fragments a container**, forcing the user to triage one conversation twice and reconcile two decisions about one thing. That's the surface-level twin of the "marked-but-ignored" nonsense state §1 worked so hard to forbid.

2. **The "container model" is an argument *for* unifying, not against.** I cited "mark a chat → sync all its recordings" as a relationship a flat list would hide. Backwards. That relationship is *literally a container with artifacts inside it* — which is exactly what a container row makes visible and a two-surface split makes invisible.

3. **Unify is the *cheaper* build.** Channel meetings are unreachable (`/me/joinedTeams` = 403; channel chats largely absent from `/me/chats`). So the universe of containers ≈ the chats list we already fetch, **annotated** with a recording signal. We are not constructing a second list and keeping it in sync — we are adding two columns to the one list we have and **deleting** a surface. Less chrome, less code, one muscle memory.

### How the container list subsumes both surfaces

| Old surface | New home |
|---|---|
| Teams Chats (messages) | The default container list, `Include: 💬✓ ▦✓` |
| Call Recordings (transcripts) | The same list with `Include: 💬✗ ▦✓` — a saved "Recordings-only" filter, not a sidebar peer |

One list. The artifact toggle (§4) chooses which facet you're staring at. The separate "Recordings" entry in the sidebar becomes a one-click saved view, not a second world to learn.

### What we lose (the steelman for keeping separate)

The honest cost of unifying: a user whose mental model is *"just show me every call transcript I haven't grabbed"* loses a dedicated home for that. My answer — it becomes `Include: recordings-only` over the unified list — is a filter, not a place, and filters are slightly less discoverable than a labelled nav item. I judge this a fair trade: the user's verbatim intent is container-centric ("**I'd want it all for that container**"), the recordings-only case is the minority, and a saved view recovers most of the discoverability. If usage later shows people live in recordings-only mode, promote that saved view to a pinned sidebar entry — a one-line change, and it's *still* the same unified list underneath.

**The 10-source roadmap is unaffected.** Email, Files, Calendar, etc. remain distinct sidebar sources. We are collapsing a *false sibling* (recordings were never a roadmap source), not the taxonomy. If anything this *strengthens* the roadmap: each sidebar source becomes "a list of containers appropriate to that source," and "container holds N artifact types" is now a reusable pattern.

---

## 2. The container model — get this right; the rows fall out of it

Three facts, one model:

- **The chat is the container.** It may hold messages only, recordings only, or both. It may exist with no call ever (a quiet 1:1) or span many calls (a standing group chat where people dial in ad hoc).
- **A recurring meeting spawns a new chat id per occurrence** (proven: one topic → 5 distinct ids; no stable series key). So one "series" = many containers. This *matches* the user's instinct — "each call should be separate, with its own files." We don't fight it; we render it.
- **Container = folder. Artifact = file.** This is the spine of §5's select→sync grammar and it makes "keep the files separate" automatic:

```
/OneDrive/m365-pull/teams/
  Weekly Standup — Eng · 2026-06-08/        ← occurrence = its own container = its own folder
     messages.json                           ← the chat-as-artifact
     call-0931.transcript.vtt                ← a call held in this chat
     call-0931.media.mp4   (if requested)
  Weekly Standup — Eng · 2026-06-01/        ← prior occurrence = SEPARATE folder
     messages.json
     call-0930.transcript.vtt
  Dana Reyes (1:1)/
     messages.json                           ← no calls; messages only
  Project Falcon (group)/
     messages.json
     call-1402.transcript.vtt                ← ad-hoc call inside a standing chat
     call-1815.transcript.vtt                ← a second call, separate file
```

Both shapes — "one occurrence, one call" and "one standing chat, many calls" — fall out of *container = folder, artifact = file* with no special cases. The chat is always its own artifact; each call is always its own file.

---

## 3. Container row anatomy — under the cost constraint

The user wants `# messages` and `# recordings` on every row. The cost constraint says we **cannot** afford exact recording counts up front: resolving a meeting + listing its recordings is a per-chat Graph round-trip, and only ~40% of meeting chats even resolve. Eagerly resolving 142 inbox containers would stall the list. So the row is built on one rule:

> **Show everything that's free instantly. Make everything expensive an affordance, paid on demand, cached forever after.**

### Eager vs lazy — explicitly

| Row element | Source | Cost | Eager / Lazy |
|---|---|---|---|
| Selection checkbox | client | free | **eager** |
| Title / participants | `/me/chats` payload (already fetched) | free | **eager** |
| Type chip · 1:1 / Group / Meeting | chat `chatType` | free | **eager** |
| Last-active timestamp | chat payload | free | **eager** |
| **Message presence** ("has messages") | chat `lastMessagePreview` exists | free | **eager** |
| Message **exact count** (in window) | page messages in window | moderate | **lazy** — on expand, or shown post-sync |
| **Recording presence** ("maybe has recordings") | cheap heuristic *(see below)* or cache | cheap-if-cached, else unknown | **eager-if-known**, else `?` |
| Recording **exact count** | resolve meeting + list recordings | **expensive · ~40% resolve** | **lazy** — on expand / at pre-flight; cached + negative-cached |
| Sync state ("Never" / "3h ago") | `state.json` lastSync (local) | free | **eager** |

### The recording signal: three fidelity tiers

The honest problem: even *"does this have recordings?"* isn't reliably free. So degrade gracefully across three tiers, and never block the row on the expensive one:

- **Tier 0 — Known (free):** we resolved it before and cached the answer in `state.json` (a count, or a "none"). Show it: `▦ 3` or `▦ —`.
- **Tier 1 — Hinted (cheap, if a signal exists):** Teams frequently posts a recording card *into the chat message stream*. If that card is visible in data we already touch, render a hollow `▦ ?` meaning "probably — expand to confirm." **Flagged as needs-verification — do not assert this heuristic is reliable; design so its absence costs nothing.**
- **Tier 2 — Resolved (expensive, on demand):** user expands the row, or selects it for download. We pay the round-trip *then*, for *that* container, and **write the result to the cache** (including a negative "none" so the ~60% that don't resolve are never retried blindly).

Row in the wild (Inbox, both artifact types included):

```
☐  [Meeting] Weekly Standup — Eng · Jun 8        8 ppl   active 2h ago
      💬 142    ▦ ? ▸ resolve                              Never synced
☐  [1:1]     Dana Reyes                                   active 1d ago
      💬 38     ▦ —                                        Synced 3h ago
☐  [Group]   Project Falcon                      6 ppl   active 4d ago
      💬 540    ▦ 2 ▸                                      Synced 2d ago
```

Expanded (Tier 2 paid; result cached):

```
▾  [Meeting] Weekly Standup — Eng · Jun 8        8 ppl   active 2h ago
      💬 142 messages                                      Never synced
      ▦ Recordings (resolved just now, cached):
          • 09:31 · 32 min · transcript ✓ · media available
      (this occurrence held 1 call)
```

### The activity window is also a cost governor — this is the unlock

Here is where §4's "narrow then act" stops being only an ergonomics story and becomes the **cost strategy**. Resolving recordings for 142 containers is unaffordable. Resolving them for the **20 containers left after `Active in: 7d`** is trivial. So:

> Recording resolution is **scoped to the narrowed set** — what's on screen, inside the active window, or selected. Never the whole pool. The same narrowing the user already does to make the list legible is what makes exact counts affordable.

Concretely: a "Resolve recordings for these 20" action lights up only once the visible/narrowed set is small enough to be cheap; below a threshold it can even auto-resolve. The user's instinct to filter *is* the budget control. They get their exact counts — for the set they actually care about, exactly when narrowing has made it cheap.

---

## 4. The artifact-type toggles — one concept, three aligned effects

The user asked for "filters to toggle whether I want messages or recordings," but *also* "it shouldn't matter whether they have messages or recordings… **I'd want it all for that container.**" Those aren't in conflict — they're a default and a refinement:

- **Default:** the container is the unit; you want everything in it.
- **Refinement:** sometimes you only care about one facet (give me only call transcripts).

So the toggle is **one control — "which artifact types am I collecting right now"** — living in the Narrow strip (Job 2), default both-on:

```
🔍 search  [1:1][Group][Meeting]  Active in: 30d ▾  Sort ▾   Include: [ 💬 Messages ✓ ] [ ▦ Recordings ✓ ]
```

It composes three *aligned* effects (all pointing the same direction — toward the artifacts you said you want):

| Toggle state | List effect | Resolution effect | Download scope |
|---|---|---|---|
| **💬✓ ▦✓** (default) | show all containers; both counts | resolve recordings lazily as usual | fetch both → `messages.json` + call files |
| **💬✓ ▦✗** | optionally hide recording-only containers (nothing to get) | don't bother resolving recordings | messages only |
| **💬✗ ▦✓** (recordings-only) | filter to containers that have recordings | **strong hint: resolve recordings for the narrowed set** | transcripts only |

The third row is the killer mode — "give me all my call transcripts." Flipping messages off and recordings on *is itself the signal* that recordings matter, which justifies paying resolution for the (already narrowed) set. One control doubles as list filter, resolution trigger, and download scope.

### Won't this recreate the §4 confusion?

Fair worry — I just spent §4 of the prior doc deleting two controls that confused people. The difference is **diagnostic, not cosmetic.** The activity-window vs lookback pair confused users because they were two *opposed* time concepts from *different jobs* sitting side by side (one filters the list, one parameterizes a download). The artifact toggle's three effects are not opposed — they all express *one* intent ("I care about this facet"), and they reinforce rather than cross. It's one concept with aligned consequences, not two concepts masquerading as neighbors. The labelling rule that keeps it honest: the toggle reads **"Include:"** (collection intent), never "Show:" (which would imply pure list-filtering and hide the download consequence).

### Composition with the rest of the grammar

```
Bucket (scope)          Kept / Inbox / Ignored          — orthogonal, unchanged (keys by containerId = chatId)
Activity window (narrow) Active in: 7d/30d/Custom        — orthogonal; also the resolution budget governor
Artifact toggle (narrow+scope) Include: 💬 / ▦           — AND-filter on the list, AND sets download scope
Selection               select within the narrowed set   — unchanged
Action bar              Keep / Ignore / Download          — Download honors the artifact scope
```

A Download action's full predicate: **selected containers × artifact scope × lookback.** Clean and legible.

### Per-container artifact flags? Mostly **YAGNI** — with one reserved seam.

Persisting "messages-only here, recordings-only there" per container is a taxonomy-management burden with no stated need — reject it, consistent with the prior doc's discipline. Global scope + the container-as-unit covers the verbatim intent. Two honest exceptions, neither of which is persisted per-container state today:

1. **At pre-flight**, let the user drop an artifact type for *this run* (per-operation override, not saved).
2. **A Kept container kept purely for its transcripts** would waste bytes re-syncing messages each recurring sync. This is the *one* place a persisted per-container scope earns its keep — but the user hasn't asked, so **reserve schema room and don't build it** (same play as the prior doc's `ignoreRules`).

---

## 5. "Select containers → sync everything for them" — the fan-out grammar

Selecting a container is a **fan-out**: one selection expands to *1 message archive + 0–N recording transcripts (one per call/occurrence in window)*, each landing as its own file under the container's folder (§2). The container is the **selection unit**; the artifact is the **fetch unit** and the **file unit**. "Keep the files separate" is not a feature we add — it's the default shape of the model.

```
SELECT (unit)         FAN-OUT (fetch + files, honoring artifact scope + lookback)
─────────────         ──────────────────────────────────────────────────────────
☑ Weekly Standup       → messages.json
  · Jun 8              → call-0931.transcript.vtt          (1 call this occurrence)
☑ Project Falcon       → messages.json
                       → call-1402.transcript.vtt          (separate file)
                       → call-1815.transcript.vtt          (separate file)
☑ Dana Reyes (1:1)     → messages.json                     (no calls; messages only)
```

### Pre-flight is where the expensive resolution gets paid — and that's the right place

This is the cleanest answer to the cost constraint: **you pay recording resolution exactly when you've committed to download, for exactly the set you chose.** The cost is never speculative.

```
┌─ Download · pre-flight ──────────────────────────────────────────────┐
│  12 containers selected · Include 💬 ▦ · Lookback 30d                 │
│                                                                       │
│  Resolving recordings for these 12…  ✓ done                          │
│    → 12 message archives                                              │
│    → 27 recordings across 18 calls                                    │
│    ⚠ 3 meeting chats couldn't resolve recordings (Graph 403/empty)   │  ← honest about the ~60% gap
│                                                                       │
│  [ Include media files ☐ ]   [ Lookback: 30d ▾ ]                     │  ← per-operation overrides
│                                            [ Cancel ]  [ Download ]   │
└───────────────────────────────────────────────────────────────────────┘
```

State-flips (Keep / Ignore / Un-ignore) stay instant + undoable as in §2 of the prior doc — selecting and keeping a container is silent and reversible. Only **Download** carries the pre-flight, because it's the only verb that resolves recordings, spends bytes, and writes files. The pre-flight also surfaces the proven ~60% non-resolution honestly rather than silently dropping artifacts.

---

## 6. The recurring-meeting consequence — proven id-instability has a second edge

The same answer that drives unification — **new chat id per occurrence** — is the exact answer my prior §6 (probe #1, ranked 🔴 HIGHEST) said would make per-item ignore *whack-a-mole* and could *force* rule-based ignore. I'd be negligent to unify and not connect that wire.

What the proven data does and doesn't allow:

- **Per-occurrence is real and partly *desired*.** The user wants each call separate with its own files — so per-occurrence *containers* are correct, and per-occurrence *Keep* may even be the right default (consciously grab each week's). The container list renders this natively: 5 occurrences = 5 rows.
- **But triage drowns.** Five recurring meetings × N weeks = a firehose of near-identical Inbox rows, and ignoring occurrence 1 does nothing for occurrence 2 (new id). Whack-a-mole, confirmed.
- **There is no series key to rule on.** No stable series id exists in the metadata. Any "series" notion must be a **client-side heuristic** — normalized title + participant-set overlap — not a server fact.

### Recommended ergonomic layer: client-side series grouping (cheap, reversible)

Cluster per-occurrence containers under a collapsible header by title+participant match — purely a render-time grouping over data already loaded. No server support, no schema, no provenance problem:

```
▸ ⟳ Weekly Standup — Eng        5 occurrences · Jun 8 … May 11     [ Select series ]
▸ ⟳ Falcon Sync                 4 occurrences · Jun 7 … May 17     [ Select series ]
  ☐ Dana Reyes (1:1)            active 1d ago
  ☐ Project Falcon (group)      active 4d ago
```

Expanding a series reveals each occurrence **as its own container** (its own folder/files preserved). `Select series` selects all *current* occurrences in one move — so the whack-a-mole becomes one sweep, composing with the existing bucket + selection + action-bar grammar. This addresses the proven pain at the **triage-ergonomics** layer without committing to rule machinery.

### The rule layer is now *more likely needed* — but still gated

"**Keep / Ignore future occurrences matching this**" is a standing predicate (title/participant match) — the `ignoreRules`/`keepRules` the prior doc reserved. Probe #1's answer raises its probability from "maybe never" to "probably eventually," because client-side grouping handles *today's* occurrences but not *next week's* fresh id. Still, hold the line: ship **flag-based per-container Keep/Ignore + client-side series grouping** first (covers the stated pain, no new merge semantics), and add title/participant rules only when the user hits the "I re-ignored this series three weeks running" wall. Reserve the schema seam; don't build the CRUD + provenance ("why is this hidden?") UI speculatively.

---

## 7. Migration — vanilla DOM, existing `state.json`, coexists with the tri-state grammar

This is **additive plus one deletion**, not a rebuild. Buckets, selection, action bar, the §4 control-bar untangling, and lookback-at-download all operate on containers unchanged — because **a container's id *is* its chat id**, so `marked`/`ignored` already key correctly with zero migration.

### State schema delta (on top of the prior doc's `marked`/`ignored`/`lookback`/`lastSync`)

```jsonc
"teams.chats": {
  "marked":  ["chatId…"],          // unchanged — chatId == containerId, no migration
  "ignored": ["chatId…"],          // unchanged
  "lookback": { "default": "30d", "overrides": {} },

  // NEW — recording resolution cache (rides the file, NOT pure set-union; see merge note)
  "recordings": {
    "chatId…": { "count": 3, "resolvedAt": "iso…", "callIds": ["…"] },
    "chatId…": { "count": 0, "resolvedAt": "iso…" }   // negative cache: the ~60% that don't resolve
  },

  // lastSync stays container-level for the displayed "synced Xh ago".
  // Optional per-artifact map for incremental fetch (don't re-pull a transcript we have) — reserved, build when needed:
  "lastSync": { "chatId…": "iso…" /* , "artifacts": { "callId…": "iso…" } */ }
}
```

Global artifact-scope default rides the existing cross-device prefs (P9):

```jsonc
"prefs": { "include": { "messages": true, "recordings": true } }
```

### Two honest merge notes (don't leave implicit)

- **`recordings` is the first field that is NOT set-union.** Counts/resolution can't union — merge by **newer `resolvedAt` wins** per chatId. Cheap to specify, must be written down next to the existing `marked` union rule. Treat cached counts as *hints*: re-resolve on demand and at sync time, since recordings accrue over time.
- **`include` pref is a UI preference** — last-writer-wins is fine; it's not a decision that needs preserving across devices the way `marked`/`ignored` are.

### Vanilla-DOM feasibility

Nothing here needs a framework:
- **Unified list** = the chats list we already render, plus two columns. The virtualized list was already mandatory for hundreds of rows.
- **Lazy recording resolution** = an on-demand `fetch` bound to row-expand / pre-flight, result written to `state.json`. Plain async + cache.
- **Artifact toggles** = two checkboxes driving the list predicate and the download scope.
- **Series grouping** = a string-normalize + group-by over loaded rows; a `<details>`-style collapse. No server, no state.
- **Fan-out download** = the existing sync engine, parameterized by `{containers, scope, lookback}`.

Net surface change vs the two-surface design: **less.** One list instead of two, one grammar instead of two parallel ones, minus a deleted "Recordings" nav entry, plus two columns and two checkboxes.

---

## 8. What this supersedes in the 2026-06-11 doc (explicit retraction map)

| Prior doc | Status now |
|---|---|
| §5 "keep chats + recordings as separate surfaces; unify the grammar not the list" | **Reversed.** Unify the list. Recordings are a facet/column of the chat container, not a peer surface. |
| §4 control-bar table row: *"source (chats/recordings) → sidebar"* | **Amended.** That row is gone as a *source* switch; the chats/recordings choice is now the **`Include:` artifact toggle** in the Narrow strip — a facet of one source, not two sources. |
| §6 probe #1 (🔴 stable id vs per-occurrence) | **Answered: per-occurrence (new id each time).** Triggers §6 here: client-side series grouping now; title/participant Keep/Ignore rules reserved and now *more likely* eventually needed. |
| §6 probe #2 (Team-level ignore) | **Still off the table** — channel meetings unreachable (403). Ship chat/container-level cleanly. |
| §1–§3, §4 (buckets, selection, action bar, control-bar-by-job), §7 tradeoffs | **Unchanged and load-bearing.** They now operate on *containers*, which only simplifies them (one surface, not two). |

---

## 9. Honest tradeoffs

- **The user wants eager counts; the data can't cheaply give them.** This is the central tension and I won't paper over it. The resolution — counts are free-if-cached, an affordance otherwise, and *cheap once you've narrowed* — gives the user real counts for the set they care about, but it does mean a fresh, unnarrowed Inbox shows `▦ ?` on meeting rows rather than a number. That's the price of not stalling the list on 142 round-trips. The activity-window-as-budget-governor is what makes the price small; if the user refuses to narrow, they wait for resolution. Acceptable, and honestly surfaced rather than hidden behind a spinner.
- **One control, three effects (the artifact toggle) is a deliberate overload.** I argued it's safe because the effects are *aligned*, not crossed (unlike the activity/lookback pair). But overloads always carry a comprehension risk; the `Include:` labelling and the both-on default are the guardrails. If testing shows confusion, split list-filter from download-scope — at the cost of more chrome.
- **Recordings-only loses a dedicated home.** A saved view, not a nav entry. Minority use case; promotable later if usage demands. Stated plainly in §1.
- **`recordings` breaks the pure set-union merge invariant.** First non-union field. Small, well-defined (`resolvedAt` wins), but it *is* new merge surface and must be documented, not absorbed silently.
- **Client-side series grouping is a heuristic** — title+participant match will occasionally mis-group (two different "Sync" meetings) or fail to group (renamed series). It's reversible and cheap, and it degrades to "just a flat list of containers," which is still correct. But it is not truth, and shouldn't be sold as series *identity* — only as a triage convenience.
- **The rule layer is deferred against a now-rising probability.** Proven id-instability means per-occurrence Keep/Ignore *will* feel like whack-a-mole for heavy recurring users sooner than yesterday's "maybe never." We're betting client-side grouping buys enough runway. If it doesn't, the reserved schema seam keeps the eventual rule layer from being a painful migration — but we are consciously choosing to feel that pain before building for it.

---

## 10. Recommended direction in one paragraph

The live data falsified my §5 premise: recordings were never a second source — **a recording is an artifact of a call held inside a chat**, so the chat *is* the container and the two surfaces were one surface fragmented. **Unify into a single list of containers**, each row carrying identity/type/participants + a message signal + a recording signal + sync state, where everything *free* (from the chats payload and local `state.json`) renders **instantly** and the **expensive** recording count is an **affordance** — paid lazily on expand or at download pre-flight, cached forever after (negative cache included for the proven ~60% that never resolve), and made cheap precisely *because* the activity window narrows the set first (the filter doubles as the resolution budget). Artifact collection is **one `Include: 💬 / ▦` toggle** in the Narrow strip — default both-on for the "I want it all for this container" case, flippable to recordings-only for "give me all my transcripts," and composing as list-filter + resolution-hint + download-scope at once. **Selecting a container fans out** to one message archive + N separate call-transcript files under a per-container folder — so "each call separate, its own files" is the model's default shape, not a feature — and the download **pre-flight is where the expensive resolution is honestly paid** for exactly the chosen set, ~60% gap surfaced rather than hidden. Recurring meetings (proven: **new id per occurrence**) render natively as one-row-per-occurrence, tamed for triage by **cheap client-side series grouping** (title+participant), with standing **Keep/Ignore rules reserved** — now more likely needed, still gated on real pain. All of it is **additive on the existing `state.json`** (buckets unchanged because containerId == chatId; one new non-union `recordings` cache to document) and **buildable in vanilla DOM** as *less* surface than the two-surface design it replaces: one list, one grammar, two columns, two checkboxes, minus a deleted Recordings nav entry.
