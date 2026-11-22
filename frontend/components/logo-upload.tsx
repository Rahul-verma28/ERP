"use client"

import * as React from "react"
import { ImageUp, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { api } from "@/lib/api"
import { useFileLink, type UploadedFile } from "@/lib/files"

// Logo upload (wireframe 2.1). The image is fitted into a square in the browser, resized to
// 320 px and uploaded to file storage; the tenant keeps "file:<id>" (older logos stay data URLs).

const MAX_BYTES = 2 * 1024 * 1024
const MIN_SIDE = 200
const OUT_SIDE = 320
const TYPES = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"]

async function toSquare(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image()
      i.onload = () => resolve(i)
      i.onerror = () => reject(new Error("This image can't be read. Try a PNG or JPG."))
      i.src = url
    })
    const w = img.naturalWidth || OUT_SIDE
    const h = img.naturalHeight || OUT_SIDE
    if (file.type !== "image/svg+xml" && Math.min(w, h) < MIN_SIDE) throw new Error(`Use an image at least ${MIN_SIDE}×${MIN_SIDE} pixels (this one is ${w}×${h}).`)
    // Fit the whole logo inside the square (no cropping of wide logos), on a white background
    const canvas = document.createElement("canvas")
    canvas.width = OUT_SIDE
    canvas.height = OUT_SIDE
    const ctx = canvas.getContext("2d")!
    ctx.fillStyle = "#FFFFFF"
    ctx.fillRect(0, 0, OUT_SIDE, OUT_SIDE)
    const scale = Math.min(OUT_SIDE / w, OUT_SIDE / h)
    ctx.drawImage(img, (OUT_SIDE - w * scale) / 2, (OUT_SIDE - h * scale) / 2, w * scale, h * scale)
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/webp", 0.9))
    if (!blob) throw new Error("Couldn't use this image.")
    return blob
  } finally {
    URL.revokeObjectURL(url)
  }
}

export function LogoUpload({ value, onChange, disabled }: { value: string; onChange: (ref: string) => void; disabled?: boolean }) {
  const preview = useFileLink(value || null).link?.url
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [dragging, setDragging] = React.useState(false)
  const [busy, setBusy] = React.useState(false)

  const take = async (file: File | undefined) => {
    setError(null)
    if (!file) return
    if (!TYPES.includes(file.type)) return setError("Use a PNG, JPG, WebP or SVG image.")
    if (file.size > MAX_BYTES) return setError(`This file is ${(file.size / 1024 / 1024).toFixed(1)} MB — use one up to 2 MB.`)
    setBusy(true)
    try {
      const blob = await toSquare(file)
      const saved = await api.upload<UploadedFile>("/files?kind=image&field=logo", blob, "logo.webp")
      onChange(saved.ref)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't use this image.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className={cn("flex flex-wrap items-center gap-5 rounded-xl border border-dashed border-input p-4 transition-colors", dragging && "border-primary bg-accent")}
      onDragOver={(e) => {
        e.preventDefault()
        if (!disabled) setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        if (!disabled) void take(e.dataTransfer.files?.[0])
      }}
    >
      <span className="grid size-[84px] shrink-0 place-items-center overflow-hidden rounded-[14px] bg-muted text-xs text-muted-foreground">
        {value && preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="Logo preview" className="size-full object-contain" />
        ) : (
          "Logo"
        )}
      </span>
      <div className="grid min-w-0 flex-1 gap-1.5">
        <p className="text-sm font-semibold">{value ? "Your logo" : "Upload your logo"}</p>
        <p className="text-xs text-muted-foreground">PNG, JPG or SVG · up to 2 MB · at least 200×200. It&apos;s fitted into a square.</p>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()} disabled={disabled || busy}>
            <ImageUp /> {busy ? "Uploading…" : value ? "Replace" : "Choose file"}
          </Button>
          {value ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => onChange("")} disabled={disabled}>
              <Trash2 /> Remove
            </Button>
          ) : (
            <span className="text-xs text-muted-foreground">or drag it here</span>
          )}
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
      <input ref={inputRef} type="file" accept={TYPES.join(",")} className="hidden" aria-label="Logo file" onChange={(e) => void take(e.target.files?.[0] ?? undefined)} />
    </div>
  )
}
