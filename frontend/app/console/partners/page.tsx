"use client"

import { email as emailRule, gstin as gstinRule, gstinStateMismatch, length, mobileIN, personName } from "@contracts/validation"
import { StateSelect } from "@/components/search-select"
import * as React from "react"
import { useRouter } from "next/navigation"
import { Copy, ExternalLink, Handshake, Plus, ReceiptText } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Field, FormError } from "@/components/form"
import { Chip, Failed, Page } from "@/components/console/kit"
import { Count, DataTable, FilterSelect, IdCell, type Column, type RowAction } from "@/components/console/data-table"
import { useClientTable } from "@/lib/use-table"
import { api, ApiError, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useApi } from "@/lib/use-api"
import { GST_STATES, formatDate, formatNumber } from "@/lib/format"
import type { PartnerRow } from "@/lib/console"
import { LoginLinkBox, type LoginLink } from "@/components/console/login-link"

// Partners: resellers who bring and look after their own clients. AHEAD bills each partner
// monthly for its live clients at the list price minus the partner's discount.

function AddPartnerDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter()
  const [form, setForm] = React.useState({ name: "", contactName: "", email: "", mobile: "", gstin: "", stateCode: "", discountPercent: "20" })
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [busy, setBusy] = React.useState(false)
  const [added, setAdded] = React.useState<{ id: string; loginLink: LoginLink } | null>(null)
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value })
  async function save(e: React.FormEvent) {
    e.preventDefault()
    const bad = Object.fromEntries(
      Object.entries({
        name: !form.name.trim() ? "Enter the partner name" : length(2, 100, "Partner name")(form.name),
        contactName: !form.contactName.trim() ? "Enter the contact person" : personName(form.contactName),
        email: !form.email.trim() ? "Enter the email" : emailRule(form.email),
        mobile: !form.mobile ? "Enter the mobile number" : mobileIN(form.mobile),
        gstin: form.gstin ? gstinRule(form.gstin) ?? gstinStateMismatch(form.gstin, form.stateCode) : null,
      }).filter(([, v]) => v)
    ) as Record<string, string>
    setErrors(bad)
    if (Object.keys(bad).length) return
    setBusy(true)
    try {
      const r = await api.post<{ id: string; loginLink: LoginLink }>("/console/partners", { ...form, gstin: form.gstin || null, stateCode: form.stateCode || null, discountPercent: Number(form.discountPercent) || 0 })
      setAdded(r)
      setBusy(false)
    } catch (err) {
      setErrors(err instanceof ApiError ? { ...err.fields, form: errorMessage(err) } : { form: errorMessage(err) })
      setBusy(false)
    }
  }
  if (added)
    return (
      <Dialog open={open} onOpenChange={(o) => !o && router.push(`/console/partners/${added.id}`)}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{form.name} is a partner</DialogTitle>
            <DialogDescription>We sent {form.contactName} a login link to the partner portal by SMS and email. They set their own password there.</DialogDescription>
          </DialogHeader>
          <LoginLinkBox link={added.loginLink} mobile={form.mobile} message={`Hi ${form.contactName}, set up your AHEAD partner portal login here:`} />
          <DialogFooter>
            <Button type="button" onClick={() => router.push(`/console/partners/${added.id}`)}>Open partner</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <form onSubmit={save} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Add a partner</DialogTitle>
            <DialogDescription>The contact person becomes the partner owner and gets a login link to their own partner portal.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Partner name" required error={errors.name} className="sm:col-span-2">
              <Input value={form.name} onChange={set("name")} placeholder="e.g. Acme Software Solutions" autoFocus />
            </Field>
            <Field label="Contact person" required error={errors.contactName}>
              <Input mask="name" value={form.contactName} onChange={set("contactName")} />
            </Field>
            <Field label="Mobile" required error={errors.mobile}>
              <Input mask="mobile" value={form.mobile} onChange={set("mobile")} placeholder="98765 43210" />
            </Field>
            <Field label="Email" required error={errors.email}>
              <Input type="email" value={form.email} onChange={set("email")} required />
            </Field>
            <Field label="Discount on list price (%)" required hint="What they pay AHEAD is the list price minus this" error={errors.discountPercent}>
              <Input type="number" min={0} max={90} value={form.discountPercent} onChange={set("discountPercent")} required />
            </Field>
            <Field label="State" hint="For GST on their bill" error={errors.stateCode}>
              <StateSelect value={form.stateCode} onChange={(v) => setForm({ ...form, stateCode: v })} />
            </Field>
            <Field label="GSTIN" hint="Optional" error={errors.gstin}>
              <Input mask="gstin" value={form.gstin} onChange={(e) => setForm({ ...form, gstin: e.target.value })} />
            </Field>
          </div>
          <FormError message={errors.form} />
          <DialogFooter>
            <Button type="submit" disabled={busy}>
              {busy ? "Adding…" : "Add partner"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export default function PartnersPage() {
  const router = useRouter()
  const { canConsole } = useAuth()
  const { data, error, reload } = useApi<{ data: PartnerRow[] }>("/console/partners")
  const [open, setOpen] = React.useState(false)
  const [status, setStatus] = React.useState("")
  const canAdd = canConsole("platform.partner.create")
  const rows = React.useMemo(() => data?.data.filter((p) => !status || p.status === status) ?? null, [data, status])
  const table = useClientTable(rows, {
    name: (p) => p.name, contact: (p) => p.contactName, email: (p) => p.email, mobile: (p) => p.mobile, gstin: (p) => p.gstin ?? "",
    clients: (p) => p.liveClients, discount: (p) => p.discountPercent, people: (p) => p.people, status: (p) => p.status, created: (p) => p.createdAt,
  })
  const state = (code: string | null) => (code ? GST_STATES.find(([c]) => c === code)?.[1] ?? code : "—")
  const columns: Column<PartnerRow>[] = [
    { key: "id", header: "ID", cell: (p) => <IdCell id={p.id} href={`/console/partners/${p.id}`} /> },
    { key: "name", header: "Partner", always: true, sortable: true, cell: (p) => <span className="font-medium">{p.name}</span> },
    { key: "contact", header: "Contact", sortable: true, cell: (p) => p.contactName },
    { key: "mobile", header: "Phone", cell: (p) => <span className="tabular-nums">{p.mobile.replace(/^[+]91/, "+91 ")}</span> },
    { key: "email", header: "Email", sortable: true, cell: (p) => p.email },
    { key: "clients", header: "Live businesses", align: "right", sortable: true, cell: (p) => <span>{formatNumber(p.liveClients)}<span className="text-muted-foreground"> of {formatNumber(p.clients)}</span></span> },
    { key: "discount", header: "Discount", align: "right", sortable: true, cell: (p) => `${p.discountPercent}%` },
    { key: "people", header: "Portal users", align: "right", sortable: true, cell: (p) => p.people },
    { key: "state", header: "State", cell: (p) => state(p.stateCode) },
    { key: "gstin", header: "GSTIN", hidden: true, cell: (p) => <span className="font-mono text-[12.5px]">{p.gstin ?? "—"}</span> },
    { key: "created", header: "Added", sortable: true, cell: (p) => <span className="text-muted-foreground">{formatDate(p.createdAt)}</span> },
    { key: "status", header: "Status", sortable: true, cell: (p) => (p.status === "active" ? <Chip tone="green">Active</Chip> : <Chip tone="amber">Paused</Chip>) },
  ]
  const actions = (p: PartnerRow): RowAction[] => [
    { label: "Open partner", icon: ExternalLink, href: `/console/partners/${p.id}` },
    { label: "Businesses and monthly bill", icon: ReceiptText, href: `/console/partners/${p.id}` },
    { label: "Copy email", icon: Copy, separator: true, onClick: () => navigator.clipboard.writeText(p.email).then(() => toast.success("Email copied")) },
  ]
  const active = data?.data.filter((p) => p.status === "active").length ?? 0

  return (
    <Page
      wide
      eyebrow="Workspace"
      title="Partners"
      subtitle="Resellers who bring and look after their own businesses. They're billed monthly at the list price minus their discount."
      actions={
        canAdd && (
          <Button onClick={() => setOpen(true)}>
            <Plus /> Add partner
          </Button>
        )
      }
    >
      {error ? (
        <Failed error={error} onRetry={reload} />
      ) : (
        <DataTable
          id="partners"
          label="Partners"
          table={table}
          columns={columns}
          actions={actions}
          onRowClick={(p) => router.push(`/console/partners/${p.id}`)}
          searchFields={[{ key: "name", label: "Partner" }, { key: "contact", label: "Contact" }, { key: "email", label: "Email" }, { key: "mobile", label: "Phone" }, { key: "gstin", label: "GSTIN" }]}
          summary={data && <><Count tone="green" n={active} label="Active" /><Count tone="amber" n={data.data.length - active} label="Paused" /></>}
          filters={<FilterSelect value={status} onChange={setStatus} label="Status" options={[["", "Any status"], ["active", "Active"], ["paused", "Paused"]]} />}
          empty={<span className="inline-flex items-center gap-2"><Handshake className="size-4" /> No partners yet. Add one, or approve one from Applications.</span>}
        />
      )}
      {open && <AddPartnerDialog open onOpenChange={setOpen} />}
    </Page>
  )
}
