"use client"

import * as React from "react"
import { toast } from "sonner"
import { Pencil, Plus } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Field, FormError, NativeSelect } from "@/components/form"
import { api, ApiError, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useApi } from "@/lib/use-api"
import { formatDate, formatPaise } from "@/lib/format"
import { paiseToRupees, rupeesToPaise } from "@/lib/money"
import type { Catalog } from "@/lib/console"
import type { PlanLimits } from "@/lib/types"
import { ConfirmDialog } from "@/components/common"
import { Failed, Loading, Page } from "@/components/console/kit"

type Plan = Catalog["plans"][number]

const LIMIT_FIELDS: { key: keyof PlanLimits; label: string; nullable: boolean }[] = [
  { key: "users", label: "Users", nullable: false },
  { key: "branches", label: "Branches", nullable: false },
  { key: "contacts", label: "Contacts", nullable: true },
  { key: "items", label: "Items", nullable: true },
  { key: "invoicesPerMonth", label: "Invoices / month", nullable: true },
  { key: "storageMb", label: "Storage (MB)", nullable: false },
  { key: "aiCredits", label: "AI credits", nullable: false },
]

function PlanDialog({ plan, modules, onClose, onSaved }: { plan: Plan; modules: Catalog["modules"]; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = React.useState(plan.name)
  const [tagline, setTagline] = React.useState(plan.tagline ?? "")
  const [isPublic, setIsPublic] = React.useState(plan.isPublic)
  const [limits, setLimits] = React.useState<Record<string, string>>(Object.fromEntries(LIMIT_FIELDS.map((f) => [f.key, plan.limits[f.key] === null ? "" : String(plan.limits[f.key])])))
  const [mods, setMods] = React.useState(new Set(plan.fullModules))
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const parsed = Object.fromEntries(LIMIT_FIELDS.map((f) => [f.key, limits[f.key] === "" && f.nullable ? null : Number(limits[f.key])])) as unknown as PlanLimits
    setBusy(true)
    try {
      const r = await api.patch<{ recomputed: number }>(`/console/plans/${plan.key}`, {
        name,
        tagline: tagline || null,
        isPublic,
        limits: parsed,
        ...(plan.key === "free" ? {} : { fullModules: [...mods] }),
      })
      toast.success(r.recomputed ? `Plan saved — ${r.recomputed} client(s) updated` : "Plan saved")
      onSaved()
      onClose()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-xl">
        <form onSubmit={save} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Edit {plan.name}</DialogTitle>
            <DialogDescription>
              {plan.subscribers} client(s) on this plan. Limits apply immediately; changing modules re-computes their access.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name">
              <Input value={name} onChange={(e) => setName(e.target.value)} required />
            </Field>
            <Field label="Tagline">
              <Input value={tagline} onChange={(e) => setTagline(e.target.value)} />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={isPublic} onCheckedChange={(v) => setIsPublic(!!v)} /> Shown on the public plans page
          </label>
          <div>
            <p className="mb-2 text-sm font-medium">Limits</p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {LIMIT_FIELDS.map((f) => (
                <Field key={f.key} label={f.label} hint={f.nullable ? "Empty = unlimited" : undefined}>
                  <Input type="number" min={0} value={limits[f.key]} onChange={(e) => setLimits({ ...limits, [f.key]: e.target.value })} required={!f.nullable} />
                </Field>
              ))}
            </div>
          </div>
          {plan.key !== "free" && (
            <div>
              <p className="mb-2 text-sm font-medium">Modules at full tier</p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {modules.map((m) => (
                  <label key={m.key} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={mods.has(m.key)}
                      onCheckedChange={(v) => {
                        const next = new Set(mods)
                        if (v) next.add(m.key)
                        else next.delete(m.key)
                        setMods(next)
                      }}
                    />
                    {m.name}
                  </label>
                ))}
              </div>
            </div>
          )}
          <FormError message={error} />
          <DialogFooter>
            <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Review changes"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function PriceCell({ price, label, editable, onSaved }: { price: Catalog["prices"][number]; label: string; editable: boolean; onSaved: () => void }) {
  const [value, setValue] = React.useState(paiseToRupees(price.amountPaise))
  const [busy, setBusy] = React.useState(false)
  const [editing, setEditing] = React.useState(false)
  // View-first: the price reads as text until Edit is pressed
  if (!editable || !editing)
    return (
      <span className="flex items-center justify-end gap-1">
        <span className="tabular-nums">{formatPaise(price.amountPaise)}</span>
        {editable && (
          <Button size="icon" variant="ghost" className="size-7" onClick={() => setEditing(true)} aria-label={`Edit ${label} ${price.cycle} price`}>
            <Pencil className="size-3.5" />
          </Button>
        )}
      </span>
    )
  const changed = rupeesToPaise(value) !== price.amountPaise
  return (
    <form
      className="flex items-center justify-end gap-2"
      onSubmit={async (e) => {
        e.preventDefault()
        const amountPaise = rupeesToPaise(value)
        if (amountPaise === null) return toast.error("Enter an amount in rupees")
        setBusy(true)
        try {
          await api.put("/console/prices", { itemType: price.itemType, itemRef: price.itemRef, cycle: price.cycle, amountPaise })
          toast.success("Price updated — existing subscriptions keep their old price")
          onSaved()
        } catch (err) {
          toast.error(errorMessage(err))
        } finally {
          setBusy(false)
        }
      }}
    >
      <Input className="h-8 w-28 text-right tabular-nums" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} aria-label="Price in rupees" autoFocus />
      <Button size="sm" type="submit" disabled={busy || !changed}>Save</Button>
      <Button
        size="sm"
        type="button"
        variant="ghost"
        onClick={() => {
          setValue(paiseToRupees(price.amountPaise))
          setEditing(false)
        }}
      >
        Cancel
      </Button>
    </form>
  )
}

function CouponDialog({ open, onOpenChange, onSaved }: { open: boolean; onOpenChange: (o: boolean) => void; onSaved: () => void }) {
  const [form, setForm] = React.useState({ code: "", type: "percent", value: "10", validTo: "", maxRedemptions: "" })
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [busy, setBusy] = React.useState(false)
  async function save(e: React.FormEvent) {
    e.preventDefault()
    setErrors({})
    setBusy(true)
    try {
      await api.post("/console/coupons", {
        code: form.code,
        type: form.type,
        value: form.type === "percent" ? Number(form.value) : rupeesToPaise(form.value),
        appliesTo: "all",
        validTo: form.validTo ? new Date(`${form.validTo}T23:59:59+05:30`).toISOString() : null,
        maxRedemptions: form.maxRedemptions ? Number(form.maxRedemptions) : null,
      })
      toast.success("Coupon created")
      onOpenChange(false)
      setForm({ code: "", type: "percent", value: "10", validTo: "", maxRedemptions: "" })
      onSaved()
    } catch (err) {
      setErrors(err instanceof ApiError ? { ...err.fields, form: errorMessage(err) } : { form: errorMessage(err) })
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={save} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>New coupon</DialogTitle>
            <DialogDescription>Coupons apply at checkout (payments arrive in the next step).</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Code" error={errors.code}>
              <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="DIWALI25" required />
            </Field>
            <Field label="Type">
              <NativeSelect value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                <option value="percent">Percent off</option>
                <option value="flat">Flat ₹ off</option>
              </NativeSelect>
            </Field>
            <Field label={form.type === "percent" ? "Percent" : "Amount (₹)"} error={errors.value}>
              <Input inputMode="decimal" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} required />
            </Field>
            <Field label="Valid until" hint="Empty = no end date" error={errors.validTo}>
              <Input type="date" value={form.validTo} onChange={(e) => setForm({ ...form, validTo: e.target.value })} />
            </Field>
            <Field label="Max uses" hint="Empty = unlimited" error={errors.maxRedemptions}>
              <Input type="number" min={1} value={form.maxRedemptions} onChange={(e) => setForm({ ...form, maxRedemptions: e.target.value })} />
            </Field>
          </div>
          <FormError message={errors.form} />
          <DialogFooter>
            <Button type="submit" disabled={busy}>{busy ? "Creating…" : "Create coupon"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export default function PlansPage() {
  const { canConsole } = useAuth()
  const { data, error, reload } = useApi<Catalog>("/console/catalog")
  const [editing, setEditing] = React.useState<Plan | null>(null)
  const [couponOpen, setCouponOpen] = React.useState(false)
  const canEdit = canConsole("platform.plan.edit")
  const [ending, setEnding] = React.useState<string | null>(null)

  if (error) return <Failed error={error} onRetry={reload} />
  if (!data) return <Loading rows={6} className="mx-auto max-w-6xl" />
  const moduleName = (key: string) => data.modules.find((m) => m.key === key)?.name ?? key
  const itemName = (p: Catalog["prices"][number]) =>
    p.itemType === "plan" ? data.plans.find((x) => x.key === p.itemRef)?.name ?? p.itemRef : p.itemType === "extra_user" ? "Extra user" : `${moduleName(p.itemRef)} add-on`

  return (
    <Page title="Plans & prices" subtitle="Prices are before GST. A new price applies to new orders and renewals; clients keep what they already paid for." back={{ href: "/console/settings", label: "Settings" }}>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {data.plans.map((p) => (
          <Card key={p.key}>
            <CardHeader>
              <CardTitle className="flex items-center justify-between gap-2">
                <span>
                  {p.name} {!p.isPublic && <Badge variant="outline" className="ml-1 h-5 px-1.5 text-[10px]">hidden</Badge>}
                </span>
                {canEdit && (
                  <Button size="icon" variant="ghost" onClick={() => setEditing(p)} aria-label={`Edit ${p.name}`}>
                    <Pencil className="size-4" />
                  </Button>
                )}
              </CardTitle>
              <CardDescription>{p.tagline}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2 text-sm">
              <p className="text-muted-foreground">
                {p.subscribers} client(s) · {p.limits.users} users · {p.limits.branches} branch{p.limits.branches === 1 ? "" : "es"} ·{" "}
                {p.limits.invoicesPerMonth === null ? "unlimited invoices" : `${p.limits.invoicesPerMonth} invoices/month`}
              </p>
              <div className="flex flex-wrap gap-1">
                {(p.key === "free" ? data.modules.filter((m) => m.freeTier).map((m) => m.key) : p.fullModules).map((k) => (
                  <Badge key={k} variant="secondary" className="h-5 px-1.5 text-[10px]">{moduleName(k)}</Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Prices</CardTitle>
          <CardDescription>Changing a price starts a new version; clients already subscribed keep the old one until renewal.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">Item</TableHead>
                <TableHead>Cycle</TableHead>
                <TableHead>Since</TableHead>
                <TableHead className="pr-6 text-right">Price (₹)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.prices.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="pl-6">{itemName(p)}</TableCell>
                  <TableCell className="capitalize">{p.cycle}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{formatDate(p.activeFrom)}</TableCell>
                  <TableCell className="pr-6 text-right">
                    <PriceCell key={`${p.id}-${p.amountPaise}`} price={p} label={itemName(p)} editable={canEdit} onSaved={reload} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-2">
            Coupons
            {canEdit && (
              <Button size="sm" onClick={() => setCouponOpen(true)}>
                <Plus /> New coupon
              </Button>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          {!data.coupons.length ? (
            <p className="px-6 pb-6 text-sm text-muted-foreground">No coupons yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-6">Code</TableHead>
                  <TableHead>Discount</TableHead>
                  <TableHead>Used</TableHead>
                  <TableHead>Valid until</TableHead>
                  <TableHead className="pr-6 text-right">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.coupons.map((c) => (
                  <TableRow key={c.code}>
                    <TableCell className="pl-6 font-mono text-sm">{c.code}</TableCell>
                    <TableCell>{c.type === "percent" ? `${c.value}%` : formatPaise(c.value)}</TableCell>
                    <TableCell className="tabular-nums">{c.redeemed}{c.maxRedemptions ? ` / ${c.maxRedemptions}` : ""}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{c.validTo ? formatDate(c.validTo) : "No end"}</TableCell>
                    <TableCell className="pr-6 text-right">
                      {c.active ? (
                        canEdit ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setEnding(c.code)}
                          >
                            End now
                          </Button>
                        ) : (
                          <Badge variant="secondary">Active</Badge>
                        )
                      ) : (
                        <Badge variant="outline">Ended</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {editing && <PlanDialog plan={editing} modules={data.modules} onClose={() => setEditing(null)} onSaved={reload} />}
      <CouponDialog open={couponOpen} onOpenChange={setCouponOpen} onSaved={reload} />
      <ConfirmDialog
        open={!!ending}
        onOpenChange={(o) => !o && setEnding(null)}
        title={`End coupon ${ending}?`}
        description="It stops working at checkout now. Orders already placed keep their discount."
        confirmLabel="End coupon"
        destructive
        onConfirm={async () => {
          try {
            await api.post(`/console/coupons/${ending}/end`)
            toast.success("Coupon ended")
            reload()
          } catch (e) {
            toast.error(errorMessage(e))
          }
        }}
      />
    </Page>
  )
}
