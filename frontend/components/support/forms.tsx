"use client"

import * as React from "react"
import { toast } from "sonner"
import { X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { Field, FormError, NativeSelect } from "@/components/form"
import { ContactPicker, ItemPicker, type ContactOption } from "@/components/pickers"
import { FormSection, LabelInput } from "@/components/tasks/forms"
import { api, ApiError, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useApi } from "@/lib/use-api"
import { formatDate, formatPaise } from "@/lib/format"
import { CHANNEL, PRIORITY, useAgents, useSupportSettings, type Article, type Channel, type Ticket, type TicketPriority } from "@/lib/support"

// Every Customer Service form: a new ticket (or its details), resolving one, and a knowledge base
// article or saved reply. Each groups its fields, marks what is required, checks it before sending
// and shows the API's field errors where they belong.

const useErrors = () => {
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [error, setError] = React.useState<string | null>(null)
  const fail = (err: unknown) => { if (err instanceof ApiError) setErrors(err.fields); setError(errorMessage(err)) }
  return { errors, setErrors, error, setError, fail }
}

/** A new ticket, or the details of one (customer stays as it was) */
export function TicketDialog({ ticket, defaults, onClose, onSaved }: { ticket?: Ticket | null; defaults?: { contact?: ContactOption | null; invoiceId?: string | null }; onClose: () => void; onSaved: (t: { id: string }) => void }) {
  const edit = !!ticket
  const { me } = useAuth()
  const settings = useSupportSettings().data
  const agents = useAgents().data?.data ?? []
  const [who, setWho] = React.useState<"customer" | "guest">(defaults?.contact || !edit ? "customer" : ticket?.contactId ? "customer" : "guest")
  const [contact, setContact] = React.useState<ContactOption | null>(defaults?.contact ?? null)
  const [f, setF] = React.useState({
    subject: ticket?.subject ?? "", description: ticket?.description ?? "", category: ticket?.category ?? "complaint", priority: ticket?.priority ?? ("medium" as TicketPriority),
    channel: ticket?.channel ?? ("phone" as Channel), assigneeId: ticket ? ticket.assigneeId ?? "" : agents.some((a) => a.id === me?.user.id) ? me?.user.id ?? "" : "",
    guestName: "", guestPhone: "", guestEmail: "", invoiceId: ticket?.invoiceId ?? defaults?.invoiceId ?? "", serial: ticket?.serial ?? "", labels: ticket?.labels ?? [],
  })
  const [item, setItem] = React.useState<{ id: string; name: string } | null>(ticket?.item ? { id: ticket.item.id, name: ticket.item.name } : null)
  const invoices = useApi<{ data: { id: string; number: string | null; issueDate: string; totalPaise: number }[] }>(contact?.id ? `/invoices?contactId=${contact.id}&limit=30` : null)
  const { errors, setErrors, error, setError, fail } = useErrors()
  const [busy, setBusy] = React.useState(false)
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => { setF((x) => ({ ...x, [k]: v })); setErrors((e) => ({ ...e, [k]: "" })); setError(null) }
  const sla = settings?.sla[f.priority]

  async function save(e: React.FormEvent) {
    e.preventDefault()
    const x: Record<string, string> = {}
    if (f.subject.trim().length < 3) x.subject = "Say what it is about"
    if (!edit && who === "customer" && !contact) x.contactId = "Choose the customer, or switch to someone new"
    if (!edit && who === "guest") {
      if (f.guestName.trim().length < 2) x.guestName = "Enter their name"
      if (f.guestPhone && !/^[6-9]\d{9}$/.test(f.guestPhone)) x.guestPhone = "Enter a 10-digit mobile number"
      if (f.guestEmail && !/^\S+@\S+\.\S+$/.test(f.guestEmail)) x.guestEmail = "Enter a valid email"
      if (!f.guestPhone && !f.guestEmail) x.guestPhone = "Add a mobile number or email to reach them"
    }
    setErrors(x)
    if (Object.keys(x).length) return
    setBusy(true)
    try {
      const common = { subject: f.subject.trim(), description: f.description.trim() || null, category: f.category, priority: f.priority, channel: f.channel, assigneeId: f.assigneeId || null, labels: f.labels, invoiceId: f.invoiceId || null, itemId: item?.id ?? null, serial: f.serial.trim() || null }
      const t = edit
        ? await api.patch<{ id: string }>(`/support/tickets/${ticket!.id}`, { ...common, version: ticket!.version })
        : await api.post<{ id: string }>("/support/tickets", { ...common, ...(who === "customer" ? { contactId: contact!.id } : { guestName: f.guestName.trim(), guestPhone: f.guestPhone || null, guestEmail: f.guestEmail.trim() || null }) })
      toast.success(edit ? "Ticket saved" : "Ticket created")
      onSaved(t)
    } catch (err) {
      fail(err)
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader><DialogTitle>{edit ? `Edit ${ticket!.number}` : "New ticket"}</DialogTitle><DialogDescription>A complaint, repair or question from a customer. It gets a number and a reply-by time from your SLA.</DialogDescription></DialogHeader>
        <form onSubmit={save} className="grid gap-4" noValidate>
          {!edit && (
            <FormSection title="Who">
              <div className="flex rounded-xl border p-1 text-sm sm:col-span-2" role="radiogroup" aria-label="Who">
                {(["customer", "guest"] as const).map((k) => <button key={k} type="button" role="radio" aria-checked={who === k} onClick={() => { setWho(k); setErrors({}) }} className={`flex-1 rounded-lg px-3 py-1.5 font-medium ${who === k ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>{k === "customer" ? "A customer" : "Someone new"}</button>)}
              </div>
              {who === "customer" ? (
                <Field label="Customer" required error={errors.contactId} className="sm:col-span-2"><ContactPicker value={contact} onChange={(c) => { setContact(c); set("invoiceId", "") }} /></Field>
              ) : (
                <>
                  <Field label="Name" required error={errors.guestName}><Input value={f.guestName} maxLength={120} onChange={(e) => set("guestName", e.target.value)} /></Field>
                  <Field label="Mobile" required={!f.guestEmail} error={errors.guestPhone}><Input inputMode="numeric" maxLength={10} value={f.guestPhone} onChange={(e) => set("guestPhone", e.target.value.replace(/\D/g, ""))} placeholder="10-digit number" /></Field>
                  <Field label="Email" error={errors.guestEmail} className="sm:col-span-2"><Input type="email" value={f.guestEmail} onChange={(e) => set("guestEmail", e.target.value)} /></Field>
                </>
              )}
            </FormSection>
          )}
          <FormSection title="The request">
            <Field label="Subject" required error={errors.subject} className="sm:col-span-2"><Input value={f.subject} maxLength={200} autoFocus={edit} onChange={(e) => set("subject", e.target.value)} placeholder="e.g. Ceiling fan making noise after 2 weeks" /></Field>
            <Field label="Details" className="sm:col-span-2" count={[f.description.length, 5000]}><Textarea rows={3} maxLength={5000} value={f.description} onChange={(e) => set("description", e.target.value)} placeholder="What the customer said, what was tried" /></Field>
            <Field label="Category" required error={errors.category}><NativeSelect value={f.category} onChange={(e) => set("category", e.target.value)}>{(settings?.categories ?? []).map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</NativeSelect></Field>
            <Field label="Came in by"><NativeSelect value={f.channel} onChange={(e) => set("channel", e.target.value as Channel)}>{Object.entries(CHANNEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</NativeSelect></Field>
            <Field label="Priority" hint={sla ? `Reply within ${sla.respondH} h, fix within ${sla.resolveH} h` : undefined}><NativeSelect value={f.priority} onChange={(e) => set("priority", e.target.value as TicketPriority)}>{(["low", "medium", "high", "urgent"] as const).map((p) => <option key={p} value={p}>{PRIORITY[p].label}</option>)}</NativeSelect></Field>
            <Field label="Handled by" error={errors.assigneeId} hint={!agents.length ? "Give a role ticket access to assign people" : settings?.autoAssign === "round_robin" && !f.assigneeId ? "Left empty, the next person in turn gets it" : undefined}>
              <NativeSelect value={f.assigneeId} onChange={(e) => set("assigneeId", e.target.value)}><option value="">Not assigned</option>{agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</NativeSelect>
            </Field>
            <Field label="Labels" className="sm:col-span-2" hint="Up to 8, e.g. VIP, Warranty, Second visit"><LabelInput value={f.labels} onChange={(v) => set("labels", v)} /></Field>
          </FormSection>
          <FormSection title="What it is about (for warranty)">
            {(who === "customer" && contact) || edit ? (
              <Field label="Invoice" error={errors.invoiceId} className="sm:col-span-2">
                <NativeSelect value={f.invoiceId} onChange={(e) => set("invoiceId", e.target.value)}>
                  <option value="">No invoice</option>
                  {ticket?.invoice && !invoices.data?.data.some((i) => i.id === ticket.invoice!.id) && <option value={ticket.invoice.id}>{ticket.invoice.number}</option>}
                  {(invoices.data?.data ?? ticket?.recentInvoices ?? []).map((i) => <option key={i.id} value={i.id}>{i.number ?? "Draft"} · {formatDate(i.issueDate)} · {formatPaise(i.totalPaise)}</option>)}
                </NativeSelect>
              </Field>
            ) : null}
            <Field label="Product" className="sm:col-span-2">
              {item ? <div className="flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-sm"><span className="font-medium">{item.name}</span><Button type="button" variant="ghost" size="icon-sm" aria-label="Remove product" onClick={() => setItem(null)}><X /></Button></div> : <ItemPicker onPick={(i) => setItem({ id: i.id, name: i.name })} placeholder="Search the product it is about" />}
            </Field>
            <Field label="Serial / IMEI" hint="Finds the sale and the warranty" className="sm:col-span-2"><Input value={f.serial} maxLength={60} onChange={(e) => set("serial", e.target.value)} /></Field>
          </FormSection>
          <FormError message={error} />
          <DialogFooter><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? "Saving…" : edit ? "Save ticket" : "Create ticket"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Resolve or close: what was done is required, so the history says how it ended */
export function ResolveDialog({ ticket, to, onClose, onSaved }: { ticket: { id: string; number: string; version: number }; to: "resolved" | "closed"; onClose: () => void; onSaved: () => void }) {
  const [note, setNote] = React.useState("")
  const { errors, setErrors, error, fail } = useErrors()
  const [busy, setBusy] = React.useState(false)
  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (note.trim().length < 3) return setErrors({ resolution: to === "resolved" ? "Say what was done" : "Say why it is closed" })
    setBusy(true)
    try {
      await api.patch(`/support/tickets/${ticket.id}`, { status: to, resolution: note.trim(), version: ticket.version })
      toast.success(to === "resolved" ? `${ticket.number} resolved` : `${ticket.number} closed`)
      onSaved()
    } catch (err) {
      fail(err)
      setBusy(false)
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>{to === "resolved" ? `Resolve ${ticket.number}` : `Close ${ticket.number}`}</DialogTitle><DialogDescription>{to === "resolved" ? "The customer can still reply to reopen it, and is asked to rate the help." : "Closed tickets can be reopened from this page if needed."}</DialogDescription></DialogHeader>
        <form onSubmit={save} className="grid gap-4" noValidate>
          <Field label={to === "resolved" ? "What was done" : "Why it is closed"} required error={errors.resolution} count={[note.length, 2000]}><Textarea rows={4} maxLength={2000} autoFocus value={note} onChange={(e) => { setNote(e.target.value); setErrors({}) }} placeholder={to === "resolved" ? "e.g. Replaced the capacitor at the customer's home. Fan tested OK." : "e.g. Customer did not respond for 2 weeks"} /></Field>
          <FormError message={error} />
          <DialogFooter><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? "Saving…" : to === "resolved" ? "Mark resolved" : "Close ticket"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** A help article, or a saved reply the team inserts into answers */
export function ArticleDialog({ article, kind, onClose, onSaved }: { article?: Article | null; kind: "article" | "reply"; onClose: () => void; onSaved: () => void }) {
  const settings = useSupportSettings().data
  const [f, setF] = React.useState({ title: article?.title ?? "", body: article?.body ?? "", category: article?.category ?? "", tags: article?.tags ?? [], kind: article?.kind ?? kind, published: article?.published ?? true })
  const { errors, setErrors, error, setError, fail } = useErrors()
  const [busy, setBusy] = React.useState(false)
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => { setF((x) => ({ ...x, [k]: v })); setErrors((e) => ({ ...e, [k]: "" })); setError(null) }
  const reply = f.kind === "reply"
  async function save(e: React.FormEvent) {
    e.preventDefault()
    const x: Record<string, string> = {}
    if (f.title.trim().length < 3) x.title = reply ? "Name the reply, e.g. Warranty claim steps" : "Give the article a title"
    if (f.body.trim().length < 3) x.body = "Write the text"
    setErrors(x)
    if (Object.keys(x).length) return
    setBusy(true)
    try {
      const body = { title: f.title.trim(), body: f.body.trim(), category: f.category || null, tags: f.tags, kind: f.kind, published: f.published, ...(article ? { version: article.version } : {}) }
      if (article) await api.patch(`/support/articles/${article.id}`, body)
      else await api.post("/support/articles", body)
      toast.success(reply ? "Saved reply saved" : "Article saved")
      onSaved()
    } catch (err) {
      fail(err)
      setBusy(false)
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader><DialogTitle>{article ? `Edit ${article.title}` : reply ? "New saved reply" : "New article"}</DialogTitle><DialogDescription>{reply ? "A ready answer your team puts into a reply in one click. Use {name} for the customer's name." : "A help page: how to use a product, warranty terms, return policy. Published ones show on your request form."}</DialogDescription></DialogHeader>
        <form onSubmit={save} className="grid gap-4" noValidate>
          <FormSection title="Content" className="sm:grid-cols-1">
            <Field label={reply ? "Name" : "Title"} required error={errors.title}><Input value={f.title} maxLength={160} autoFocus onChange={(e) => set("title", e.target.value)} /></Field>
            <Field label="Text" required error={errors.body} count={[f.body.length, 20000]}><Textarea rows={reply ? 6 : 10} maxLength={20000} value={f.body} onChange={(e) => set("body", e.target.value)} placeholder={reply ? "Hello {name}, sorry for the trouble. Our technician will visit…" : ""} /></Field>
          </FormSection>
          <FormSection title="Filing">
            <Field label="Category"><NativeSelect value={f.category} onChange={(e) => set("category", e.target.value)}><option value="">Any</option>{(settings?.categories ?? []).map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</NativeSelect></Field>
            <Field label="Type"><NativeSelect value={f.kind} onChange={(e) => set("kind", e.target.value as "article" | "reply")}><option value="article">Help article</option><option value="reply">Saved reply</option></NativeSelect></Field>
            <Field label="Tags" className="sm:col-span-2"><LabelInput value={f.tags} onChange={(v) => set("tags", v)} /></Field>
            {!reply && <label className="flex items-center justify-between gap-3 rounded-xl border px-3 py-2 text-sm sm:col-span-2"><span><span className="font-medium">Published</span><span className="block text-xs text-muted-foreground">Customers see it on the request form</span></span><Switch checked={f.published} onCheckedChange={(v) => set("published", v)} /></label>}
          </FormSection>
          <FormError message={error} />
          <DialogFooter><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
