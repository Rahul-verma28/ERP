"use client"

import * as React from "react"
import { ImagePlus, X } from "lucide-react"
import { Button } from "@/components/ui/button"

const SIDE = 480

/** Shrinks a photo in the browser so what is stored stays small */
async function shrink(file: File) {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, SIDE / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement("canvas")
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  const g = canvas.getContext("2d")!
  g.fillStyle = "#fff"
  g.fillRect(0, 0, canvas.width, canvas.height)
  g.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL("image/jpeg", 0.78)
}

export function ImagePicker({ value, onChange, disabled, label = "Upload image" }: { value: string | null; onChange: (v: string | null) => void; disabled?: boolean; label?: string }) {
  const input = React.useRef<HTMLInputElement>(null)
  const [error, setError] = React.useState<string | null>(null)
  async function pick(file?: File) {
    if (!file) return
    setError(null)
    if (!file.type.startsWith("image/")) return setError("Choose a JPG, PNG or WebP image")
    if (file.size > 10_000_000) return setError("Choose an image under 10 MB")
    try {
      onChange(await shrink(file))
    } catch {
      setError("This image could not be read. Try another one.")
    }
  }
  return (
    <div className="grid gap-2">
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" aria-label={label} onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = "" }} />
      {value ? (
        <div className="relative w-fit rounded-2xl border p-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={value} alt="" className="size-44 rounded-xl object-contain" />
          {!disabled && <Button type="button" variant="outline" size="icon-sm" className="absolute top-3 right-3" aria-label="Remove image" onClick={() => onChange(null)}><X /></Button>}
        </div>
      ) : (
        <button type="button" disabled={disabled} onClick={() => input.current?.click()} className="grid h-44 w-full max-w-sm place-items-center rounded-2xl border border-dashed text-sm text-muted-foreground transition-colors hover:bg-muted">
          <span className="grid justify-items-center gap-2"><ImagePlus className="size-6" aria-hidden />{label}</span>
        </button>
      )}
      {value && !disabled && <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => input.current?.click()}>Change image</Button>}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
