// Shared filename formatting for versioned, sort-by-name-friendly download names
// (Phase 3 of the artifacts redesign).
//
// The `pulled-<YYYY-MM-DD-HHMM>` stamp is the PRIMARY version key: a lexical
// sort of the download folder == chronological order of downloads, and the
// -HHMM makes same-day re-pulls collision-safe. Each download is its own dated
// file (no stable-name overwrite), so the folder accumulates a visible history
// of every version pulled over time.

/** Sanitize a display name for safe use inside a filename.
 *
 * Replaces the Windows-prohibited characters < > : " | ? * \ / and control
 * characters with hyphens, collapses repeats, and trims — but deliberately
 * KEEPS human-readable spaces (a taste decision: names stay legible). Capped to
 * 80 chars so the full versioned filename comfortably fits OS path limits. */
export function sanitizeFilenameName(name: string): string {
  const cleaned = (name || "chat")
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"|?*\\/\x00-\x1f]/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/\s{2,}/g, " ")
    .replace(/^[-\s]+|[-\s]+$/g, "")
    .slice(0, 80)
    .replace(/[-\s]+$/g, "")
  return cleaned || "chat"
}

/** "YYYY-MM-DD-HHMM" — the pulled-at version stamp (local time). */
export function formatPulledStamp(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`
}

/** "YYYY-MM-DD" — a calendar date stamp (range bounds). */
export function formatDateStamp(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** "YYYY-MM-DD-HHMM" — a date+TIME stamp (local time). Used for a recording's
 * call stamp so two recordings on the same chat + same DAY (e.g. a call that
 * disconnected and reconnected) get distinct, human-sortable names by when each
 * call actually started. */
export function formatDateTimeStamp(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`
}

/** Short, stable, collision-proof token derived from an arbitrary string
 * (FNV-1a → base36). Deterministic across reloads. Used as a fail-safe suffix on
 * recording filenames keyed off the recording's unique id (`callId::filename`),
 * so even two recordings that somehow share the same call minute can't collide. */
export function shortHash(s: string): string {
  let h = 0x811c9dc5 // FNV-1a 32-bit offset basis
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) // FNV prime; Math.imul keeps it 32-bit
  }
  // >>> 0 → unsigned; base36 → compact; pad/truncate to a stable 6 chars.
  return (h >>> 0).toString(36).padStart(6, "0").slice(-6)
}
