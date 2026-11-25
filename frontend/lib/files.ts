"use client"

import * as React from "react"
import { api } from "@/lib/api"

// Photos and documents on records. A record keeps "file:<id>" (or an old https link); the file
// itself opens through a signed link that runs out, fetched here when the record is shown.

export type FileKind = "image" | "document"
export type FileScope = "tenant"

export interface UploadedFile {
  id: string
  ref: string
  name: string
  mime: string
  size: number
  field: string
  url: string
  createdAt: string
}

export const ACCEPT: Record<FileKind, string> = {
  image: "image/jpeg,image/png,image/webp",
  document: "application/pdf,image/jpeg,image/png,image/webp,.doc,.docx,.xls,.xlsx",
}
const MAX_BYTES: Record<FileKind, number> = { image: 5 * 1024 * 1024, document: 10 * 1024 * 1024 }
export const LIMIT_TEXT: Record<FileKind, string> = { image: "JPG, PNG or WebP", document: "PDF, photo, Word or Excel · up to 10 MB" }

const base = () => "/files"
export const isFileRef = (v: string | null | undefined): boolean => !!v && /^file:[0-9a-f-]{36}$/i.test(v)
export const formatSize = (n: number) => {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 / 1024).toFixed(1).replace(/\.0$/, "")} MB`
  return `${(n / 1024 ** 3).toFixed(1).replace(/\.0$/, "")} GB`
}

/** Photos are made smaller in the browser before upload: long side 1600 px, WebP */
async function shrinkPhoto(file: File): Promise<{ blob: Blob; name: string }> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return { blob: file, name: file.name }
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height))
    if (scale === 1 && file.size < 400_000) return { blob: file, name: file.name }
    const canvas = document.createElement("canvas")
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/webp", 0.82))
    if (!blob || blob.size >= file.size) return { blob: file, name: file.name }
    return { blob, name: file.name.replace(/\.[a-z0-9]+$/i, "") + ".webp" }
  } catch {
    return { blob: file, name: file.name }
  }
}

/** Checks the file in the browser first, so a wrong one is refused before it is sent */
export function checkFile(file: File, kind: FileKind): string | null {
  const okTypes = kind === "image" ? /^image\/(jpeg|png|webp)$/ : /^(application\/pdf|image\/(jpeg|png|webp)|application\/(msword|vnd\.ms-excel|vnd\.openxmlformats-officedocument\.(wordprocessingml\.document|spreadsheetml\.sheet)))$/
  const okExt = kind === "image" ? /\.(jpe?g|png|webp)$/i : /\.(pdf|jpe?g|png|webp|docx?|xlsx?)$/i
  if (!okTypes.test(file.type) && !okExt.test(file.name)) return kind === "image" ? "Use a JPG, PNG or WebP photo" : "Use a PDF, photo, Word or Excel file"
  // Photos are shrunk before upload, so only documents have a hard size limit here
  if (kind === "document" && file.size > MAX_BYTES.document) return "The file is larger than 10 MB"
  if (kind === "image" && file.size > 25 * 1024 * 1024) return "The photo is larger than 25 MB"
  return null
}

export async function uploadFile(file: File, opts: { kind: FileKind; scope?: FileScope; entityType?: string; entityId?: string; field?: string }): Promise<UploadedFile> {
  const isPhoto = /^image\//.test(file.type)
  const { blob, name } = isPhoto ? await shrinkPhoto(file) : { blob: file as Blob, name: file.name }
  const q = new URLSearchParams({ kind: opts.kind })
  if (opts.entityType) q.set("entityType", opts.entityType)
  if (opts.entityId) q.set("entityId", opts.entityId)
  if (opts.field) q.set("field", opts.field)
  const out = await api.upload<UploadedFile>(`${base()}?${q}`, blob, name)
  if (out?.url) linkCache.set(out.ref, { url: out.url, name: out.name, mime: out.mime, size: out.size, at: Date.now() })
  return out
}

/** Ties files uploaded on a new record to it once it is saved */
export async function attachFiles(ids: string[], entityType: string, entityId: string, opts: { field?: string; scope?: FileScope } = {}) {
  if (!ids.length) return
  await api.post(`${base()}/attach`, { ids, entityType, entityId, field: opts.field })
}

export const listFiles = (entityType: string, entityId: string, opts: { field?: string; scope?: FileScope } = {}) =>
  api.get<{ data: UploadedFile[] }>(`${base()}?${new URLSearchParams({ entityType, entityId, ...(opts.field ? { field: opts.field } : {}) })}`)

export const removeFile = (id: string) => api.delete(`${base()}/${id}`)

// ── Opening saved files: signed links, fetched in batches and kept for an hour ──

export interface FileLink {
  url: string
  name: string
  mime: string
  size: number
}
const linkCache = new Map<string, FileLink & { at: number }>()
const FRESH_MS = 60 * 60 * 1000
let queue: { refs: Set<string>; wait: Promise<void> } | null = null

function fetchLinks(refs: string[]): Promise<void> {
  if (!queue) {
    const q = { refs: new Set<string>(), wait: Promise.resolve() }
    q.wait = new Promise<void>((done) =>
      setTimeout(async () => {
        queue = null
        try {
          const res = await api.post<{ data: Record<string, FileLink | null> }>("/files/links", { refs: [...q.refs] })
          for (const [ref, link] of Object.entries(res.data)) if (link) linkCache.set(ref, { ...link, at: Date.now() })
        } catch {
          // Left out of the cache: the file shows as "can't open" and is asked for again later
        }
        done()
      }, 20)
    )
    queue = q
  }
  for (const r of refs) queue.refs.add(r)
  return queue.wait
}

const fresh = (ref: string) => {
  const hit = linkCache.get(ref)
  return hit && Date.now() - hit.at < FRESH_MS ? hit : null
}

/** The link that opens a saved photo or document (old https links come back as they are) */
export function useFileLink(value: string | null | undefined): { link: FileLink | null; loading: boolean } {
  const ref = value ?? null
  const plain = ref && !isFileRef(ref) ? ref : null
  // The ref whose links request has finished (found or not)
  const [tried, setTried] = React.useState<string | null>(null)
  const cached = ref && isFileRef(ref) ? fresh(ref) : null
  React.useEffect(() => {
    if (!ref || !isFileRef(ref) || fresh(ref)) return
    let live = true
    void fetchLinks([ref]).then(() => live && setTried(ref))
    return () => {
      live = false
    }
  }, [ref])
  if (plain) return { link: /^(https?:|data:)/i.test(plain) ? { url: plain, name: plain.startsWith("data:") ? "Image" : plain.split("/").pop() || "Link", mime: plain.startsWith("data:image") ? "image/*" : "", size: 0 } : null, loading: false }
  return { link: cached, loading: isFileRef(ref) && !cached && tried !== ref }
}

/** Open a saved file in a new tab: a signed link for uploads, the link itself for old ones */
export async function openFile(value: string | null | undefined) {
  if (!value) return
  if (!isFileRef(value)) {
    window.open(value, "_blank", "noopener")
    return
  }
  const hit = fresh(value)
  if (hit) {
    window.open(hit.url, "_blank", "noopener")
    return
  }
  // Open the tab now (still inside the click, so it isn't blocked), then point it at the file
  const tab = window.open("about:blank", "_blank")
  await fetchLinks([value])
  const link = fresh(value)
  if (tab) {
    tab.opener = null
    if (link) tab.location.href = link.url
    else tab.close()
  }
}

/** My account: the profile photo (one per person, shown in every business) */
export async function uploadAvatar(file: File) {
  const { blob, name } = await shrinkPhoto(file)
  return api.upload<UploadedFile>("/account/avatar", blob, name)
}
