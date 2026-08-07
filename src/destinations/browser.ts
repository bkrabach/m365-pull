/** Sanitize a path-derived suggested filename to a safe, flat name. */
function sanitize(name: string): string {
  return name
    .replace(/[/\\]/g, "-") // path separators
    .replace(/[^a-zA-Z0-9._-]/g, "-") // anything else not safe
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 200)
}

export interface SaveResult {
  saved: boolean
  reason?: "cancelled" | "unsupported" | string
}

/** Save a string as a text file via a browser download. */
export async function saveAsText(
  suggestedName: string,
  content: string,
  opts: { extension: string; description: string; mimeType: string },
): Promise<SaveResult> {
  return saveTextFile(suggestedName, content, opts)
}

/**
 * Writes via an object-URL + anchor click, NOT window.showSaveFilePicker().
 *
 * showSaveFilePicker() requires *transient user activation*, which Chrome grants
 * for roughly five seconds after a click and consumes on use. Every caller here
 * fetches from Microsoft Graph before it has anything to save, and that fetch
 * routinely outlives the activation window -- paginating a chat's messages takes
 * seconds. The picker then throws:
 *
 *   "Failed to execute 'showSaveFilePicker' on 'Window':
 *    Must be handling a user gesture to show a file picker."
 *
 * Measured behaviour before this change: downloading a recording transcript
 * succeeded (fast fetch, picker fired inside the window) while downloading a
 * chat failed every time (slow fetch, window expired). A bulk run of one chat +
 * two recordings reported "0 of 3 saved" -- the chat consumed the activation
 * without ever opening a dialog, so the two recordings behind it failed too,
 * despite succeeding when run on their own.
 *
 * Anchor downloads have no activation requirement and no per-file dialog, so a
 * bulk run of twenty artifacts behaves the same as a run of one. The trade-off
 * is that the user no longer chooses the destination -- files land in the
 * browser's download folder, and Chrome may show a one-time "allow multiple
 * downloads?" prompt on the second file of a bulk run.
 *
 * Do NOT reintroduce showSaveFilePicker() here without moving the call to the
 * click handler itself, before any await.
 */
async function saveTextFile(
  suggestedName: string,
  content: string,
  opts: { extension: string; description: string; mimeType: string },
): Promise<SaveResult> {
  const cleaned = sanitize(suggestedName)
  const safeName = cleaned.endsWith(opts.extension)
    ? cleaned
    : cleaned + opts.extension

  let url: string | undefined
  try {
    const blob = new Blob([content], { type: `${opts.mimeType};charset=utf-8` })
    url = URL.createObjectURL(blob)

    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = safeName
    anchor.rel = "noopener"
    anchor.style.display = "none"
    // Must be in the document for the click to dispatch in Firefox.
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()

    // Revoking synchronously can cancel an in-flight download; give the browser
    // time to consume the blob first.
    const objectUrl = url
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000)

    return { saved: true }
  } catch (err) {
    if (url) URL.revokeObjectURL(url)
    return { saved: false, reason: (err as Error).message }
  }
}
