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

  // Honest feature detection. A browser without the anchor `download`
  // attribute (Safari before 10.1) does NOT save the blob -- it navigates to
  // it / opens it inline instead. That path never throws, so a blind
  // `saved: true` would report a silent failure as success. Detect it up front
  // and report it as unsupported.
  const anchor = document.createElement("a")
  if (!("download" in anchor)) {
    return { saved: false, reason: "unsupported" }
  }

  let url: string | undefined
  try {
    const blob = new Blob([content], { type: `${opts.mimeType};charset=utf-8` })
    url = URL.createObjectURL(blob)
    const objectUrl = url

    anchor.href = url
    anchor.download = safeName
    anchor.rel = "noopener"
    anchor.style.display = "none"
    // Must be in the document for the click to dispatch in Firefox.
    document.body.appendChild(anchor)
    anchor.click()

    // Safari/WebKit aborts the download if the anchor is torn down in the same
    // frame as the click: it needs the element to survive at least one tick to
    // consume it. Removing it synchronously (the previous behaviour) was the
    // root cause of downloads silently failing on Safari/Mac. Chrome and
    // Firefox tolerate synchronous teardown, so deferring is safe for all
    // three. The click has already dispatched synchronously above, so Firefox's
    // "anchor must be in the document" requirement is still satisfied.
    setTimeout(() => anchor.remove(), 0)
    // Revoking synchronously can likewise cancel an in-flight download; give
    // the browser time to consume the blob first.
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000)

    // NOTE: this reports that the download was successfully *initiated* on a
    // browser that supports the mechanism -- it is not a confirmation the file
    // was written. The anchor+blob technique exposes no acceptance signal, so
    // that is the strongest honest claim available. Undetectable failures
    // (user declines the browser's save prompt, disk full) cannot surface here.
    return { saved: true }
  } catch (err) {
    if (url) URL.revokeObjectURL(url)
    anchor.remove()
    return { saved: false, reason: (err as Error).message }
  }
}
