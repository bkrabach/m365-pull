import type { RecordingPrefs } from "../state/onedrive-state"

// localStorage warm-cache for per-recording preferences. Mirrors what's in
// the OneDrive state.recordingPrefs so the UI can render "downloaded X" tags
// without waiting on a Graph round-trip.
//
// Recording IDs are composite "callId::filename" -- stable across reloads,
// distinct namespace from chatPrefs (which uses chat ids) so the two state
// maps never collide.

const KEY_PREFIX = "m365-pull.recordingPrefs.v1."

function keyFor(userKey: string): string {
  return `${KEY_PREFIX}${userKey}`
}

export function loadRecordingPrefs(
  userKey: string,
): Record<string, RecordingPrefs> {
  try {
    const raw = localStorage.getItem(keyFor(userKey))
    if (!raw) return {}
    const data = JSON.parse(raw) as Record<string, RecordingPrefs>
    return data || {}
  } catch {
    return {}
  }
}

export function saveRecordingPrefs(
  userKey: string,
  prefs: Record<string, RecordingPrefs>,
): void {
  try {
    localStorage.setItem(keyFor(userKey), JSON.stringify(prefs))
  } catch (err) {
    console.warn("Failed to save recordingPrefs:", err)
  }
}
