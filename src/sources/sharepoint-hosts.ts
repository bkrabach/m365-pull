// Allow-listed SharePoint host patterns.
//
// Guards the SharePoint-audience token mint in teams-recordings.ts: a
// recording's sharing URL supplies the host we later request
// `https://{host}/.default` for via MSAL. Without this check, a crafted or
// corrupted URL could cause a token request for an arbitrary audience.
//
// Ported from team-pulse's adversarial-tested allowlist
// (frontend/src/lib/sharepoint-hosts.ts in amplifier-app-team-pulse).
//
// Recognized host shapes (all require a tenant-style subdomain prefix; a
// bare `sharepoint.com` is never a legitimate token audience):
//   - Production:                <tenant>.sharepoint.com
//   - Dogfood ring (pre-prod):   <tenant>.sharepoint-df.com   (Microsoft-internal)
//   - GCC High / DoD (US gov):   <tenant>.sharepoint.us
//   - Germany sovereign cloud:   <tenant>.sharepoint.de
//   - China sovereign cloud:     <tenant>.sharepoint.cn
//
// This is intentionally an anchored allowlist, not a substring/contains
// check — `evil-sharepoint.com.attacker.net` and `sharepoint.com.evil.com`
// must never match. See scripts/sharepoint-hosts.test.mjs for the
// adversarial cases (run with `npm run test:sharepoint-hosts`).

/** Matches a bare SharePoint host, e.g. `contoso.sharepoint-df.com`. */
export const SHAREPOINT_HOST_RE = /^[a-z0-9-]+\.sharepoint(-df)?\.(com|us|de|cn)$/i

/** True if `host` is a recognized SharePoint host (see module doc for the allowlist). */
export function isAllowedSharePointHost(host: string): boolean {
  return SHAREPOINT_HOST_RE.test(host)
}
