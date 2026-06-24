// Teams Channels source — discovers the user's joined teams/channels and
// fetches message threads within a date window.
//
// Scope requirements:
//   Team.ReadBasic.All   — /me/joinedTeams
//   Channel.ReadBasic.All — /teams/{id}/channels
//   ChannelMessage.Read.All — /teams/{id}/channels/{id}/messages
//
// Concurrency: ~4 teams fetched in parallel (same pattern as listRecordings).
// Thread window filter: lastActivityMs = max(root.createdDateTime,
//   ...replies.createdDateTime). A thread rooted before the window but active
//   in it IS included. Early-stop once an entire page's messages and their
//   newest reply are all older than fromMs (messages arrive newest-first).

import type { PublicClientApplication } from "@azure/msal-browser"

const GRAPH_BASE = "https://graph.microsoft.com/v1.0"

// Scopes required for the channels source (also declared in main.ts SIGNIN_SCOPES).
export const CHANNEL_SCOPES = [
  "Team.ReadBasic.All",
  "Channel.ReadBasic.All",
  "ChannelMessage.Read.All",
]

// ---- Internal helpers (lifted verbatim from teams-call-recordings.ts) ----

async function getGraphToken(
  msal: PublicClientApplication,
  scopes: string[],
): Promise<string> {
  const account = msal.getActiveAccount()
  if (!account) throw new Error("No active account")
  const r = await msal.acquireTokenSilent({ account, scopes })
  return r.accessToken
}

/** Graph GET with retry: honors Retry-After on 429, exponential backoff on
 * 502/503/504. Up to 5 retries before throwing. Refreshes token each attempt
 * so stale tokens don't block long-running paginated scans. */
async function graphJson<T>(
  msal: PublicClientApplication,
  path: string,
  scopes: string[],
): Promise<T> {
  const url = path.startsWith("http") ? path : `${GRAPH_BASE}${path}`
  const MAX_RETRIES = 5
  let retryDelay = 1000
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const token = await getGraphToken(msal, scopes)
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (resp.ok) return resp.json() as Promise<T>
    if (
      attempt < MAX_RETRIES &&
      (resp.status === 429 || resp.status === 502 || resp.status === 503 || resp.status === 504)
    ) {
      const ra = resp.headers.get("Retry-After")
      const wait = ra
        ? Math.min(parseInt(ra, 10) * 1000, 60_000)
        : retryDelay + Math.random() * retryDelay
      await new Promise<void>((resolve) => setTimeout(resolve, wait))
      retryDelay = Math.min(retryDelay * 2, 30_000)
      continue
    }
    const body = await resp.text()
    throw new Error(
      `Graph ${path}: ${resp.status} ${resp.statusText} \u2014 ${body.slice(0, 300)}`,
    )
  }
  throw new Error(`Graph ${path}: max retries exceeded`)
}

// ---- Public interfaces ----

/** Lightweight reference to a channel (no compound id). */
export interface ChannelRef {
  teamId: string
  teamName: string
  channelId: string
  channelName: string
}

/** Full channel container with a stable composite id. */
export interface ChannelContainer extends ChannelRef {
  /** Stable composite key: `${teamId}::${channelId}` */
  id: string
}

/** A single reply within a channel thread. */
export interface ChannelReply {
  id: string
  createdDateTime: string
  author: string
  html: string
}

/** A root channel message plus its replies. */
export interface ChannelThread {
  rootId: string
  subject: string
  createdDateTime: string
  author: string
  html: string
  replies: ChannelReply[]
  /** Max of root + all reply createdDateTimes, in ms since epoch. */
  lastActivityMs: number
}

// ---- Graph response shapes ----

interface GraphTeam {
  id: string
  displayName: string
}

interface GraphChannel {
  id: string
  displayName: string
}

interface GraphMessage {
  id: string
  createdDateTime: string | null
  lastModifiedDateTime?: string | null
  subject?: string | null
  body: { content: string; contentType: string }
  from?: {
    user?: { displayName?: string | null }
    application?: { displayName?: string | null }
  } | null
  replies?: GraphMessage[]
  "@odata.nextLink"?: string
}

// ---- Public functions ----

/**
 * List all channels the signed-in user has access to across their joined teams.
 * Returns containers sorted by teamName then channelName.
 */
