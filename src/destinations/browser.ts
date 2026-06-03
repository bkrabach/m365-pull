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

interface FilePickerWindow {
  showSaveFilePicker?: (opts: {
    suggestedName?: string
    types?: { description?: string; accept: Record<string, string[]> }[]
  }) => Promise<{
    createWritable: () => Promise<{
      write: (data: string) => Promise<void>
      close: () => Promise<void>
    }>
  }>
}


/** Save a string as a text file via the browser's save-file dialog. */
export async function saveAsText(
  suggestedName: string,
  content: string,
  opts: { extension: string; description: string; mimeType: string },
): Promise<SaveResult> {
  return saveTextFile(suggestedName, content, opts)
}

async function saveTextFile(
  suggestedName: string,
  content: string,
  opts: { extension: string; description: string; mimeType: string },
): Promise<SaveResult> {
  const cleaned = sanitize(suggestedName)
  const safeName = cleaned.endsWith(opts.extension)
    ? cleaned
    : cleaned + opts.extension

  const w = window as unknown as FilePickerWindow
  if (!w.showSaveFilePicker) {
    return { saved: false, reason: "unsupported" }
  }
  try {
    const handle = await w.showSaveFilePicker({
      suggestedName: safeName,
      types: [
        {
          description: opts.description,
          accept: { [opts.mimeType]: [opts.extension] },
        },
      ],
    })
    const writable = await handle.createWritable()
    await writable.write(content)
    await writable.close()
    return { saved: true }
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      return { saved: false, reason: "cancelled" }
    }
    return { saved: false, reason: (err as Error).message }
  }
}
