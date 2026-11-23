"use client"

import * as React from "react"
import { toast } from "sonner"
import { BookOpen, Eye, MessageSquareText, Pencil, Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ConfirmDialog, EmptyState } from "@/components/common"
import { DataList, localList, type ViewPreset } from "@/components/data-list"
import { Pill } from "@/components/page-parts"
import { RecordView } from "@/components/record-view"
import { SummaryCards } from "@/components/summary-cards"
import { ArticleDialog } from "@/components/support/forms"
import { api, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { formatDate } from "@/lib/format"
import { categoryOf, useSupportSettings, type Article } from "@/lib/support"
import { NoAccessPage } from "@/components/page-states"

// Knowledge base: help articles (published ones show on the request form) and saved replies the
// team drops into answers in one click.

export default function KnowledgePage() {
  const { can } = useAuth()
  const settings = useSupportSettings().data
  const [version, setVersion] = React.useState(0)
  const [editing, setEditing] = React.useState<{ article: Article | null; kind: "article" | "reply" } | null>(null)
  const [viewing, setViewing] = React.useState<Article | null>(null)
  const [removing, setRemoving] = React.useState<Article | null>(null)
  if (!can("support.kb.view")) return <NoAccessPage title="Knowledge base" permission="support.kb.view" />
  const reload = () => setVersion((v) => v + 1)
  const canEdit = can("support.kb.edit")
  const presets: ViewPreset[] = [
    { key: "all", label: "All", params: {}, countKey: "all" },
    { key: "article", label: "Help articles", params: { kind: "article" }, countKey: "article" },
    { key: "reply", label: "Saved replies", params: { kind: "reply" }, countKey: "reply" },
    { key: "draft", label: "Not published", params: { kind: "draft" }, countKey: "draft" },
  ]
  const add = can("support.kb.create") ? (
    <span className="flex gap-2">
      <Button variant="outline" className="h-10 rounded-xl" onClick={() => setEditing({ article: null, kind: "reply" })}><MessageSquareText /> Saved reply</Button>
      <Button className="h-10 rounded-xl px-4 font-semibold" onClick={() => setEditing({ article: null, kind: "article" })}><Plus /> New article</Button>
    </span>
  ) : undefined

  return (
    <>
      <DataList<Article>
        id="support-knowledge"
        params={{ v: String(version) }}
        load={localList(async () => (await api.get<{ data: Article[] }>("/support/articles")).data, (a, q) => `${a.title} ${a.body} ${a.tags.join(" ")}`.toLowerCase().includes(q), {
          filter: (a, p) => (p.kind === "draft" ? !a.published : !p.kind || a.kind === p.kind),
          counts: (rows) => ({ all: rows.length, article: rows.filter((a) => a.kind === "article").length, reply: rows.filter((a) => a.kind === "reply").length, draft: rows.filter((a) => !a.published).length }),
          meta: (rows) => ({ uses: rows.reduce((s, a) => s + a.uses, 0), top: rows.filter((a) => a.kind === "reply").sort((a, b) => b.uses - a.uses)[0]?.title ?? null }),
        })}
        header={{ title: "Knowledge base", description: "Write common answers once. Saved replies go into tickets in one click; published articles help customers on your request form.", primary: add, more: [{ label: "Tickets", href: "/app/m/support" }] }}
        presets={presets}
        tabs
        top={(res) => {
          const c = (res.counts ?? {}) as Record<string, number>
          return <SummaryCards items={[
            { label: "Help articles", value: c.article ?? 0, hint: `${c.draft ?? 0} not published`, color: "blue", icon: BookOpen },
            { label: "Saved replies", value: c.reply ?? 0, hint: res.top ? `Most used: ${res.top}` : "Add your common answers", color: "violet", icon: MessageSquareText },
            { label: "Times used", value: Number(res.uses ?? 0), hint: "Saved replies put into tickets", color: "emerald", icon: Eye },
          ]} />
        }}
        columns={[
          { key: "title", header: "Title", hideable: false, sort: (a) => a.title, csv: (a) => a.title, cell: (a) => <span><span className="font-medium">{a.title}</span><span className="block max-w-96 truncate text-xs text-muted-foreground">{a.body}</span></span> },
          { key: "kind", header: "Type", csv: (a) => (a.kind === "reply" ? "Saved reply" : "Article"), cell: (a) => <Pill color={a.kind === "reply" ? "violet" : "blue"}>{a.kind === "reply" ? "Saved reply" : "Article"}</Pill> },
          { key: "category", header: "Category", csv: (a) => (a.category ? categoryOf(settings?.categories, a.category).label : ""), cell: (a) => (a.category ? <Pill color={categoryOf(settings?.categories, a.category).color}>{categoryOf(settings?.categories, a.category).label}</Pill> : <span className="text-muted-foreground">Any</span>) },
          { key: "tags", header: "Tags", defaultHidden: true, csv: (a) => a.tags.join(", "), cell: (a) => <span className="flex flex-wrap gap-1">{a.tags.map((t) => <span key={t} className="rounded-full bg-muted px-1.5 text-[11px]">{t}</span>)}</span> },
          { key: "published", header: "Published", csv: (a) => (a.published ? "Yes" : "No"), cell: (a) => (a.kind === "reply" ? <span className="text-muted-foreground">—</span> : a.published ? <Pill color="emerald">Published</Pill> : <Pill>Draft</Pill>) },
          { key: "uses", header: "Used", align: "right", sort: (a) => a.uses, csv: (a) => a.uses, cell: (a) => a.uses || "—" },
          { key: "updated", header: "Updated", sort: (a) => a.updatedAt, csv: (a) => a.updatedAt.slice(0, 10), cell: (a) => <span className="text-xs text-muted-foreground">{formatDate(a.updatedAt)}{a.createdByName ? ` · ${a.createdByName}` : ""}</span> },
          { key: "actions", header: "Actions", hideable: false, cell: (a) => (
            <span className="flex items-center justify-end gap-0.5" onClick={(e) => e.stopPropagation()}>
              <Button variant="ghost" size="icon-sm" title="View" aria-label={`View ${a.title}`} onClick={() => setViewing(a)}><Eye /></Button>
              {canEdit && <Button variant="ghost" size="icon-sm" title="Edit" aria-label={`Edit ${a.title}`} onClick={() => setEditing({ article: a, kind: a.kind })}><Pencil /></Button>}
              {canEdit && <Button variant="ghost" size="icon-sm" className="text-destructive" title="Delete" aria-label={`Delete ${a.title}`} onClick={() => setRemoving(a)}><Trash2 /></Button>}
            </span>
          ) },
        ]}
        searchPlaceholder="Search title, text or tag"
        rowClick={setViewing}
        exportName="knowledge-base"
        emptyState={<EmptyState icon={BookOpen} title="Nothing written yet" description="Start with your warranty terms and the answer you give most often." action={add} />}
      />
      {viewing && (
        <RecordView title={viewing.title} icon={viewing.kind === "reply" ? MessageSquareText : BookOpen} status={<Pill color={viewing.kind === "reply" ? "violet" : "blue"}>{viewing.kind === "reply" ? "Saved reply" : viewing.published ? "Published article" : "Draft article"}</Pill>} onClose={() => setViewing(null)} wide
          fields={[
            { label: "Text", value: viewing.body, full: true },
            { label: "Category", value: viewing.category ? categoryOf(settings?.categories, viewing.category).label : "Any" },
            { label: "Used", value: `${viewing.uses} time${viewing.uses === 1 ? "" : "s"}` },
            viewing.tags.length > 0 && { label: "Tags", value: viewing.tags.join(", "), full: true },
            { label: "Updated", value: `${formatDate(viewing.updatedAt)}${viewing.createdByName ? ` · written by ${viewing.createdByName}` : ""}` },
          ]}
          footer={canEdit ? <Button onClick={() => { setEditing({ article: viewing, kind: viewing.kind }); setViewing(null) }}><Pencil /> Edit</Button> : undefined}
        />
      )}
      {editing && <ArticleDialog article={editing.article} kind={editing.kind} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload() }} />}
      <ConfirmDialog open={!!removing} onOpenChange={(o) => !o && setRemoving(null)} destructive title={`Delete ${removing?.title}?`} confirmLabel="Delete" onConfirm={async () => { try { await api.delete(`/support/articles/${removing!.id}`); toast.success("Deleted"); reload() } catch (e) { toast.error(errorMessage(e)) } }} />
    </>
  )
}