export async function listChannels(
  msal: PublicClientApplication,
  options: {
    onProgress?: (note: string) => void
  } = {},
): Promise<ChannelContainer[]> {
  const { onProgress } = options

  // 1. Fetch all joined teams.
  onProgress?.("Fetching joined teams\u2026")
  const teamsPage = await graphJson<{ value: GraphTeam[] }>(
    msal,
    "/me/joinedTeams",
    CHANNEL_SCOPES,
  )
  const teams = teamsPage.value ?? []
  onProgress?.(`Found ${teams.length} team(s). Listing channels\u2026`)

  // 2. For each team, fetch channels — ~4-way concurrency.
  const CONCURRENCY = 4
  const containers: ChannelContainer[] = []
  for (let i = 0; i < teams.length; i += CONCURRENCY) {
    const batch = teams.slice(i, i + CONCURRENCY)
    const results = await Promise.all(
      batch.map(async (team) => {
        try {
          const page = await graphJson<{ value: GraphChannel[] }>(
            msal,
            `/teams/${team.id}/channels`,
            CHANNEL_SCOPES,
          )
          const channels = page.value ?? []
          return channels.map(
            (ch): ChannelContainer => ({
              id: `${team.id}::${ch.id}`,
              teamId: team.id,
              teamName: team.displayName,
              channelId: ch.id,
              channelName: ch.displayName,
            }),
          )
        } catch (err) {
          console.warn(
            `[teams-channels] Skipping team ${team.displayName}: ${(err as Error).message}`,
          )
          return []
        }
      }),
    )
    for (const batch_result of results) containers.push(...batch_result)
    onProgress?.(`Channels listed: ${containers.length} so far\u2026`)
  }

  // 3. Sort: teamName asc, then channelName asc.
  containers.sort((a, b) => {
    const t = a.teamName.localeCompare(b.teamName)
    return t !== 0 ? t : a.channelName.localeCompare(b.channelName)
  })

  return containers
}

/**
 * Fetch channel threads whose last activity (root or any reply) falls within
 * [fromMs, toMs]. Returns threads sorted newest-last-activity first.
 *
 * Messages arrive newest-first from the API; we stop paginating early when an
 * entire page's root + newest-reply createdDateTime are all older than fromMs.
 */
export async function fetchChannelThreadsInRange(
  msal: PublicClientApplication,
  channel: ChannelRef,
  options: {
    fromMs: number
    toMs?: number
    maxPages?: number
    onProgress?: (note: string) => void
  },
): Promise<{ threads: ChannelThread[]; truncated: boolean }> {
  const { fromMs, toMs = Date.now(), maxPages = 20, onProgress } = options

  const messagesPath =
    `/teams/${channel.teamId}/channels/${channel.channelId}/messages` +
    `?$top=50&$expand=replies`

  const threads: ChannelThread[] = []
  let nextLink: string | null = messagesPath
  let pageCount = 0
  let truncated = false

  while (nextLink !== null && pageCount < maxPages) {
    const page: { value: GraphMessage[]; "@odata.nextLink"?: string } =
      await graphJson(msal, nextLink, CHANNEL_SCOPES)

    const messages = page.value ?? []
    nextLink = page["@odata.nextLink"] ?? null
    pageCount++

    if (messages.length === 0) break

    onProgress?.(`Page ${pageCount}: ${messages.length} message(s)\u2026`)

    let allPageOlderThanFrom = true

    for (const msg of messages) {
      const rootMs = msg.createdDateTime ? new Date(msg.createdDateTime).getTime() : 0
      const replies = msg.replies ?? []
      const replyMaxMs = replies.reduce((max: number, r: GraphMessage) => {
        const t = r.createdDateTime ? new Date(r.createdDateTime).getTime() : 0
        return Math.max(max, t)
      }, 0)
      const lastActivityMs = Math.max(rootMs, replyMaxMs)

      // Keep if last activity falls in [fromMs, toMs].
      if (lastActivityMs >= fromMs && lastActivityMs <= toMs) {
        const subject =
          (msg.subject?.trim()) ||
          stripHtml(msg.body.content).split("\n")[0]?.trim() ||
          "(no subject)"

        const author =
          msg.from?.user?.displayName ??
          msg.from?.application?.displayName ??
          "(unknown)"

        const mappedReplies: ChannelReply[] = replies.map((r: GraphMessage) => ({
          id: r.id,
          createdDateTime: r.createdDateTime ?? "",
          author:
            r.from?.user?.displayName ??
            r.from?.application?.displayName ??
            "(unknown)",
          html: r.body.content,
        }))

        threads.push({
          rootId: msg.id,
          subject,
          createdDateTime: msg.createdDateTime ?? "",
          author,
          html: msg.body.content,
          replies: mappedReplies,
          lastActivityMs,
        })
      }

      // Early-stop check: this message (and its newest reply) must be >= fromMs
      // to consider the page as "still potentially in range".
      if (lastActivityMs >= fromMs) {
        allPageOlderThanFrom = false
      }
    }

    // If EVERY root+reply on this page is older than fromMs, stop paginating.
    if (allPageOlderThanFrom) {
      nextLink = null
      break
    }
  }

  if (nextLink !== null && pageCount >= maxPages) {
    truncated = true
  }

  return { threads, truncated }
}

// ---- Internal utility ----

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim()
}
