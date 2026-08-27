// Persistent set of "marked" chat IDs (the in-app favorite/pin replacement
// for Teams sidebar organization, which Graph doesn't expose).
//
// Marks are stored in localStorage for instant reads on load and synced to
// OneDrive state.json (the source of truth) for cross-device persistence.
// An explicit un-favorite is tombstoned in a second, separate localStorage
// key (removedMarks) so the OneDrive merge (mergeStates, in
// ../state/onedrive-state.ts) can tell "never favorited" apart from
// "favorited, then explicitly un-favorited" — the latter must survive being
// merged against a stale device's copy of `marks` that still contains the
// removed id, instead of being silently resurrected.

const KEY_PREFIX = "m365-pull.marks.v1."
const REMOVED_KEY_PREFIX = "m365-pull.marks.removed.v1."

interface MarksData {
  chats: string[]
}

function keyFor(userKey: string): string {
  return `${KEY_PREFIX}${userKey}`
}

function removedKeyFor(userKey: string): string {
  return `${REMOVED_KEY_PREFIX}${userKey}`
}

export function loadMarks(userKey: string): Set<string> {
  try {
    const raw = localStorage.getItem(keyFor(userKey))
    if (!raw) return new Set()
    const data = JSON.parse(raw) as MarksData
    return new Set(data.chats || [])
  } catch {
    return new Set()
  }
}

export function saveMarks(userKey: string, ids: Set<string>): void {
  try {
    const data: MarksData = { chats: [...ids] }
    localStorage.setItem(keyFor(userKey), JSON.stringify(data))
  } catch (err) {
    console.warn("Failed to save marks:", err)
  }
}

/** Load tombstoned (explicitly removed) mark IDs. A missing key — including
 * every pre-tombstone localStorage state written before this existed — is
 * backward-compatible: it simply means "no removals recorded yet", not an
 * error. */
export function loadRemovedMarks(userKey: string): Set<string> {
  try {
    const raw = localStorage.getItem(removedKeyFor(userKey))
    if (!raw) return new Set()
    const data = JSON.parse(raw) as MarksData
    return new Set(data.chats || [])
  } catch {
    return new Set()
  }
}

export function saveRemovedMarks(userKey: string, ids: Set<string>): void {
  try {
    const data: MarksData = { chats: [...ids] }
    localStorage.setItem(removedKeyFor(userKey), JSON.stringify(data))
  } catch (err) {
    console.warn("Failed to save removed marks:", err)
  }
}
