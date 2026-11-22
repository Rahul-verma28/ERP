"use client"

import * as React from "react"
import { FileText, ImageIcon, Loader2, Paperclip, X } from "lucide-react"
import { formatSize } from "@/lib/files"
import { cn } from "@/lib/utils"

// Photos and PDFs a customer adds on a public page (request form, tracking link, portal): no
// staff login. Each file is uploaded as it is picked; the page sends the ids with the request.

export interface CustomerFile {
  id: string
  name: string
  size: number
  mime: string
}

const MAX_BYTES = 5 * 1024 * 1024
const ACCEPT = "image/jpeg,image/png,image/webp,application/pdf"

/** Photos are made smaller before upload (long side 1600 px) so they go quickly on a phone */
async function shrink(file: File): Promise<Blob> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < 400_000) return file
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement("canvas")
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/jpeg", 0.82))
    return blob && blob.size < file.size ? blob : file
  } catch {
    return file
  }
}

export function CustomerFiles({ path, headers, files, onChange, max = 5, className }: { path: string; headers?: Record<string, string>; files: CustomerFile[]; onChange: (files: CustomerFile[]) => void; max?: number; className?: string }) {
  const input = React.useRef<HTMLInputElement>(null)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  async function pick(list: FileList) {
    const chosen = [...list].slice(0, Math.max(0, max - files.length))
    setError(null)
    setBusy(true)
    const added: CustomerFile[] = []
    for (const file of chosen) {
      if (!/^(image\/(jpeg|png|webp)|application\/pdf)$/.test(file.type)) {
        setError(`${file.name}: use a photo or a PDF`)
        continue
      }
      const body = await shrink(file)
      if (body.size > MAX_BYTES) {
        setError(`${file.name}: larger than 5 MB`)
        continue
      }
      try {
        const res = await fetch(`/api/v1${path}`, { method: "POST", headers: { "content-type": body.type || file.type, "x-file-name": encodeURIComponent(file.name), ...headers }, body })
        const json = (await res.json().catch(() => null)) as (CustomerFile & { error?: { message?: string } }) | null
        if (!res.ok || !json?.id) throw new Error(json?.error?.message ?? "Could not upload. Try again.")
        added.push({ id: json.id, name: json.name, size: json.size, mime: json.mime })
      } catch (e) {
        setError(`${file.name}: ${e instanceof Error ? e.message : "could not upload"}`)
      }
    }
    setBusy(false)
    if (added.length) onChange([...files, ...added])
  }

  return (
    <div className={cn("grid gap-2", className)}>
      <input ref={input} type="file" multiple accept={ACCEPT} className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => { if (e.target.files) void pick(e.target.files); e.target.value = "" }} />
      {files.map((f) => (
        <div key={f.id} className="flex items-center gap-3 rounded-xl border bg-white px-3 py-2 text-sm">
          <span className="grid size-8 place-items-center rounded-lg bg-neutral-100 text-neutral-600">{f.mime.startsWith("image/") ? <ImageIcon className="size-4" /> : <FileText className="size-4" />}</span>
          <span className="min-w-0 flex-1"><span className="block truncate font-medium">{f.name}</span><span className="text-xs text-neutral-500">{formatSize(f.size)}</span></span>
          <button type="button" onClick={() => onChange(files.filter((x) => x.id !== f.id))} className="grid size-8 place-items-center rounded-lg text-neutral-500 hover:bg-neutral-100" aria-label={`Remove ${f.name}`}><X className="size-4" /></button>
        </div>
      ))}
      {files.length < max && (
        <button type="button" disabled={busy} onClick={() => input.current?.click()} className="flex items-center gap-3 rounded-xl border border-dashed border-neutral-300 bg-white px-3 py-2.5 text-left text-sm hover:border-neutral-400 disabled:opacity-60">
          <span className="grid size-8 place-items-center rounded-lg bg-neutral-100 text-neutral-600">{busy ? <Loader2 className="size-4 animate-spin" /> : <Paperclip className="size-4" />}</span>
          <span><span className="block font-medium">{busy ? "Uploading…" : "Add photos or a PDF"}</span><span className="text-xs text-neutral-500">Optional · up to {max} · 5 MB each</span></span>
        </button>
      )}
      {error && <p className="text-xs text-rose-600">{error}</p>}
    </div>
  )
}
