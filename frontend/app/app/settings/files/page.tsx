"use client"

import * as React from "react"
import Link from "next/link"
import { toast } from "sonner"
import { ExternalLink, FileSpreadsheet, FileText, HardDrive, ImageIcon, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ConfirmDialog, EmptyState } from "@/components/common"
import { DataList, type Column } from "@/components/data-list"
import { PageHeader } from "@/components/app-shell"
import { Pill, Section } from "@/components/page-parts"
import { StorageBar, type StorageUsage } from "@/components/storage-usage"
import { api, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { formatSize } from "@/lib/files"
import { formatDateTime } from "@/lib/format"
import { useApi } from "@/lib/use-api"

// Settings › Files & storage: every photo and document the business has uploaded, what each is
// used for, and how much of the plan's storage is used. Owner and Admin by default (the files
// include HR papers and bills). A file in use is removed on its record; only unused ones here.

interface FileRow {
  id: string
  name: string
  mime: string
  kind: string
  size: number
  url: string
  createdAt: string
  uploadedBy: string
  used: boolean
  usedFor: string
  href: string | null
  area: string
}
interface Group {
  name: string
  files: number
  bytes: number
}
interface Library {
  usage: StorageUsage
  byKind: Group[]
  byArea: Group[]
  unusedBytes: number
  data: FileRow[]
}

const KIND_ICON = { Photo: ImageIcon, PDF: FileText, Excel: FileSpreadsheet } as Record<string, typeof FileText>

function Breakdown({ title, groups, total }: { title: string; groups: Group[]; total: number }) {
  return (
    <div className="grid content-start gap-2">
      <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{title}</p>
      {groups.length ? (
        groups.map((g) => (
          <div key={g.name} className="grid gap-1">
            <div className="flex justify-between gap-2 text-sm">
              <span>{g.name}</span>
              <span className="text-muted-foreground tabular-nums">{formatSize(g.bytes)} · {g.files}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary/70" style={{ width: `${total ? Math.max(2, (g.bytes / total) * 100) : 0}%` }} />
            </div>
          </div>
        ))
      ) : (
        <p className="text-sm text-muted-foreground">No files yet.</p>
      )}
    </div>
  )
}

export default function FilesPage() {
  const { can } = useAuth()
  const [version, setVersion] = React.useState(0)
  const [removing, setRemoving] = React.useState<FileRow | null>(null)
  const summary = useApi<Library>(can("tenant.file.view") ? `/files/library?v=${version}` : null)
  if (!can("tenant.file.view")) return <PageHeader title="Files & storage" description="Only the owner and admins can see every file of the business." />
  const canDelete = can("tenant.file.delete")
  const lib = summary.data

  const columns: Column<FileRow>[] = [
    {
      key: "name", header: "File", hideable: false, sort: (r) => r.name.toLowerCase(), csv: (r) => r.name,
      cell: (r) => {
        const Icon = KIND_ICON[r.kind] ?? FileText
        return (
          <span className="flex min-w-0 items-center gap-3">
            {r.kind === "Photo" ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={r.url} alt="" className="size-9 shrink-0 rounded-lg border object-cover" />
            ) : (
              <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><Icon className="size-4" /></span>
            )}
            <span className="min-w-0"><span className="block max-w-72 truncate font-medium">{r.name}</span><span className="text-xs text-muted-foreground">{r.kind}</span></span>
          </span>
        )
      },
    },
    { key: "size", header: "Size", align: "right", sort: (r) => r.size, csv: (r) => r.size, cell: (r) => <span className="tabular-nums">{formatSize(r.size)}</span> },
    {
      key: "used", header: "Used for", sort: (r) => r.usedFor, csv: (r) => r.usedFor,
      cell: (r) => (r.used ? (r.href ? <Link href={r.href} onClick={(e) => e.stopPropagation()} className="text-sm font-medium text-primary hover:underline">{r.usedFor}</Link> : <span className="text-sm">{r.usedFor}</span>) : <Pill color="amber">Not used</Pill>),
    },
    { key: "area", header: "Area", defaultHidden: true, csv: (r) => r.area, cell: (r) => r.area },
    { key: "by", header: "Uploaded by", sort: (r) => r.uploadedBy, csv: (r) => r.uploadedBy, cell: (r) => r.uploadedBy },
    { key: "at", header: "Uploaded", sort: (r) => r.createdAt, csv: (r) => r.createdAt, cell: (r) => <span className="text-sm text-muted-foreground">{formatDateTime(r.createdAt)}</span> },
    {
      key: "actions", header: "Actions", hideable: false,
      cell: (r) => (
        <span className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
          <a href={r.url} target="_blank" rel="noopener noreferrer" title="Open" aria-label={`Open ${r.name}`} className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"><ExternalLink className="size-4" /></a>
          {canDelete && !r.used && <Button variant="ghost" size="icon-sm" className="text-destructive" title="Delete" aria-label={`Delete ${r.name}`} onClick={() => setRemoving(r)}><Trash2 /></Button>}
        </span>
      ),
    },
  ]

  return (
    <div className="grid gap-5">
      <PageHeader title="Files & storage" description="Every photo and document your business has uploaded, what it is used for, and the storage your plan gives you." />
      {lib && (
        <Section title="Storage" action={can("tenant.billing.view") ? <Link href="/app/billing" className="text-sm font-medium text-primary hover:underline">Plan & billing</Link> : undefined}>
          <div className="grid gap-6">
            <StorageBar usage={lib.usage} />
            {lib.unusedBytes > 0 && <p className="rounded-xl bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">{formatSize(lib.unusedBytes)} is in files nothing uses. They are removed on their own after 2 days{canDelete ? ", or delete them now below" : ""}.</p>}
            <div className="grid gap-6 md:grid-cols-2">
              <Breakdown title="By area" groups={lib.byArea} total={lib.usage.usedBytes} />
              <Breakdown title="By type" groups={lib.byKind} total={lib.usage.usedBytes} />
            </div>
          </div>
        </Section>
      )}
      <DataList<FileRow>
        id="files-library"
        load={async ({ params, limit, cursor }) => {
          const res = lib ?? (await api.get<Library>("/files/library"))
          const q = (params.q ?? "").toLowerCase()
          const all = res.data.filter((r) => (params.show === "used" ? r.used : params.show === "unused" ? !r.used : true) && (!params.area || r.area === params.area) && (!params.kind || r.kind === params.kind) && (!q || `${r.name} ${r.usedFor} ${r.uploadedBy}`.toLowerCase().includes(q)))
          const start = Number(cursor ?? 0)
          return { data: all.slice(start, start + limit), nextCursor: start + limit < all.length ? String(start + limit) : null, total: all.length, counts: { all: res.data.length, used: res.data.filter((r) => r.used).length, unused: res.data.filter((r) => !r.used).length } }
        }}
        // Re-read the list whenever the library itself reloads (after a delete, the new data)
        params={{ v: lib ? `${lib.usage.files}-${lib.usage.usedBytes}-${lib.data[0]?.id ?? ""}` : "loading" }}
        header={{ title: "All files", description: "Open any file, see where it is used, and delete files nothing uses." }}
        presetLabel="Show"
        presets={[
          { key: "all", label: "All", params: {}, countKey: "all" },
          { key: "used", label: "In use", params: { show: "used" }, countKey: "used" },
          { key: "unused", label: "Not used", params: { show: "unused" }, countKey: "unused" },
        ]}
        filters={lib ? [
          { key: "area", label: "Area", options: lib.byArea.map((g) => ({ value: g.name, label: g.name })) },
          { key: "kind", label: "Type", options: lib.byKind.map((g) => ({ value: g.name, label: g.name })) },
        ] : undefined}
        columns={columns}
        searchPlaceholder="Search file name, use or person"
        exportName="files"
        emptyState={<EmptyState icon={HardDrive} title="No files yet" description="Photos and documents added on employees, bills, items, tickets and other records show here." />}
      />
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        destructive
        title={`Delete ${removing?.name}?`}
        description="Nothing uses this file. It is removed for good and its space is freed."
        confirmLabel="Delete file"
        onConfirm={async () => {
          try {
            await api.delete(`/files/library/${removing!.id}`)
            toast.success("File deleted")
            setVersion((v) => v + 1)
          } catch (e) {
            toast.error(errorMessage(e))
          }
        }}
      />
    </div>
  )
}
