"use client"

import * as React from "react"
import { ImagePlus, Loader2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { errorMessage } from "@/lib/api"
import { checkFile, uploadFile, useFileLink } from "@/lib/files"

/**
 * One product photo. The photo is made smaller in the browser and uploaded to file storage;
 * the item keeps "file:<id>". Photos saved before uploads (data images) still show and save.
 */
export function ImagePicker({ value, onChange, disabled, label = "Upload image" }: { value: string | null; onChange: (v: string | null) => void; disabled?: boolean; label?: string }) {
  const input = React.useRef<HTMLInputElement>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const { link } = useFileLink(value)
  async function pick(file?: File) {
    if (!file) return
    setError(null)
    const bad = checkFile(file, "image")
    if (bad) return setError(bad)
    setBusy(true)
    try {
      onChange((await uploadFile(file, { kind: "image", field: "photo" })).ref)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="grid gap-2">
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" aria-label={label} onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = "" }} />
      {value ? (
        <div className="relative w-fit rounded-2xl border p-2">
          {link ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={link.url} alt="" className="size-44 rounded-xl object-contain" />
          ) : (
            <span className="grid size-44 place-items-center text-muted-foreground"><Loader2 className="size-5 animate-spin" /></span>
          )}
          {!disabled && <Button type="button" variant="outline" size="icon-sm" className="absolute top-3 right-3" aria-label="Remove image" onClick={() => onChange(null)}><X /></Button>}
        </div>
      ) : (
        <button type="button" disabled={disabled || busy} onClick={() => input.current?.click()} className="grid h-44 w-full max-w-sm place-items-center rounded-2xl border border-dashed text-sm text-muted-foreground transition-colors hover:bg-muted">
          <span className="grid justify-items-center gap-2">{busy ? <Loader2 className="size-6 animate-spin" /> : <ImagePlus className="size-6" aria-hidden />}{busy ? "Uploading…" : label}</span>
        </button>
      )}
      {value && !disabled && <Button type="button" variant="outline" size="sm" className="w-fit" disabled={busy} onClick={() => input.current?.click()}>{busy ? "Uploading…" : "Change image"}</Button>}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
