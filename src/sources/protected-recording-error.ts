// Classification for the SharePoint "protected mp4" whitelist-gate 403.
//
// Downloading a Teams meeting recording transcript requires SharePoint REST's
// `?$expand=media/transcripts` on the recording's driveItem. For recordings
// whose mp4 is rights-protected, that expansion is gated to an app-identity
// allow-list Microsoft maintains for first-party apps (Stream/Teams/the
// SharePoint & OneDrive web clients) -- see docs/GRAPH_API_NOTES.md \u00a710.
// There is no consentable permission that adds a third-party app to that
// list, so this is not a bug in this app: it's a permanent, expected 403 for
// a specific subset of recordings. m365-pull hands the user off to a
// first-party-origin tool (the teams-transcript-md browser extension)
// instead of retrying.
//
// Kept dependency-free (no imports) so it can be compiled and unit-tested in
// isolation the same way src/sources/sharepoint-hosts.ts is -- see
// scripts/protected-recording-error.test.mjs. Re-exported from
// teams-recordings.ts, which is where it's thrown.

/** Thrown when a recording's mp4 is rights-protected and SharePoint's
 * media/transcripts expansion refuses a third-party app identity. Mirrors
 * CrossTenantRecordingError's shape (a typed error with a boolean
 * discriminant) so callers can label and count it separately from a real
 * failure -- see CrossTenantRecordingError in teams-recordings.ts. */
export class ProtectedRecordingError extends Error {
  readonly protectedRecording = true as const
  constructor(
    message = "Recording is protected \u2014 Microsoft only allows first-party apps to read its transcript",
  ) {
    super(message)
    this.name = "ProtectedRecordingError"
  }
}

/** True when a SharePoint `media/transcripts` 403 names the whitelist gate
 * for protected mp4 media, e.g.:
 *   {"error":{"code":"accessDenied","message":"For protected mp4 file, this
 *    API is only supported for whitelisted apps, your app id ... is not
 *    whitelisted."}}
 * False for any other status, or a 403 with an unrelated body (e.g. a plain
 * permission/ACL denial) -- those must NOT be misclassified as protected. */
export function isProtectedRecordingResponse(status: number, body: string): boolean {
  return status === 403 && /not whitelisted|protected mp4/i.test(body)
}
