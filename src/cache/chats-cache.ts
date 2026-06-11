import type { TeamsChatItem } from "../sources/teams-chats"

// Bumped when the cache shape changes — old entries are ignored.
// v3: removed nextCursor (always fully loaded now); slimmed members to
//     displayName-only to stay well within the ~5MB localStorage quota.
const KEY_PREFIX = "m365-pull.chats.v3."

export interface ChatsCache {
  fetchedAt: string
  chats: TeamsChatItem[]
}

function keyFor(userKey: string): string {
  return `${KEY_PREFIX}${userKey}`
}

/** Remove chat-cache blobs from older schema versions (v1/v2/…) that linger in
 * localStorage and eat the ~5MB quota — the v2 blobs held FULL member objects
 * and can be multiple MB, which is why a fresh v3 save can still hit quota.
 * Targets ONLY this app's chat-cache keys; leaves prefs/marks/ui-state alone. */
function pruneStaleChatCaches(): void {
  try {
    const stale: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && /^m365-pull\.chats\.v\d+\./.test(k) && !k.startsWith(KEY_PREFIX)) {
        stale.push(k)
      }
    }
    for (const k of stale) localStorage.removeItem(k)
  } catch {
    /* non-fatal */
  }
}

export function loadCachedChats(userKey: string): ChatsCache | null {
  try {
    const raw = localStorage.getItem(keyFor(userKey))
    if (!raw) return null
    const parsed = JSON.parse(raw) as ChatsCache
    if (!parsed.fetchedAt || !Array.isArray(parsed.chats)) return null
    return {
      fetchedAt: parsed.fetchedAt,
      chats: parsed.chats,
    }
  } catch {
    return null
  }
}

export function saveCachedChats(userKey: string, chats: TeamsChatItem[]): void {
  try {
    pruneStaleChatCaches() // free space held by orphaned old-version blobs
    const data: ChatsCache = {
      fetchedAt: new Date().toISOString(),
      chats,
    }
    localStorage.setItem(keyFor(userKey), JSON.stringify(data))
  } catch (err) {
    // Quota exceeded or storage unavailable — non-fatal.
    console.warn("Failed to cache chats:", err)
  }
}

export function clearCachedChats(userKey: string): void {
  try {
    localStorage.removeItem(keyFor(userKey))
  } catch {
    /* non-fatal */
  }
}

export function ageMs(cache: ChatsCache): number {
  return Date.now() - new Date(cache.fetchedAt).getTime()
}

export function formatAge(ms: number): string {
  if (ms < 60_000) return "just now"
  const mins = Math.floor(ms / 60_000)
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`
  const days = Math.floor(hours / 24)
  return `${days} day${days === 1 ? "" : "s"} ago`
}
