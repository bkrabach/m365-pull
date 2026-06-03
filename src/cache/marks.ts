// Persistent set of "marked" chat IDs (the in-app favorite/pin replacement
// for Teams sidebar organization, which Graph doesn't expose).
//
// Marks are stored in localStorage for instant reads on load and synced to
// OneDrive state.json (the source of truth) for cross-device persistence.
// The OneDrive sync merges marks additively so no marks are lost across devices.

const KEY_PREFIX = "m365-pull.marks.v1."

interface MarksData {
  chats: string[]
}

function keyFor(userKey: string): string {
  return `${KEY_PREFIX}${userKey}`
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
