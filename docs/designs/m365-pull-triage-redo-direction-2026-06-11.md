# m365-pull — Triage-at-Scale UX Direction

**Date:** 2026-06-11
**Author:** Layout Architect
**Status:** Exploratory direction — input to a brainstorm, not a pixel spec
**Builds on:** [`m365-pull-design.md`](./m365-pull-design.md) · [`m365-pull-ia-layout-2026-05-22.md`](./m365-pull-ia-layout-2026-05-22.md)
**Stack reality:** vanilla TS/DOM, no framework, no design system. Every recommendation here is buildable with plain DOM + the existing OneDrive `state.json` model.

---

## 0. The hinge: the core assumption just changed

The 2026-05-22 IA was explicit about its premise:

> "Users will have 10–50 marked items at steady state. They're not scanning a feed; they're managing a working set." — *ia-layout §3*

The new pain falsifies that premise. The user has **hundreds** of chats, **most of which they never want**, many **recurring or long-lived**. The job is no longer "curate a small working set." It's **triage a firehose down to signal** — repeatedly, over time.

That single shift reframes everything:

| Old frame (working set) | New frame (triage at scale) |
|---|---|
| Few marked items, managed by hand | Hundreds of candidates, reduced in bulk |
| Per-row actions are enough | Per-row alone is whack-a-mole; bulk is mandatory |
| "Marked" vs "not marked" (binary) | A **decision** must be recordable on each item, including "make this go away" |
| Mark is the only verb | **Ignore** is now a peer verb to Mark |
| The list = your kept set | The list = a candidate pool you're draining |

Everything below follows from taking that reframe seriously. **Don't bolt "ignore" onto the working-set design — let the triage frame drive the layout.**

---

## 1. State model — get this right first; layout falls out of it

The user lumped four things together: *download / mark / ignore / un-ignore*. They are **not the same kind of thing**, and conflating them is the trap. Separate two axes:

### Axis A — the triage decision (tri-state, mutually exclusive)

Every item is in exactly one of three states:

```
 ┌───────────┐   Keep    ┌───────────┐
 │ UNDECIDED │ ────────▶ │   KEPT    │   ★ marked — in the recurring sync set
 │  (Inbox)  │           │ (marked)  │
 │           │ ◀──────── │           │
 │           │  Unkeep   └───────────┘
 │           │
 │           │  Ignore   ┌───────────┐
 │           │ ────────▶ │  IGNORED  │   hidden from default view, recoverable
 │           │           │           │
 │           │ ◀──────── │           │
 └───────────┘ Un-ignore └───────────┘
        (Keep ⇄ Ignore can also switch directly)
```

- **Undecided / Inbox** — the default. New chats land here. This is the triage backlog.
- **Kept (marked)** — your recurring sync set. Unchanged meaning from today.
- **Ignored** — persistently hidden from the default view. **Not deleted, always recoverable.**

Mark and Ignore are **opposite decisions about the same question** ("do I care about this chat?"). Modeling them as a tri-state — not two independent booleans — is what keeps the UI honest: an item can't be both kept and ignored, and "undecided" is a real, countable state you can drain toward zero.

### Axis B — downloaded (an orthogonal *fact*, not a decision)

`downloaded` is **not a peer of marked/ignored.** It's a derived attribute — "does a `lastSync` timestamp exist for this item?" A kept item gets downloaded; an ignored item never does. Treating "downloaded" as a fourth bucket conflates *a user decision* with *a historical fact* and produces nonsense states ("ignored but downloaded?"). Keep it as a filterable attribute (`Hide downloaded`, "Never synced", "Synced 3h ago"), exactly as it works today — just don't promote it to a bucket.

### Why tri-state buckets, not free-form tags

