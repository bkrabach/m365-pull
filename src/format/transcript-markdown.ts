// VTT-to-Markdown conversion.
//
// Ported from bkrabach/teams-transcript-md (capture.js), which has been
// dogfooded on hundreds of Teams transcripts. Same regex tolerance, same
// speaker-merging logic, same overlap-trim heuristic. The output format
// matches that extension byte-for-byte so transcripts produced by either
// tool are interchangeable in downstream pipelines.
//
// Pipeline: WEBVTT text -> cues -> mergeConsecutive -> renderMarkdown.
// Each step is pure and testable in isolation.

const WS = /\s+/g

const VTT_TIMESTAMP_RE =
  /^\s*(?:(\d{1,2}):)?(\d{2}):(\d{2})\.(\d{3})\s*-->\s*(?:(\d{1,2}):)?(\d{2}):(\d{2})\.(\d{3})/

const VTT_VOICE_RE = /<v\s+([^>]+?)>([\s\S]*?)(?:<\/v>|$)/g

const VTT_TAG_RE = /<[^>]+>/g

const VTT_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
  "&nbsp;": " ",
}

export interface Cue {
  start: number
  end: number
  speaker: string | null
  text: string
}

export interface RenderOptions {
  /** Title shown in the H1. */
  title: string
  /** "Source:" line — the SharePoint URL or human-readable origin. */
  sourceUrl?: string
  /** Label for cues with no speaker tag. Defaults to "Unknown". */
  unknownLabel?: string
  /** Prepend [mm:ss] timestamps to each line. Default true. */
  includeTimestamps?: boolean
  /** Merge same-speaker cues. Default true. */
  merge?: boolean
  /** Extra metadata lines to render between Speakers and the --- separator. */
  metadata?: { label: string; value: string }[]
}

function vttSeconds(h: string, m: string, s: string, ms: string): number {
  return (
    parseInt(h || "0", 10) * 3600 +
    parseInt(m, 10) * 60 +
    parseInt(s, 10) +
    parseInt(ms, 10) / 1000
  )
}

function vttDecodeEntities(text: string): string {
  for (const k of Object.keys(VTT_ENTITIES))
    text = text.split(k).join(VTT_ENTITIES[k])
  return text
}

function vttCleanPayload(raw: string): { speaker: string | null; text: string } {
  let speaker: string | null = null
  let text = raw.replace(VTT_VOICE_RE, (_m: string, spk: string, body: string) => {
    const s = (spk || "").trim()
    if (!speaker && s) speaker = s
    return body
  })
  text = text.replace(VTT_TAG_RE, "")
  text = vttDecodeEntities(text)
  text = text.replace(WS, " ").trim()
  return { speaker, text }
}

/** Parse a WEBVTT body into Cue objects. Tolerant of missing optional fields. */
export function parseVtt(content: string): Cue[] {
  const lines = content.split(/\r?\n/)
  const cues: Cue[] = []
  let i = 0
  while (i < lines.length) {
    const m = lines[i].match(VTT_TIMESTAMP_RE)
    if (!m) {
      i++
      continue
    }
    const start = vttSeconds(m[1], m[2], m[3], m[4])
    const end = vttSeconds(m[5], m[6], m[7], m[8])
    i++
    const payload: string[] = []
    while (i < lines.length && lines[i].trim() !== "") {
      payload.push(lines[i])
      i++
    }
    const { speaker, text } = vttCleanPayload(payload.join("\n"))
    if (text) cues.push({ start, end, speaker, text })
  }
  return cues
}

/** When Teams exports overlap cue boundaries, trim repeated word runs. */
function overlapTrim(prevText: string, nextText: string, maxWords = 12): string {
  const p = prevText.split(" ")
  const n = nextText.split(" ")
  if (!p.length || !n.length) return nextText
  const limit = Math.min(maxWords, p.length, n.length)
  for (let k = limit; k > 0; k--) {
    let ok = true
    for (let i = 0; i < k; i++) {
      if (p[p.length - k + i].toLowerCase() !== n[i].toLowerCase()) {
        ok = false
        break
      }
    }
    if (ok) return n.slice(k).join(" ")
  }
  return nextText
}

/** Merge adjacent cues from the same speaker, with overlap trimming. */
export function mergeConsecutive(cues: Cue[]): Cue[] {
  const out: Cue[] = []
  for (const c of cues) {
    const prev = out[out.length - 1]
    if (prev && prev.speaker === c.speaker) {
      const tail = overlapTrim(prev.text, c.text)
      prev.text = (prev.text + (tail ? " " + tail : "")).replace(WS, " ").trim()
      prev.end = Math.max(prev.end, c.end)
    } else {
      out.push({ ...c })
    }
  }
  return out
}

function formatTs(sec: number, withHours: boolean): string {
  const total = Math.max(0, Math.floor(sec))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const mm = String(m).padStart(2, "0")
  const ss = String(s).padStart(2, "0")
  return withHours ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

/** Render cues as LLM-friendly markdown. Matches teams-transcript-md output. */
export function renderMarkdown(cues: Cue[], options: RenderOptions): string {
  const {
    title,
    sourceUrl,
    unknownLabel = "Unknown",
    includeTimestamps = true,
    metadata = [],
  } = options

  if (!cues.length) {
    const head: string[] = [`# Transcript: ${title || "Untitled"}`, ""]
    if (sourceUrl) head.push(`Source: ${sourceUrl}`)
    for (const { label, value } of metadata) head.push(`${label}: ${value}`)
    head.push("")
    head.push("_(empty transcript)_")
    return head.join("\n") + "\n"
  }

  const duration = Math.max(...cues.map((c) => c.end))
  const hoursReq = duration >= 3600
  const speakerOrder: string[] = []
  const speakerSet = new Set<string>()
  for (const c of cues) {
    const lbl = c.speaker || unknownLabel
    if (!speakerSet.has(lbl)) {
      speakerSet.add(lbl)
      speakerOrder.push(lbl)
    }
  }

  const out: string[] = []
  out.push(`# Transcript: ${title || "Untitled"}`)
  out.push("")
  if (sourceUrl) out.push(`Source: ${sourceUrl}`)
  out.push(`Duration: ${formatTs(duration, true)}`)
  out.push(`Speakers: ${speakerOrder.join(", ")}`)
  for (const { label, value } of metadata) out.push(`${label}: ${value}`)
  out.push("")
  out.push("---")
  out.push("")
  for (const c of cues) {
    const spk = c.speaker || unknownLabel
    if (includeTimestamps) {
      out.push(`[${formatTs(c.start, hoursReq)}] ${spk}: ${c.text}`)
    } else {
      out.push(`${spk}: ${c.text}`)
    }
    out.push("")
  }
  return out.join("\n").trimEnd() + "\n"
}

/** End-to-end: WEBVTT string -> markdown string. Applies default merge. */
export function vttToMarkdown(vtt: string, options: RenderOptions): string {
  const cues = parseVtt(vtt)
  const merged = options.merge !== false ? mergeConsecutive(cues) : cues
  return renderMarkdown(merged, options)
}
