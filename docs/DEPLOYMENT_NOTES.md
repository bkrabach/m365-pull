# Deployment + CI notes

Hard-won findings from operating this app's Azure Static Web App deployment. Every claim
below is backed by a measurement taken against the live repo or the live resource, not by
documentation.

**If you forked this codebase or copied its deploy workflow, read section 1 first.** It is
a silent-failure bug in the same family as the ones in `GRAPH_API_NOTES.md`: merging a pull
request kills its own production deploy, the run is recorded as *cancelled* rather than
*failed*, and the site quietly keeps serving the previous build. It survived two
occurrences here — roughly six weeks apart — because nothing anywhere reported an error.

---

## 1. Merging a PR cancels the production deploy

Merging a PR fires **two** workflow events about one second apart:

```
t+0s   push            -> main   starts the production deploy
t+1s   pull_request    closed    tears down the PR preview environment
```

With a concurrency key of `deploy-swa-${{ github.ref }}`, both land in the **same group**.
`cancel-in-progress: true` then does exactly what it was told: the newer request kills the
older one. The production deploy dies before it ever reaches a runner.

The trap is in how `github.ref` resolves. For a `pull_request` event with
`action: closed` on a **merged** PR, `github.ref` is the **base branch**
(`refs/heads/main`) — *not* `refs/pull/N/merge`. This is long-standing GitHub behavior, not
a quirk of this repo: see [actions/runner#256](https://github.com/actions/runner/issues/256).

So the two runs that appear to be in different groups are in the same one.

### The evidence

GitHub states the cause outright, in an annotation the web UI does not surface. It is
readable only via the check-run API. Both cancelled runs carry the identical message:

```
GET /repos/{owner}/{repo}/check-runs/92951336545/annotations   (run 31204252369, 2026-08-07)
GET /repos/{owner}/{repo}/check-runs/83128136929/annotations   (run 28078606388, 2026-06-24)

  "Canceling since a higher priority waiting request for
   deploy-swa-refs/heads/main exists"
```

The job never started. It was cancelled while queued:

```
conclusion:   cancelled
runner_id:    0            <-- never assigned to a runner
runner_name:  ""
steps:        []           <-- zero steps executed
created_at == started_at == completed_at == 2026-08-07T17:51:39Z
```

The run that wins the race **deploys nothing**. Its `build_and_deploy_job` is skipped by
the `if:` guard; only `close_pull_request_job` executes. A job whose entire purpose is
tearing down a preview environment destroys the production deploy.

```
run 31204252826 (the "winner"):
  Close Pull Request Job -> success
  Build and Deploy Job   -> skipped
```

### It is 100% reproducible, and looks intermittent

Across the full 31-run history of this workflow, the correlation is total:

```
PR merge (close event fires)      -> deploy cancelled    2 of 2
direct push to main (no PR)       -> deploy cancelled    0 of 29
```

The only two `cancelled` conclusions in the repo's entire history are the two PR-merge
push runs: `d66234a` (2026-06-24) and `6571ba9` (2026-08-07). PRs #1–#5 merged before this
workflow existed, so they are not counterexamples.

It reads as intermittent only because most pushes to `main` here are direct. **Every PR
merge fails this way, every time.**

### Why nobody noticed for six weeks

The run is marked `cancelled`, not `failed`. Cancelled runs do not send failure
notifications, do not show a red X in most views, and read as "someone stopped this on
purpose." Meanwhile the SWA keeps happily serving the last successful build. There is no
error, no alert, and no user-visible symptom — just a site that is silently one or more
commits behind `main`.

On 2026-08-07 the gap was ~8 hours and one bug fix. It could as easily be weeks.

### The fix

Put `github.event_name` in the concurrency key so push deploys occupy their own group, and
key pull requests by PR number so a `closed` run can only ever cancel a build of its **own**
PR:

```yaml
concurrency:
  group: deploy-swa-${{ github.event_name }}-${{ github.event.pull_request.number || github.ref }}
  cancel-in-progress: true
```

Resulting groups:

```
push -> main          deploy-swa-push-refs/heads/main    isolated; nothing can cancel it
PR #7 synchronize     deploy-swa-pull_request-7
PR #7 closed          deploy-swa-pull_request-7          cannot reach production
```

This keeps the behavior worth having — a new commit on a PR still cancels that PR's
in-flight preview build — and removes the one that costs you deploys.

**Do not "simplify" this back to `${{ github.ref }}`.** That is the bug. The workflow
carries a comment saying so.

### If you are hit by this right now

Re-run the cancelled run; it replays the original `push` event at the correct SHA:

```
gh run rerun <run-id>
```

Prefer this over `workflow_dispatch`. This workflow selects its GitHub environment with
`github.event_name == 'push' && 'production' || 'preview'`, so a manual dispatch would
build against the **preview** environment's secrets, not production.

## 2. `amplifier-online up` predicts destructive changes — UNRESOLVED

`amplifier-online up --dry-run` against this project predicts that a real `up` would strip
the live Static Web App's GitHub wiring:

```
Microsoft.Web/staticSites/m365-pull-web   changeType: Modify

  properties.deploymentAuthPolicy   Delete   (was: DeploymentToken)
  properties.stableInboundIP        Delete   (was: 20.109.151.31)
  properties.repositoryUrl          Delete   (was: https://github.com/bkrabach/m365-pull)
  properties.branch                 Delete   (was: main)
  properties.trafficSplitting       Delete   (was: {environmentDistribution: {default: 100}})
  properties.provider               Modify   (GitHub -> None)
```

Two of those would matter if real: `deploymentAuthPolicy: DeploymentToken` is what makes
the token-based CI deploy work at all, and `stableInboundIP` is load-bearing for DNS and
firewall rules on the custom domain.

**The obvious explanation is wrong.** `amplifier-online.yaml` ships with
`frontend.repo: ""` while the template comment marks that field REQUIRED, which looks like
the cause. It is not. Filling it in changes nothing:

```
what-if with frontend.repo: ""                       md5 0dab71bba5318327130cba820d0dbab5
what-if with frontend.repo: "https://github.com/..."  md5 0dab71bba5318327130cba820d0dbab5
diff -> no output
```

Byte-identical plans. The CLI never reads the value:

```
$ grep -c "frontend" amplifier_online/config.py
0

$ grep -rn "frontend" amplifier_online/*.py
cli.py:792:  has_frontend = project.get("frontend") is not None
cli.py:793:  if has_frontend and "AZURE_STATIC_WEB_APPS_API_TOKEN" not in secrets:
```

The only consumer is a **presence** check on the `frontend:` key, used to decide whether
to expect the SWA token secret. `frontend.repo`'s value is never parsed. Setting it cannot
affect the plan. Leave it empty; filling it in only encodes a false belief that it was
load-bearing.

**What remains unresolved:** whether that six-property delta is a real destruction or an
**ARM what-if false positive**. What-if is known to over-predict `Delete` for properties
absent from a template that the resource provider actually preserves. Determining which
requires reading the resource group's deployment history, which needs Azure permissions
this project's operator does not have:

```
az deployment group list -g ao-m365-pull-rg   -> AuthorizationFailed (Microsoft.Resources/deployments/read)
az staticwebapp show -n m365-pull-web         -> AuthorizationFailed (Microsoft.Web/staticSites/read)
```

**Evidence that would settle it:** whether `amplifier-online up` has run against this SWA
*since* the GitHub linkage was established by `cicd create`, and whether `provider`,
`repositoryUrl` and `stableInboundIP` survived it. The live state still shows all three
set, which is suggestive but not conclusive — nobody has confirmed an `up` ran after the
linkage.

**Recommended posture until then: treat `amplifier-online up` as unsafe on this project.**
Deploys do not need it — CI pushes with `AZURE_STATIC_WEB_APPS_API_TOKEN`, which does not
depend on the SWA's GitHub linkage. That is also why the risk has stayed latent: the code
path has simply never been exercised.

## 3. Deployed content cannot be *fetched* anonymously — fingerprint it instead

`staticwebapp.config.json` puts `/*` behind `allowedRoles: ["authenticated"]`. That
includes static assets, so **every** path returns 302 to the EasyAuth gate:

```
/                          302 -> /.auth/login/aad
/index.html                302 -> /.auth/login/aad
/assets/index-<hash>.js    302 -> /.auth/login/aad
```

There is no anonymous way to fetch the served bundle and read it. A green workflow run
proves the *upload* succeeded; on its own it does not tell you what is being served.

### The technique that works without credentials

Vite emits **content-hashed** asset filenames — the hash is derived from bundle content, so
the filename is itself a content fingerprint. Build the same commit locally and compare the
emitted filenames against the ones in the CI build log. Matching hashes mean matching
content, with no need to fetch anything from the gated site.

This is how `6571ba9` was confirmed live on 2026-08-07. A local build of that commit
reproduced **both** deployed asset filenames exactly:

```
CI log (run 31204252369, attempt 2):
  dist/assets/index-CBu128D9.css    15.98 kB
  dist/assets/index-BFTnG_g3.js    358.34 kB

local build of 6571ba9 (clean dist, run twice — byte-identical output both times):
  dist/assets/index-CBu128D9.css    15.98 kB     15,977 bytes on disk
  dist/assets/index-BFTnG_g3.js    358.34 kB    358,747 bytes on disk
                    ^^^^^^^^                    both filenames match CI exactly
```

And the reproduced bundle has the properties the fix requires:

```
grep -c showSaveFilePicker  dist/assets/index-BFTnG_g3.js   ->  0    (no live picker calls)
grep -c createObjectURL     dist/assets/index-BFTnG_g3.js   ->  1    (anchor-download path present)
```

Zero `showSaveFilePicker` is the meaningful check: the fix removed every live call, and the
only remaining mentions in `src/destinations/browser.ts` are comments, which are stripped
from a production build. The `createObjectURL` hit confirms the replacement path is present
— absence of the bug *and* presence of the fix.

So the deployed JS for `6571ba9` is the fixed build, and the site is not serving the old
picker code.

### The boundary of this claim — read before relying on it

This matches a **content-hash fingerprint plus byte size**. It is *not* a byte-for-byte
diff of the artifact actually being served, because EasyAuth still blocks reading that
artifact. Precisely what was and was not compared:

```
compared:      local emitted filename   ==  filename in CI build log        (BFTnG_g3, CBu128D9)
compared:      local vite-reported size ==  CI vite-reported size           (358.34 kB / 15.98 kB)
NOT compared:  local bytes              vs  bytes served by the live site   (gated, unreadable)
```

A vite content-hash match is a **strong fingerprint, not a cryptographic attestation**.
It establishes that CI built the same content from the same commit; it assumes the upload
step delivered those files intact and that no later deploy replaced them. Given a
`Deployment Complete :)` from the same run and no subsequent runs, that is a reasonable
chain — but it is inference at the last link, not measurement. Say "verified by content
hash," not "verified byte-for-byte."

If you have credentials, closing that last link is trivial: sign in, then confirm in
devtools that the loaded script is the expected `index-<hash>.js` and that searching it for
`showSaveFilePicker` returns nothing.

## 4. Check your local build is real before trusting a hash comparison

The section-3 technique has one failure mode worth knowing, because it misreads as a
deployment problem when it is actually a build problem.

While first attempting that verification, a build run inside a **throwaway `/tmp` clone**
of this repo emitted a stub:

```
throwaway /tmp clone:   156 modules transformed   index-DwrDRhYJ.js     0.94 kB   <-- stub
real repo checkout:     156 modules transformed   index-BFTnG_g3.js   358.34 kB   <-- correct
CI (x64, Oryx):         156 modules transformed   index-BFTnG_g3.js   358.34 kB
```

Same commit, same vite (5.4.21), same module count, identical CSS — but the `/tmp` clone's
JS was 946 bytes containing only vite's modulepreload polyfill: no application code, no
MSAL. `tsc` passed, `vite build` exited 0, nothing warned.

**This is not a platform defect.** In the real checkout on the same machine (Linux aarch64,
Node v18.19.1) the build is deterministic and correct — run twice from a clean `dist/`, it
produced `index-BFTnG_g3.js` at 358,747 bytes both times, matching CI. The stub was
specific to the throwaway clone; the root cause was not chased, since the real checkout
builds correctly.

The transferable lesson is narrow and practical: **a stub build silently fails to match,
and the mismatch looks exactly like "the deployment is stale."** Before concluding anything
about a deployment from a hash comparison, confirm your local build produced an artifact of
plausible size and that it contains recognizable application code:

```
ls -l dist/assets/*.js              # hundreds of kB, not hundreds of bytes
grep -c msal dist/assets/*.js       # non-zero => app code is actually in there
```

If those fail, you have a build problem, not a deploy problem. And do not deploy from a
build you have not sanity-checked this way.

---

## The pattern worth internalizing

The deployment failures in this file share the shape of the API bugs in
`GRAPH_API_NOTES.md`: **nothing threw**.

- A cancelled deploy is not a failed deploy. No notification, no red X, no symptom — just a
  stale site. Green-checkmark monitoring cannot see it, because there is no red checkmark.
- A successful upload is not a verified deployment. "The workflow went green" and "the
  right bytes are being served" are different claims with different evidence.
- A plausible cause is not a confirmed cause. `frontend.repo: ""` looked exactly like the
  reason for the destructive what-if, right up until filling it in produced a
  byte-identical plan. Test the fix before trusting the diagnosis.

When a deploy pipeline reports success, ask what specifically was proven — and by what
measurement.
