"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Handshake, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Field, FormError, NativeSelect } from "@/components/form"
import { Chip, Empty, Failed, Loading, Page, Panel } from "@/components/console/kit"
import { api, ApiError, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useApi } from "@/lib/use-api"
import { GST_STATES, formatNumber } from "@/lib/format"
import type { PartnerRow } from "@/lib/console"

// Partners: resellers who bring and look after their own clients. AHEAD bills each partner
// monthly for its live clients at the list price minus the partner's discount.

function AddPartnerDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter()
  const [form, setForm] = React.useState({ name: "", contactName: "", email: "", mobile: "", gstin: "", stateCode: "", discountPercent: "20" })
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [busy, setBusy] = React.useState(false)
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value })
  async function save(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setErrors({})
    try {
      const r = await api.post<{ id: string }>("/console/partners", { ...form, gstin: form.gstin || null, stateCode: form.stateCode || null, discountPercent: Number(form.discountPercent) || 0 })
      toast.success(`${form.name} added — ${form.contactName} can sign in with their mobile`)
      router.push(`/console/partners/${r.id}`)
    } catch (err) {
      setErrors(err instanceof ApiError ? { ...err.fields, form: errorMessage(err) } : { form: errorMessage(err) })
      setBusy(false)
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <form onSubmit={save} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Add a partner</DialogTitle>
            <DialogDescription>The contact person becomes the partner&apos;s admin and gets their own panel to add clients.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Partner name" required error={errors.name} className="sm:col-span-2">
              <Input value={form.name} onChange={set("name")} placeholder="e.g. Acme Software Solutions" required autoFocus />
            </Field>
            <Field label="Contact person" required error={errors.contactName}>
              <Input value={form.contactName} onChange={set("contactName")} required />
            </Field>
            <Field label="Mobile" required error={errors.mobile}>
              <Input value={form.mobile} onChange={set("mobile")} inputMode="tel" placeholder="98765 43210" required />
            </Field>
            <Field label="Email" required error={errors.email}>
              <Input type="email" value={form.email} onChange={set("email")} required />
            </Field>
            <Field label="Discount on list price (%)" required hint="What they pay AHEAD is the list price minus this" error={errors.discountPercent}>
              <Input type="number" min={0} max={90} value={form.discountPercent} onChange={set("discountPercent")} required />
            </Field>
            <Field label="State" hint="For GST on their bill" error={errors.stateCode}>
              <NativeSelect value={form.stateCode} onChange={set("stateCode")}>
                <option value="">Choose…</option>
                {GST_STATES.map(([code, name]) => (
                  <option key={code} value={code}>
                    {name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="GSTIN" hint="Optional" error={errors.gstin}>
              <Input value={form.gstin} onChange={(e) => setForm({ ...form, gstin: e.target.value.toUpperCase() })} maxLength={15} />
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
  const canAdd = canConsole("platform.partner.create")

  return (
    <Page
      title="Partners"
      subtitle="Resellers who bring and look after their own clients. They're billed monthly at the list price minus their discount."
      actions={
        canAdd && (
          <Button onClick={() => setOpen(true)}>
            <Plus /> Add partner
          </Button>
        )
      }
    >
      <Panel padded={false}>
        {error ? (
          <div className="p-5">
            <Failed error={error} onRetry={reload} />
          </div>
        ) : !data ? (
          <Loading rows={4} className="p-5" />
        ) : !data.data.length ? (
          <Empty
            icon={Handshake}
            title="No partners yet"
            text="A partner gets their own panel to add clients. You bill them once a month."
            action={
              canAdd && (
                <Button size="sm" onClick={() => setOpen(true)}>
                  <Plus /> Add partner
                </Button>
              )
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="px-5 py-3 font-medium">Partner</th>
                  <th className="px-3 py-3 font-medium">Live clients</th>
                  <th className="px-3 py-3 font-medium">Discount</th>
                  <th className="px-3 py-3 font-medium">People</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {data.data.map((p) => (
                  <tr key={p.id} onClick={() => router.push(`/console/partners/${p.id}`)} className="cursor-pointer border-b last:border-0 hover:bg-muted/50">
                    <td className="px-5 py-3.5">
                      <div className="font-medium">{p.name}</div>
                      <div className="text-[13px] text-muted-foreground">
                        {p.contactName} · {p.email}
                      </div>
                    </td>
                    <td className="px-3 py-3.5 tabular-nums">
                      {formatNumber(p.liveClients)}
                      <span className="text-muted-foreground"> of {formatNumber(p.clients)}</span>
                    </td>
                    <td className="px-3 py-3.5 tabular-nums">{p.discountPercent}%</td>
                    <td className="px-3 py-3.5 tabular-nums">{p.people}</td>
                    <td className="px-5 py-3.5">{p.status === "active" ? <Chip tone="green">Active</Chip> : <Chip tone="amber">Paused</Chip>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      {open && <AddPartnerDialog open onOpenChange={setOpen} />}
    </Page>
  )
}
