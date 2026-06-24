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
 * Build a collision-safe filename for a channel thread.
 *
 * Pattern: `<YYYY-MM-DD> · <subject>__<shortHash(rootId)><ext>`
 *
 * The shortHash of rootId is the same-day / same-subject collision fail-safe.
 */
export function buildThreadFilename(
  thread: ChannelThread,
  ext = ".md",
): string {
  const rootDate = thread.createdDateTime
    ? new Date(thread.createdDateTime)
    : new Date(thread.lastActivityMs)
  const dateStr = formatDateStamp(rootDate)
  const name = sanitizeFilenameName(thread.subject)
  const hash = shortHash(thread.rootId)
  const extension = ext.startsWith(".") ? ext : `.${ext}`
  return `${dateStr} \u00b7 ${name}__${hash}${extension}`
}
