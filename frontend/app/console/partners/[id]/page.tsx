"use client"

import * as React from "react"
import { toast } from "sonner"
import { Pause, Pencil, Play, UserRound } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { ConfirmDialog } from "@/components/common"
import { Field, FormError } from "@/components/form"
import { PartnerBillPanel } from "@/components/console/partner-bill"
import { Chip, Facts, Failed, Loading, Page, Panel, Row, ago } from "@/components/console/kit"
import { api, ApiError, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useApi } from "@/lib/use-api"
import { GST_STATES, formatDate } from "@/lib/format"
import type { PartnerDetail } from "@/lib/console"

// One partner: contact, discount, status, their people and this month's bill.

function EditPartner({ partner, onClose, onSaved }: { partner: PartnerDetail; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = React.useState({ name: partner.name, contactName: partner.contactName, email: partner.email, mobile: partner.mobile.replace(/^\+91/, ""), discountPercent: String(partner.discountPercent) })
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [busy, setBusy] = React.useState(false)
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value })
  async function save(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setErrors({})
    try {
      await api.patch(`/console/partners/${partner.id}`, { ...form, discountPercent: Number(form.discountPercent) })
      toast.success("Saved")
      onSaved()
      onClose()
    } catch (err) {
      setErrors(err instanceof ApiError ? { ...err.fields, form: errorMessage(err) } : { form: errorMessage(err) })
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form onSubmit={save} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Edit {partner.name}</DialogTitle>
            <DialogDescription>A new discount applies from this month&apos;s bill.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Partner name" error={errors.name} className="sm:col-span-2">
              <Input value={form.name} onChange={set("name")} required />
            </Field>
            <Field label="Contact person" error={errors.contactName}>
              <Input value={form.contactName} onChange={set("contactName")} required />
            </Field>
            <Field label="Mobile" error={errors.mobile}>
              <Input value={form.mobile} onChange={set("mobile")} inputMode="tel" required />
            </Field>
            <Field label="Email" error={errors.email}>
              <Input type="email" value={form.email} onChange={set("email")} required />
            </Field>
            <Field label="Discount on list price (%)" error={errors.discountPercent}>
              <Input type="number" min={0} max={90} value={form.discountPercent} onChange={set("discountPercent")} required />
            </Field>
          </div>
          <FormError message={errors.form} />
          <DialogFooter>
            <Button type="submit" disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export default function PartnerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = React.use(params)
  const { canConsole } = useAuth()
  const { data: p, error, reload } = useApi<PartnerDetail>(`/console/partners/${id}`)
  const [editing, setEditing] = React.useState(false)
  const [toggling, setToggling] = React.useState(false)
  const canEdit = canConsole("platform.partner.edit")

  if (error) return <Failed error={error} onRetry={reload} />
  if (!p) return <Loading rows={6} className="mx-auto max-w-6xl" />
  const paused = p.status === "paused"

  return (
    <Page
      back={{ href: "/console/partners", label: "Partners" }}
      title={
        <span className="flex flex-wrap items-center gap-3">
          {p.name} {paused ? <Chip tone="amber">Paused</Chip> : <Chip tone="green">Active</Chip>}
        </span>
      }
      subtitle={`Partner since ${formatDate(p.createdAt)} · ${p.discountPercent}% off list price`}
      actions={
        canEdit && (
          <>
            <Button variant="outline" onClick={() => setToggling(true)}>
              {paused ? <Play /> : <Pause />} {paused ? "Resume" : "Pause"}
            </Button>
            <Button onClick={() => setEditing(true)}>
              <Pencil /> Edit
            </Button>
          </>
        )
      }
    >
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <PartnerBillPanel bill={p.bill} linkClients />
        </div>
        <div className="grid content-start gap-6">
          <Panel title="Contact">
            <Facts
              className="sm:grid-cols-1"
              items={[
                { label: "Person", value: p.contactName },
                { label: "Email", value: p.email },
                { label: "Mobile", value: p.mobile },
                { label: "GSTIN", value: p.gstin },
                { label: "State", value: GST_STATES.find(([c]) => c === p.stateCode)?.[1] ?? null },
              ]}
            />
          </Panel>
          <Panel title="People" description="They manage their own team from their panel" padded={false}>
            <div className="divide-y px-3 pb-3">
              {p.people.map((m) => (
                <Row key={m.id} icon={UserRound} tone="grey" title={m.user.name} detail={`${m.role.name} · ${m.status !== "active" ? "turned off" : m.user.lastLoginAt ? `signed in ${ago(m.user.lastLoginAt)}` : "not signed in yet"}`} />
              ))}
            </div>
          </Panel>
        </div>
      </div>

      {editing && <EditPartner partner={p} onClose={() => setEditing(false)} onSaved={reload} />}
      <ConfirmDialog
        open={toggling}
        onOpenChange={setToggling}
        title={paused ? `Resume ${p.name}?` : `Pause ${p.name}?`}
        description={paused ? "They can add new clients again." : "They can't add new clients. Their existing clients keep working and stay on the bill."}
        confirmLabel={paused ? "Resume" : "Pause"}
        destructive={!paused}
        onConfirm={async () => {
          try {
            await api.patch(`/console/partners/${p.id}`, { status: paused ? "active" : "paused" })
            toast.success(paused ? "Resumed" : "Paused")
            reload()
          } catch (e) {
            toast.error(errorMessage(e))
          }
        }}
      />
    </Page>
  )
}
