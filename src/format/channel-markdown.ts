// Markdown formatter for Teams channel threads (slice-1 fidelity).
//
// HTML fidelity loss is accepted in slice-1: tags are stripped, basic entities
// unescaped. Full HTML-to-Markdown conversion is deferred.

import { sanitizeFilenameName, formatDateStamp, shortHash } from "../sources/filename-format"
import type { ChannelThread } from "../sources/teams-channels"

/** Minimal HTML → plain-text for slice-1 fidelity. */
function htmlToText(html: string): string {
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

function shortDate(iso: string): string {
  if (!iso) return ""
  const d = new Date(iso)
  return d.toLocaleString()
}

/**
 * Render a channel thread as Markdown.
 *
 * Format:
 *   # <subject>
 *   > <sourceLabel>
 *
 *   **<author>** · <date>
 *   <body text>
 *
 *   > **<replyAuthor>** · <date>
 *   > <reply text>
 */
export function threadToMarkdown(
  thread: ChannelThread,
  sourceLabel: string,
): string {
  const lines: string[] = []

  lines.push(`# ${thread.subject}`)
  lines.push(`> ${sourceLabel}`)
  lines.push("")

  // Root message
  lines.push(`**${thread.author}** \u00b7 ${shortDate(thread.createdDateTime)}`)
  lines.push("")
  lines.push(htmlToText(thread.html))

  // Replies
  for (const reply of thread.replies) {
    lines.push("")
    lines.push(`> **${reply.author}** \u00b7 ${shortDate(reply.createdDateTime)}`)
    lines.push(`> ${htmlToText(reply.html)}`)
  }

  return lines.join("\n")
}

/**
 * Roll multiple channel threads into a single Markdown document.
 *
 * Format:
 *   # <teamName> › <channelName>
 *
 *   <N> threads · <rangeStart> to <rangeEnd>
 *
 *   ---
 *
 *   <threadToMarkdown for thread 1>
 *
 *   ---
 *
 *   <threadToMarkdown for thread 2>
 *   …
 *
 * Each thread is rendered with the existing per-thread format (reusing
 * threadToMarkdown). Threads are in the order they were fetched (newest-first
 * matches the API default).
 */
export function threadsToChannelMarkdown(
  threads: ChannelThread[],
  teamName: string,
  channelName: string,
  rangeStart: string,
  rangeEnd: string,
): string {
  const header = [
    `# ${teamName} \u203A ${channelName}`,
    ``,
    `${threads.length} thread${threads.length !== 1 ? "s" : ""} \u00B7 ${rangeStart} to ${rangeEnd}`,
  ].join("\n")

  if (threads.length === 0) return header

  const sourceLabel = `${teamName} / ${channelName}`
  const bodies = threads.map((t) => threadToMarkdown(t, sourceLabel))

  return header + "\n\n---\n\n" + bodies.join("\n\n---\n\n")
}

/**
 * Build a collision-safe, flat filename for a channel thread.
 *
 * Pattern:
 *   `<Team> › <Channel> · <Subject>__channel-<YYYY-MM-DD>__pulled-<YYYY-MM-DD-HHMM>__<hash><ext>`
 *
 * Each of Team, Channel, and Subject is sanitized separately (with a per-segment
 * length cap so the total stays well under OneDrive's ~260-char path limit). The
 * structural join delimiters › (U+203A) and · (U+00B7) are stripped from each
 * segment by sanitizeFilenameName, so a team/channel/subject literally containing
 * those characters cannot inject a fake separator.
 *
 * - Team › Channel prefix: clusters all threads for a channel together in a
 *   flat name-sort, matching how chats/recordings name-sort by chat name.
 * - threadDateStamp ("YYYY-MM-DD"): root message date, identifies the thread era.
 * - pulledStamp: passed in by the caller (formatPulledStamp(new Date()) computed
 *   once per download run so all threads in one pull share the same version key,
 *   mirroring the chat/recording convention).
 * - hash: shortHash(thread.rootId) — disambiguates threads with the same subject
 *   and date, AND threads in same-named teams/channels (rootId is globally unique).
 *
 * Per-segment cap: 60 chars each. Delimiters + stamps + hash add ~55 chars,
 * so assembled filename ≤ 3×60 + 55 = 235 chars — a safe margin before the
 * OneDrive folder prefix (~25 chars typical) reaches the 260-char limit.
 */
export function buildThreadFilename(
  thread: ChannelThread,
  teamName: string,
  channelName: string,
  pulledStamp: string,
  ext = ".md",
): string {
  const rootDate = thread.createdDateTime
    ? new Date(thread.createdDateTime)
    : new Date(thread.lastActivityMs)
  const threadDateStamp = formatDateStamp(rootDate)
  // Budget each of the three name segments to prevent path-limit blowout.
  const SEG_MAX = 60
  const team = sanitizeFilenameName(teamName, SEG_MAX)
  const channel = sanitizeFilenameName(channelName, SEG_MAX)
  const subject = sanitizeFilenameName(thread.subject, SEG_MAX)
  const hash = shortHash(thread.rootId)
  const extension = ext.startsWith(".") ? ext : `.${ext}`
  // › = U+203A (structural delimiter, stripped from segments by sanitizer)
  // · = U+00B7 (structural delimiter, stripped from segments by sanitizer)
  return `${team} \u203A ${channel} \u00B7 ${subject}__channel-${threadDateStamp}__pulled-${pulledStamp}__${hash}${extension}`
}

/**
 * Build a versioned, sort-by-name-friendly filename for a combined channel file.
 *
 * Pattern (mirrors the chat archive grammar, channel-typed):
 *   `<Team> › <Channel>__channel__pulled-<pulledStamp>__<rangeStart>_to_<rangeEnd><ext>`
 *
 * - Team and Channel are sanitized as separate segments (SEG_MAX = 60 chars each)
 *   and joined with › (U+203A), which the sanitizer strips from each segment so
 *   segment values cannot inject a fake separator.
 * - pulledStamp: "YYYY-MM-DD-HHMM" — the primary version key, computed once per
 *   download run by the caller (formatPulledStamp(new Date())).
 * - rangeStart/rangeEnd: "YYYY-MM-DD" strings — the window bounds, passed in by
 *   the caller (formatDateStamp(new Date(fromMs/toMs))).
 *
 * Example:
 *   MADE- Explorations (Private) › Announcements__channel__pulled-2026-06-23-1430__2026-06-16_to_2026-06-23.md
 */
export function buildChannelFilename(
  teamName: string,
  channelName: string,
  pulledStamp: string,
  rangeStart: string,
  rangeEnd: string,
  ext = ".md",
): string {
  const SEG_MAX = 60
  const team = sanitizeFilenameName(teamName, SEG_MAX)
  const channel = sanitizeFilenameName(channelName, SEG_MAX)
  const extension = ext.startsWith(".") ? ext : `.${ext}`
  return `${team} \u203A ${channel}__channel__pulled-${pulledStamp}__${rangeStart}_to_${rangeEnd}${extension}`
}
