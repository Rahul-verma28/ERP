"use client"

import * as React from "react"
import { toast } from "sonner"
import { ExternalLink, FileSpreadsheet, FileText, ImageIcon, Loader2, Paperclip, Trash2, Upload, UserRound, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { errorMessage } from "@/lib/api"
import { ACCEPT, attachFiles, checkFile, formatSize, LIMIT_TEXT, listFiles, removeFile, uploadFile, useFileLink, type FileKind, type FileScope, type UploadedFile } from "@/lib/files"
import { cn } from "@/lib/utils"

// The shared photo and document boxes for every form: drop or pick a file, see it, open it,
// take it off. A record saves "file:<id>"; the bytes are in file storage (backend modules/files).

function FileTypeIcon({ mime, name }: { mime: string; name: string }) {
  if (mime.startsWith("image/")) return <ImageIcon className="size-4" />
  if (/sheet|excel|\.xlsx?$/i.test(mime + name)) return <FileSpreadsheet className="size-4" />
  return <FileText className="size-4" />
}

function useDrop(onFile: (f: File) => void, disabled?: boolean) {
  const [over, setOver] = React.useState(false)
  return {
    over,
    props: {
      onDragOver: (e: React.DragEvent) => {
        if (disabled) return
        e.preventDefault()
        setOver(true)
      },
      onDragLeave: () => setOver(false),
      onDrop: (e: React.DragEvent) => {
        if (disabled) return
        e.preventDefault()
        setOver(false)
        const f = e.dataTransfer.files?.[0]
        if (f) onFile(f)
      },
    },
  }
}

/** One saved file shown as a row: icon or thumbnail, name, size, open */
export function FileChip({ value, onRemove, className }: { value: string | null | undefined; onRemove?: () => void; className?: string }) {
  const { link, loading } = useFileLink(value)
  if (!value) return null
  const isImage = !!link && (link.mime.startsWith("image/") || link.url.startsWith("data:image"))
  return (
    <div className={cn("flex min-w-0 items-center gap-3 rounded-xl border bg-card px-3 py-2", className)}>
      {isImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={link.url} alt="" className="size-10 shrink-0 rounded-lg border object-cover" />
      ) : (
        <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">{loading ? <Loader2 className="size-4 animate-spin" /> : link ? <FileTypeIcon mime={link.mime} name={link.name} /> : <Paperclip className="size-4" />}</span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{loading ? "Loading…" : link?.name ?? "File can't be opened"}</span>
        {link && <span className="block text-xs text-muted-foreground">{link.size ? formatSize(link.size) : "Link"}</span>}
      </span>
      {link && (
        <a href={link.url} target="_blank" rel="noopener noreferrer" className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground" title="Open" aria-label={`Open ${link.name}`}>
          <ExternalLink className="size-4" />
        </a>
      )}
      {onRemove && (
        <button type="button" onClick={onRemove} className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive" title="Remove" aria-label="Remove file">
          <X className="size-4" />
        </button>
      )}
    </div>
  )
}

/**
 * One photo or document on a record. value is "file:<id>" (or an old link); onChange gets the new
 * one, or null when taken off. Uploads right away; the record saves it with the rest of the form.
 */
export function FileField({
  value,
  onChange,
  kind = "document",
  scope = "tenant",
  disabled,
  prompt,
  id,
  "aria-invalid": invalid,
  "aria-describedby": describedBy,
}: {
  value: string | null | undefined
  onChange: (v: string | null) => void
  kind?: FileKind
  scope?: FileScope
  disabled?: boolean
  /** Text in the empty box, e.g. "Upload the supplier's bill" */
  prompt?: string
  id?: string
  "aria-invalid"?: boolean
  "aria-describedby"?: string
}) {
  const input = React.useRef<HTMLInputElement>(null)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  async function pick(file?: File) {
    if (!file) return
    const bad = checkFile(file, kind)
    if (bad) return setError(bad)
    setError(null)
    setBusy(true)
    try {
      onChange((await uploadFile(file, { kind, scope })).ref)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  const drop = useDrop((f) => void pick(f), disabled || busy)
  return (
    <div className="grid gap-1.5">
      <input ref={input} id={id} type="file" accept={ACCEPT[kind]} className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = "" }} />
      {value ? (
        <FileChip value={value} onRemove={disabled ? undefined : () => onChange(null)} />
      ) : (
        <button
          type="button"
          disabled={disabled || busy}
          onClick={() => input.current?.click()}
          data-invalid={invalid || undefined}
          aria-describedby={describedBy}
          {...drop.props}
          className={cn(
            "flex min-h-14 w-full items-center gap-3 rounded-xl border border-dashed border-input bg-background px-3 py-2.5 text-left text-sm transition-colors hover:border-primary/60 hover:bg-primary/[0.03] disabled:cursor-not-allowed disabled:opacity-60 data-[invalid=true]:border-destructive",
            drop.over && "border-primary bg-primary/5"
          )}
        >
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">{busy ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}</span>
          <span className="min-w-0">
            <span className="block font-medium">{busy ? "Uploading…" : prompt ?? (kind === "image" ? "Upload a photo" : "Upload a file")}</span>
            <span className="block text-xs text-muted-foreground">Drop it here or click · {LIMIT_TEXT[kind]}</span>
          </span>
        </button>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}

/** A round profile photo with change and remove (employees, users, candidates) */
export function AvatarField({ value, onChange, name, disabled, scope = "tenant", id }: { value: string | null | undefined; onChange: (v: string | null) => void; name?: string; disabled?: boolean; scope?: FileScope; id?: string }) {
  const input = React.useRef<HTMLInputElement>(null)
  const { link } = useFileLink(value)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  async function pick(file?: File) {
    if (!file) return
    const bad = checkFile(file, "image")
    if (bad) return setError(bad)
    setError(null)
    setBusy(true)
    try {
      onChange((await uploadFile(file, { kind: "image", scope })).ref)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  const drop = useDrop((f) => void pick(f), disabled || busy)
  const initials = (name ?? "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("")
  return (
    <div className="flex items-center gap-4">
      <input ref={input} id={id} type="file" accept={ACCEPT.image} className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = "" }} />
      <button type="button" disabled={disabled || busy} onClick={() => input.current?.click()} {...drop.props} className={cn("relative grid size-20 shrink-0 place-items-center overflow-hidden rounded-full border-2 border-dashed border-input bg-muted text-muted-foreground transition-colors hover:border-primary/60", drop.over && "border-primary", value && "border-solid")} aria-label={value ? "Change photo" : "Add photo"}>
        {busy ? <Loader2 className="size-5 animate-spin" /> : link ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={link.url} alt="" className="size-full object-cover" />
        ) : initials ? <span className="text-lg font-semibold">{initials}</span> : <UserRound className="size-7" />}
      </button>
      <div className="grid gap-1 text-sm">
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" disabled={disabled || busy} onClick={() => input.current?.click()}><Upload /> {value ? "Change photo" : "Upload photo"}</Button>
          {value && !disabled && <Button type="button" variant="ghost" size="sm" className="text-muted-foreground" onClick={() => onChange(null)}><Trash2 /> Remove</Button>}
        </div>
        <span className="text-xs text-muted-foreground">JPG, PNG or WebP. It is made smaller before upload.</span>
        {error && <span className="text-xs text-destructive">{error}</span>}
      </div>
    </div>
  )
}

/**
 * Several files on one record (task attachments, a customer's papers, item photos). On a saved
 * record they are added and removed at once. On a new one they wait in `pending` and are tied
 * to the record by attachPending() after it is saved.
 */
export function AttachmentsField({
  entityType,
  entityId,
  field = "attachments",
  kind = "document",
  scope = "tenant",
  max = 10,
  pending,
  onPendingChange,
  disabled,
  prompt,
  onChange,
}: {
  entityType: string
  entityId?: string | null
  field?: string
  kind?: FileKind
  scope?: FileScope
  max?: number
  pending?: UploadedFile[]
  onPendingChange?: (files: UploadedFile[]) => void
  disabled?: boolean
  prompt?: string
  /** Told the files on the record whenever they change (e.g. to require at least one) */
  onChange?: (files: UploadedFile[]) => void
}) {
  const input = React.useRef<HTMLInputElement>(null)
  const [saved, setSaved] = React.useState<UploadedFile[] | null>(entityId ? null : [])
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  React.useEffect(() => {
    if (!entityId) return
    let live = true
    listFiles(entityType, entityId, { field, scope }).then((r) => live && setSaved(r.data)).catch(() => live && setSaved([]))
    return () => {
      live = false
    }
  }, [entityType, entityId, field, scope])
  const files = entityId ? saved ?? [] : pending ?? []
  const report = React.useRef(onChange)
  React.useEffect(() => {
    report.current = onChange
  })
  React.useEffect(() => {
    if (entityId && saved) report.current?.(saved)
  }, [entityId, saved])
  const full = files.length >= max

  async function pick(list: FileList | File[]) {
    const chosen = [...list].slice(0, Math.max(0, max - files.length))
    if (!chosen.length) return setError(`Up to ${max} files`)
    setError(null)
    setBusy(true)
    const added: UploadedFile[] = []
    for (const file of chosen) {
      const bad = checkFile(file, kind)
      if (bad) {
        setError(`${file.name}: ${bad}`)
        continue
      }
      try {
        added.push(await uploadFile(file, { kind, scope, field, ...(entityId ? { entityType, entityId } : {}) }))
      } catch (e) {
        setError(`${file.name}: ${errorMessage(e)}`)
      }
    }
    setBusy(false)
    if (entityId) setSaved((s) => [...(s ?? []), ...added])
    else onPendingChange?.([...(pending ?? []), ...added])
  }
  async function remove(f: UploadedFile) {
    try {
      await removeFile(f.id, scope)
      if (entityId) setSaved((s) => (s ?? []).filter((x) => x.id !== f.id))
      else onPendingChange?.((pending ?? []).filter((x) => x.id !== f.id))
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }
  const drop = useDrop((f) => void pick([f]), disabled || busy || full)
  return (
    <div className="grid gap-2">
      <input ref={input} type="file" multiple accept={ACCEPT[kind]} className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => { if (e.target.files) void pick(e.target.files); e.target.value = "" }} />
      {entityId && saved === null ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Loading files…</p>
      ) : (
        files.length > 0 && (
          <div className={cn("grid gap-2", kind === "image" ? "grid-cols-2 sm:grid-cols-3" : "")}>
            {files.map((f) => <FileChip key={f.id} value={f.ref} onRemove={disabled ? undefined : () => void remove(f)} />)}
          </div>
        )
      )}
      {!disabled && !full && (
        <button type="button" disabled={busy} onClick={() => input.current?.click()} {...drop.props} className={cn("flex items-center gap-3 rounded-xl border border-dashed border-input bg-background px-3 py-2.5 text-left text-sm transition-colors hover:border-primary/60 hover:bg-primary/[0.03] disabled:opacity-60", drop.over && "border-primary bg-primary/5")}>
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">{busy ? <Loader2 className="size-4 animate-spin" /> : <Paperclip className="size-4" />}</span>
          <span className="min-w-0">
            <span className="block font-medium">{busy ? "Uploading…" : prompt ?? (kind === "image" ? "Add photos" : "Add files")}</span>
            <span className="block text-xs text-muted-foreground">Drop here or click · {LIMIT_TEXT[kind]} · up to {max}</span>
          </span>
        </button>
      )}
      {disabled && !files.length && <p className="text-sm text-muted-foreground">No files.</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}

/** After a new record is saved: tie the files added while making it to the record */
export async function attachPending(files: UploadedFile[] | undefined, entityType: string, entityId: string, opts: { field?: string; scope?: FileScope } = {}) {
  if (!files?.length) return
  try {
    await attachFiles(files.map((f) => f.id), entityType, entityId, opts)
  } catch (e) {
    toast.error(`Saved, but the files couldn't be added: ${errorMessage(e)}`)
  }
}