Tags/labels were considered and **rejected as YAGNI** (consistent with this project's Decision Log discipline). There is exactly one decision axis with three values. Free-form tags add a taxonomy-management burden, a "what do these tags mean?" problem, and merge complexity — for zero evidence of need. If a real second axis emerges later (e.g. "priority"), revisit. Not now.

### State schema delta (fits the existing ETag merge model)

```jsonc
"teams.chats": {
  "marked":  ["chatId…"],     // unchanged
  "ignored": ["chatId…"],     // NEW — per-item ignore flags
  // reserved, PROBE-GATED (see §6) — do not build yet:
  // "ignoreRules": [{ "type": "team", "id": "…" }, { "type": "titleMatch", "pattern": "…" }],
  "lookback": { "default": "30d", "overrides": {} },
  "lastSync": { "chatId…": "iso…" }
}
```

**Merge rule for `ignored`: set-union per source** — identical to the rule already documented for `marked` (design.md §State storage). This is the cheapest possible addition: it reuses the proven concurrency model verbatim. One subtlety to define: if a chat is in both `marked` and `ignored` after a cross-device merge (user kept on Device A, ignored on Device B), pick a deterministic winner. Recommend **`marked` wins** (the constructive decision; ignore is recoverable anyway) and document it next to the existing merge rules.

---

## 2. Selection ↔ action model — decouple, but keep per-row for the singleton

**Recommendation: add a selection layer that composes with filters; keep lightweight per-row actions.** Don't replace per-row with select-then-act — layer them.

### Why both, not either

- **Pure per-row** (today): fine for one chat, brutal for ignoring 200. Fails the new scale.
- **Pure select-then-act** (Gmail checkbox model): great for bulk, but adds a select step to the *single most common* action. Friction tax on the singleton case.
- **Both, layered:** per-row quick verbs for the one-off; a selection layer that appears only when you're working in bulk. This is the Linear/Gmail/GitHub pattern this audience already knows.

### The composition that makes it powerful: "select all matching the filter"

This is the killer flow and the whole reason to decouple:

```
search "standup"  →  [Select all 23 matching]  →  Ignore
search "[external]" → type:Group → [Select all] →  Ignore
filter: active in last 7d, Inbox → eyeball → check 5 → Keep
```

Selection must compose with **search + type chips + the activity window + the current bucket**. The mental model: *narrow the list with filters, then act on the whole filtered set (or a hand-picked subset of it) in one move.* That single capability is what turns "hundreds of chats" from a wall into a few sweeps.

### The contextual action bar (appears only on selection)

When selection count > 0, a bar slides in (replacing or overlaying the filter toolbar):

```
┌──────────────────────────────────────────────────────────────────────────┐
│ ☑ 23 selected   [Keep]  [Ignore]  [Download ▾]  [Un-ignore]      [Clear]  │
└──────────────────────────────────────────────────────────────────────────┘
```

Critical distinction to honor in the bar — the two *kinds* of verb from §1:

- **Keep / Ignore / Un-ignore** are **state flips** — instant, silent, reversible. No progress panel. They just move items between buckets (with an undo toast, see below).
- **Download** is an **operation** — it kicks off the existing pre-flight + sync progress panel. It's the heavyweight verb and should look it (primary button + `▾` for destination/lookback override).

Which verbs show is **context-sensitive to the current bucket**: in Inbox show `Keep / Ignore / Download`; in Ignored show `Un-ignore / Keep`; in Kept show `Download / Ignore / Unkeep`. Don't show `Un-ignore` where nothing is ignored.

### Undo is non-negotiable for bulk

Bulk Ignore on 200 items must be reversible in one gesture: a toast — `Ignored 23 chats. [Undo]` — that persists ~10s. This is the safety net that lets users act fast without fear. Cheap to build (keep the last bulk op's id list in memory).

---

## 3. Buckets as primary nav — and what the user *actually* wanted from a "wizard"

### Recommendation: single screen, **segmented bucket control**. No wizard.

Replace the current `Marked only` toggle with a three-way segmented control at the top of each source surface:

```
┌─────────────────────────────────────────────────────────────┐
│  [ ★ Kept  18 ]  [ Inbox  142 ]  [ Ignored  87 ]            │  ← bucket switch + counts
└─────────────────────────────────────────────────────────────┘
```

- **Counts are the whole point.** `Inbox 142` is a visible backlog that invites triage; watching it drop is the sense of progress a wizard would fake. `Kept 18` is your working set. `Ignored 87` proves nothing vanished — it's a door, not a trapdoor.
- **Default landing: Kept.** The #1 task (per the original IA's own frequency ranking) is "trigger a sync on the kept set." Returning users want their working set, not a triage wall, on every load. But the `Inbox 142` badge sits right there, one click away, pulling you in when you're ready to triage. This honors both the established primary task *and* the new pain — without forcing triage on every visit.

### Pressure-testing the wizard idea (the user asked me to)

A multi-step wizard is **the wrong tool for this user** — and I'd push back on it directly:

- Wizards serve **infrequent, linear, high-stakes setup** (first-run config, irreversible migrations). Triage here is **frequent, non-linear, exploratory, and reversible** — the exact opposite profile.
- This audience is technical and does this **repeatedly**. A wizard taxes every single session with steps they've memorized. The existing first-run design already rejected a wizard for exactly this reason (ia-layout §7: *"technical people who read instructions by not reading them"*). That logic applies double to a recurring power task.

**But the wizard instinct is pointing at something real.** The user senses the flow has *phases*: **find → select → decide/act.** The right answer isn't to *force* those phases sequentially (a wizard) — it's to make them **legible on one screen** so the user can move through them in any order: act-then-refine, or filter-then-select-all, or pick-one-and-go. The phases become a *rhythm the layout supports*, not *steps it imposes*. The segmented buckets (sense of progress) + the contextual action bar (clear "now act" affordance) deliver the wizard's legitimate value — orientation and momentum — with none of its friction.

The one place a *confirmation step* is genuinely warranted: a **bulk download** of many items with large lookbacks. That's the existing pre-flight dialog (design.md §Pre-flight) — a single confirm, not a wizard. Keep it; it's the safety valve for the one verb that costs real time and bytes.

---

## 4. Control-bar restructure — the two "range" controls confused people because they belong to different *jobs*

The root cause of the confusion isn't labeling — it's that the top bar mixes **three distinct jobs** into one dense strip. Untangle by job:

| Job | Controls | Where it belongs |
|---|---|---|
| **1. Scope** — which set am I looking at? | bucket (Kept/Inbox/Ignored), source (chats/recordings) | Top: segmented control + sidebar |
| **2. Narrow** — find within the set | search · type chips · sort · **activity window** ("active in last 7d") · Hide downloaded | A single filter toolbar |
| **3. Act** — do something | per-row verbs · the selection action bar · **download lookback** | On rows / in the action bar / in pre-flight — **not** the top bar |

### The decisive move: pull "Download history per chat" OUT of the top bar entirely

The two confusable controls are:

- **"Show chats from"** = an **activity window** — *which chats appear* (Job 2, Narrow). It filters the candidate list by how recently the chat was active.
- **"Download history per chat"** = a **lookback** — *how much history to fetch when downloading* (Job 3, Act). It parameterizes the download operation.

They confused users because they sat **side by side** despite belonging to **different jobs**. The fix isn't a better label — it's **physical separation by job**:

- **Activity window stays** in the filter toolbar (Job 2), and since its confusable neighbor is gone, it can finally have an unambiguous name: **"Active in:"** (This week / 30d / Custom…). It's clearly "filter the list."
- **Lookback leaves the top bar.** It already lives where it belongs: the per-row lookback chip (per-item default) and the download pre-flight (per-operation override). A global "download history" control at the top was always answering a question that only matters *at the moment of download* — so ask it there. This **deletes one of the two confusable controls from the global chrome**, which is the cleanest possible resolution.

### Resulting top region (chats surface)

```
┌──────────────────────────────────────────────────────────────────────────┐
│  Teams Chats                                              [Download Kept ▾]│  ← title + primary act on Kept
│  [ ★ Kept 18 ]  [ Inbox 142 ]  [ Ignored 87 ]                             │  ← Job 1: scope (buckets)
│ ──────────────────────────────────────────────────────────────────────── │
│  🔍 search   [1:1][Group][Meeting]   Active in: 30d ▾   Sort ▾  ☐ Hide synced│  ← Job 2: narrow
└──────────────────────────────────────────────────────────────────────────┘
            ↑ when selection > 0, Job-2 row is replaced by the action bar (§2)
```

Three stacked strips, each doing **one job**. The lookback — the thing that caused the confusion — is no longer in this picture at all. `★ always show marked` (today's odd toggle) is subsumed: "Kept" is just a bucket now.

---

## 5. Two sources (chats + recordings) — unify the *grammar*, not the *list*

**Recommendation: keep them as separate sidebar surfaces; make their interaction grammar identical.**

The existing IA rejected a unified list (Option C) because sources are structurally heterogeneous, and that reasoning still holds for the 10-source roadmap. Don't merge chats and recordings into one list — their rows differ, and recordings' **container model** (mark a chat/meeting → sync all its recordings in range) is a relationship a flat unified list would obscure.

But chats and recordings are now **two facets of the same conversations**, not unrelated sources. The win is **consistency of interaction**, not consistency of list:

- **Same tri-state buckets** (Kept / Inbox / Ignored) on both surfaces.
- **Same selection + action-bar model** on both.
- **Same filter grammar** (search / sort / activity window) on both.

So a user learns the triage motion once and applies it everywhere. Recordings keep their container semantics; chats keep their type chips. Two surfaces, one muscle memory.

Keep the left sidebar as the source switch (it already scales and matches the roadmap). Chats and recordings are two entries under "Communication"; the `Inbox N` backlog count can surface as a per-source badge in the sidebar too — so you see triage debt across sources at a glance.

---

## 6. What I need from the data probe BEFORE committing

The chat-level design above is **complete and buildable on its own** — it needs nothing from the probe. But three probe answers determine whether we *also* need a more powerful (and more complex) layer. **Flagged, ranked by how much they'd change the design:**

1. **🔴 HIGHEST — Are recurring-meeting chats a single stable `chatId` across occurrences, or a new id per occurrence?**
   This is the one that can break the simple model. If a recurring standup is **one stable thread**, per-item ignore sticks forever — the §1 tri-state is enough. If **each occurrence is a new id**, per-item ignore is whack-a-mole, and we *must* add **rule-based ignore** (ignore by series/title/Team), which adds a rule-management UI and a "why is this hidden?" provenance problem. **Answer this first** — it decides whether `ignoreRules` is YAGNI or mandatory.

2. **🟠 Can we retrieve the parent Team for a channel-based chat, and enumerate a Team's chats/channels?**
   If yes, **Team-level ignore** becomes possible (the user's explicit ask): ignore a Team → its channel chats, *present and future*, default to Ignored. This is additive and powerful, but rule-based (a predicate, not a flag) — so it shares the machinery question with #1. If the probe says no, Team-level ignore is off the table and we ship chat-level only, cleanly. **Design treats Team-ignore as optional/additive throughout — nothing above depends on it.**

3. **🟡 Is there any grouping key for 1:1 / group chats beyond participant lists?**
   Determines whether grouping/sectioning the Inbox by anything other than activity-recency is feasible. Nice-to-have for triage ergonomics; doesn't block the core design.

**Rule of sequencing:** build the **flag-based tri-state (§1) now** — it's the smallest thing that addresses the stated pain, reuses the proven `marked` merge model, and is correct regardless of probe outcomes. Add `ignoreRules` (Team-level, series-level) **only if** probe #1 forces it or probe #2 enables a feature the user wants. The schema in §1 reserves room for that layer so it lands without a painful migration.

---

## 7. Honest tradeoffs

- **Tri-state + buckets adds nav surface.** Three segmented buttons and an Ignored view are more chrome than today's single `Marked only` toggle. Justified: it's the minimum structure that makes "hundreds of candidates" tractable and keeps Ignore recoverable. Cheaper than the alternative (a tagging system) and matches a pattern the audience knows.
- **Selection layer adds interaction modes.** A selection state, an action bar, and "select all matching" are net-new code in a vanilla-DOM app (no framework to lean on). Real cost. But bulk is non-optional at this scale — per-row ignore on 200 chats is a non-starter. Build the selection model deliberately; it's load-bearing.
- **Default-to-Kept means triage isn't forced.** Some users might prefer landing in Inbox to drain it. We optimize for the frequent task (sync the kept set) and make Inbox one badge-click away. If usage shows people live in Inbox, flip the default — it's a one-line change.
- **"Downloaded is a fact, not a bucket" may feel pedantic** until someone asks for an "already downloaded" tab. Hold the line: it's a filter within a bucket. Promoting it to a bucket reintroduces the nonsense states §1 avoids.
- **Rule-based ignore (if the probe forces it) is a real complexity jump** — provenance ("why is this hidden?"), rule CRUD, rule/flag interaction. We deliberately defer it behind a probe answer rather than speculatively build it. If probe #1 says ids are stable, we may never need it.
- **Cross-device merge of ignore** inherits the existing ETag/set-union model — low risk — but introduces one new edge (kept-on-A vs ignored-on-B). Resolved by a documented deterministic winner (recommend marked-wins). Cheap to specify, must not be left implicit.

---

## 8. Recommended direction in one paragraph

Reframe the app from *"manage a small kept set"* to *"triage a large candidate pool."* Model each item with a **tri-state decision (Undecided/Inbox · Kept · Ignored)** plus an **orthogonal `downloaded` fact** — not four independent flags. Surface the tri-state as a **segmented bucket control with live counts** (Kept default, Inbox backlog one click away, Ignored always recoverable with undo). Add a **selection layer that composes with search/filters/activity-window** — its headline capability is *"select all matching the current filter, then Keep / Ignore / Download"* — while keeping per-row quick verbs for the singleton case; state-flips are instant+undoable, Download stays the heavyweight operation with pre-flight. **Reject the wizard** (wrong tool for a frequent, non-linear, reversible power task) but deliver its legitimate value — orientation and momentum — through buckets-with-counts and a contextual action bar. **Untangle the control bar by job:** scope (buckets) / narrow (search, filters, the renamed **"Active in:"** window) / act — and **delete the confusable "download history" control from the global bar entirely**, relocating lookback to the row chip and the download pre-flight where it actually matters. **Keep chats and recordings as separate surfaces with identical interaction grammar.** Ship **chat-level flag ignore now** (it reuses the proven `marked` merge model and depends on nothing); gate **Team-level / series-level rule ignore** on the data probe — whose single most important question is whether recurring-meeting chats have stable ids.
