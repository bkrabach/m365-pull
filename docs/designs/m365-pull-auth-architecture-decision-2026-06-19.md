# Auth Architecture Decision — SPA behind SWA EasyAuth + MSAL

**Date:** 2026-06-19
**Status:** Adopted (live on the personal-repo SWA `yellow-sky-0156be81e`)
**Scope:** How m365-pull authenticates in the browser, and why the login flow is shaped the way it is. Written to stop us (and collaborators) from re-walking the multi-round debugging slog that produced it.

---

## Context

m365-pull is a pure static SPA hosted on **Azure Static Web Apps (SWA)**. It has **two** browser-auth concerns:

1. **An EasyAuth edge gate** — SWA requires sign-in before serving the app (route rule `/*: authenticated`, `401 → 302 /.auth/login/aad`).
2. **The SPA's own MSAL.js login** — to acquire **Microsoft Graph delegated tokens** (Chat.Read, Files.ReadWrite, …) for the signed-in user's own data. This uses our single-tenant app registration `63231eb0` (Graph identity ≠ the EasyAuth gate identity). **Keeping MSAL for Graph is a deliberate design constraint** — the SPA pulls the user's data client-side to their OneDrive; the token must be a Graph delegated token, which the EasyAuth gate session does not provide here.

That's **two stacked browser logins** — and that stacking is the hazard.

## The hazard (the bug this records)

After MSAL's `loginRedirect` returns the auth code to `https://app/#code=...`, the browser re-fetches `/`. The SWA `/*: authenticated` rule + `401 → 302 /.auth/login` **intercepts that return navigation and strips the MSAL `#code` fragment** before MSAL can consume it. No code → MSAL never establishes an account → the SPA shows "Sign in" again → **infinite login loop.**

- **Browser-dependent:** failed in Chrome/Edge, "worked" in Safari — because Safari served `/` from bfcache/disk (no network fetch → no auth-gate detour → fragment survived). The loop was **cache-sensitive**, which is the tell that it is NOT a CSP problem (CSP is deterministic and cache-insensitive).
- **Confirmed via a real failing-Chrome console trace:** the EasyAuth gate (`d414ee2d`, `/common`) re-fired immediately after the SPA's MSAL redirect (`63231eb0`), instead of the app consuming the `#code`. **Zero** `script-src`/`style-src`/`img-src` CSP violations.

## The arc that got us here (do NOT repeat these dead ends)

1. **`ssoSilent` (hidden iframe)** to ride the EasyAuth session silently → looped, because in a gated SWA the silent iframe to `login.microsoftonline.com` is refused by Microsoft's own **`X-Frame-Options: deny`** (and third-party-cookie partitioning blocks the session cookie in the iframe). Not fixable from our side.
2. Removed `ssoSilent` → fell back to a **top-level `loginRedirect`** → which then hit the loop above (the gate eats the `#code` return).
3. **Three CSP edits** (`frame-src 'self'`, then the SWA identity host) — necessary housekeeping but **not the cause**; chasing CSP was a wrong trail.

## The decision (adopted)

Keep MSAL for Graph. **Route MSAL's redirect-return through an anonymous route that the EasyAuth gate does not intercept:**

- `staticwebapp.config.json`: add `{ "route": "/auth-callback", "allowedRoles": ["anonymous", "authenticated"] }` **above** `/*`.
- `src/main.ts`: set MSAL `redirectUri = window.location.origin + "/auth-callback"`; after `handleRedirectPromise()` establishes the account on that path, route into `/`.
- App registration `63231eb0`: register the SPA redirect URI `https://yellow-sky-0156be81e.7.azurestaticapps.net/auth-callback`.

The `#code` now lands on an anonymous route, survives, MSAL completes, then the app loads at the (still-gated) `/`. **Verified live** (`/auth-callback → 200`, `/ → 302 → login`) and confirmed end-to-end in the previously-failing Chrome path.

## Trade-offs and known-open items (honest)

- **Narrow compliance nick:** `/auth-callback` serves the app shell anonymously at that one path. Acceptable here, and incremental rather than new — because…
- **The edge gate on this deploy is still MULTI-TENANT** (`d414ee2d` via `/common`): any Microsoft account passes the EasyAuth gate; single-tenant enforcement currently comes only from the SPA's MSAL (`63231eb0`, single-tenant), which runs *after* the shell loads. True single-tenant **edge** enforcement remains an open item (tracked in the `ao-feedback-*` notes and the amplifier-online bundle).
- **Preferred alternative if it were available:** a *single* browser login — EasyAuth gate + MSAL `ssoSilent` riding that session (no second redirect, no return for the gate to eat, no anonymous route). Parked because `ssoSilent`'s iframe is blocked in a gated SWA (item 1 above). Revisit if/when the gate and token story consolidate (the AO-native `web-app-aca` reshape).

## General rule (for any SPA on SWA EasyAuth)

If a SPA does its **own** MSAL `loginRedirect` behind a SWA EasyAuth gate, its `redirect_uri` **must** target a route excluded from the `authenticated` gate (e.g. `/auth-callback`) — otherwise the gate strips the auth-code fragment on the return and the app login-loops. Prefer `ssoSilent` (one login) where the iframe isn't blocked.

## References

- Fix commits (m365-pull): `7d76409`, `da40d58` (CSP housekeeping), `2ef733a` (removed ssoSilent bridge), **`ebce242`** (the `/auth-callback` fix).
- Companion guidance proposed upstream: `microsoft/amplifier-bundle-amplifier-online` (troubleshooting playbook + MSAL guide + manifest checklist), plus an `init`-template scaffold follow-up for the CLI/provisioner repo.
