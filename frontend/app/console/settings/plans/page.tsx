"use client"

import * as React from "react"
import { toast } from "sonner"
import { Blocks, Building2, CircleStop, Copy, Pencil, Plus } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Field, FormError, NativeSelect } from "@/components/form"
import { api, ApiError, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useApi } from "@/lib/use-api"
import { formatDate, formatPaise } from "@/lib/format"
import { paiseToRupees, rupeesToPaise } from "@/lib/money"
import type { Catalog } from "@/lib/console"
import { ConfirmDialog } from "@/components/common"
import { Chip, Failed, Loading, Page } from "@/components/console/kit"
import { Count, DataTable, IdCell, type Column, type RowAction } from "@/components/console/data-table"
import { useClientTable } from "@/lib/use-table"


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

type PlanRow = Catalog["plans"][number] & { id: string; monthly: number | null; yearly: number | null }
type PriceRow = Catalog["prices"][number] & { item: string }
type CouponRow = Catalog["coupons"][number] & { id: string }

export default function PlansPage() {
  const { canConsole } = useAuth()
  const { data, error, reload } = useApi<Catalog>("/console/catalog")
  const [couponOpen, setCouponOpen] = React.useState(false)
  const canEdit = canConsole("platform.plan.edit")
  const [ending, setEnding] = React.useState<string | null>(null)

  const moduleName = (key: string) => data?.modules.find((m) => m.key === key)?.name ?? key
  const priceOf = (key: string, cycle: "monthly" | "yearly") => data?.prices.find((p) => p.itemType === "plan" && p.itemRef === key && p.cycle === cycle)?.amountPaise ?? null
  const itemName = (p: Catalog["prices"][number]) =>
    p.itemType === "plan" ? data?.plans.find((x) => x.key === p.itemRef)?.name ?? p.itemRef : p.itemType === "extra_user" ? "Extra user" : `${moduleName(p.itemRef)} add-on`
  // Console v3: plans for sale, plus old plans only while clients are still on them; no module add-ons
  const plans: PlanRow[] | null = data
    ? data.plans.filter((p) => p.isPublic || p.subscribers > 0).sort((a, b) => Number(b.isPublic) - Number(a.isPublic)).map((p) => ({ ...p, id: p.key, monthly: priceOf(p.key, "monthly"), yearly: priceOf(p.key, "yearly") }))
    : null
  const forSale = new Set(data?.plans.filter((p) => p.isPublic).map((p) => p.key))
  const prices: PriceRow[] | null = data ? data.prices.filter((p) => p.itemType === "extra_user" || (p.itemType === "plan" && forSale.has(p.itemRef))).map((p) => ({ ...p, item: itemName(p) })) : null
  const coupons: CouponRow[] | null = data ? data.coupons.map((c) => ({ ...c, id: c.code })) : null

  const planTable = useClientTable(plans, { name: (p) => p.name, monthly: (p) => p.monthly ?? 0, yearly: (p) => p.yearly ?? 0, users: (p) => p.limits.users ?? 0, subscribers: (p) => p.subscribers })
  const priceTable = useClientTable(prices, { item: (p) => p.item, cycle: (p) => p.cycle, since: (p) => p.activeFrom, amount: (p) => p.amountPaise })
  const couponTable = useClientTable(coupons, { code: (c) => c.code, used: (c) => c.redeemed, until: (c) => c.validTo ?? "9999", status: (c) => (c.active ? 1 : 0) })

  if (error) return <Failed error={error} onRetry={reload} />
  if (!data) return <Loading rows={6} className="mx-auto max-w-6xl" />

  const modulesOf = (p: PlanRow) => (p.key === "free" ? data.modules.filter((m) => m.freeTier).map((m) => m.key) : p.fullModules)
  const planColumns: Column<PlanRow>[] = [
    { key: "key", header: "Plan key", cell: (p) => <span className="font-mono text-[12.5px] text-muted-foreground">{p.key}</span> },
    { key: "name", header: "Plan", always: true, sortable: true, cell: (p) => <div><div className="font-medium">{p.name}</div>{p.tagline && <div className="max-w-64 truncate text-[12.5px] text-muted-foreground">{p.tagline}</div>}</div> },
    { key: "status", header: "Status", cell: (p) => (p.isPublic ? <Chip tone="green">For sale</Chip> : <Chip tone="grey">Old · not sold</Chip>) },
    { key: "monthly", header: "Monthly", align: "right", sortable: true, cell: (p) => (p.monthly === null ? "—" : formatPaise(p.monthly)) },
    { key: "yearly", header: "Yearly", align: "right", sortable: true, cell: (p) => (p.yearly === null ? "—" : formatPaise(p.yearly)) },
    { key: "users", header: "Users", align: "right", sortable: true, cell: (p) => p.limits.users ?? "No limit" },
    { key: "branches", header: "Branches", align: "right", cell: (p) => p.limits.branches ?? "No limit" },
    { key: "invoices", header: "Invoices / month", align: "right", cell: (p) => p.limits.invoicesPerMonth ?? "No limit" },
    { key: "storage", header: "Storage", align: "right", hidden: true, cell: (p) => (p.limits.storageMb ? `${p.limits.storageMb} MB` : "—") },
    {
      key: "modules", header: "Modules",
      cell: (p) => {
        const keys = modulesOf(p)
        return <span className="inline-flex items-center gap-1" title={keys.map(moduleName).join(", ")}>{keys.slice(0, 3).map((k) => <Badge key={k} variant="secondary" className="h-5 px-1.5 text-[10px]">{moduleName(k)}</Badge>)}{keys.length > 3 && <span className="text-xs text-muted-foreground">+{keys.length - 3}</span>}</span>
      },
    },
    { key: "subscribers", header: "Businesses", align: "right", sortable: true, cell: (p) => p.subscribers },
  ]
  const planActions = (p: PlanRow): RowAction[] => [
    { label: "Edit plan", icon: Pencil, href: `/console/settings/plans/${p.key}`, hidden: !canEdit },
    { label: "Businesses on this plan", icon: Building2, href: `/console/clients?planKey=${p.key}`, hidden: !p.subscribers },
    { label: "Compare modules", icon: Blocks, href: "/console/modules" },
  ]
  const priceColumns: Column<PriceRow>[] = [
    { key: "id", header: "Price ID", hidden: true, cell: (p) => <IdCell id={p.id} /> },
    { key: "item", header: "Item", always: true, sortable: true, cell: (p) => <span className="font-medium">{p.item}</span> },
    { key: "cycle", header: "Cycle", sortable: true, cell: (p) => <span className="capitalize">{p.cycle}</span> },
    { key: "since", header: "Since", sortable: true, cell: (p) => <span className="text-muted-foreground">{formatDate(p.activeFrom)}</span> },
    { key: "amount", header: "Price (₹, before GST)", align: "right", sortable: true, cell: (p) => <PriceCell key={`${p.id}-${p.amountPaise}`} price={p} label={p.item} editable={canEdit && p.itemType === "extra_user"} onSaved={reload} /> },
  ]
  const couponColumns: Column<CouponRow>[] = [
    { key: "code", header: "Code", always: true, sortable: true, cell: (c) => <span className="font-mono text-[13px] font-medium">{c.code}</span> },
    { key: "discount", header: "Discount", cell: (c) => (c.type === "percent" ? `${c.value}%` : formatPaise(c.value)) },
    { key: "applies", header: "Applies to", cell: (c) => <span className="capitalize">{c.appliesTo.replace(/_/g, " ")}</span> },
    { key: "used", header: "Used", align: "right", sortable: true, cell: (c) => `${c.redeemed}${c.maxRedemptions ? ` / ${c.maxRedemptions}` : ""}` },
    { key: "from", header: "Valid from", hidden: true, cell: (c) => (c.validFrom ? formatDate(c.validFrom) : "—") },
    { key: "until", header: "Valid until", sortable: true, cell: (c) => <span className="text-muted-foreground">{c.validTo ? formatDate(c.validTo) : "No end"}</span> },
    { key: "status", header: "Status", sortable: true, cell: (c) => (c.active ? <Chip tone="green">Active</Chip> : <Chip tone="grey">Ended</Chip>) },
  ]
  const couponActions = (c: CouponRow): RowAction[] => [
    { label: "Copy code", icon: Copy, onClick: () => navigator.clipboard.writeText(c.code).then(() => toast.success("Code copied")) },
    { label: "End now", icon: CircleStop, danger: true, separator: true, onClick: () => setEnding(c.code), hidden: !canEdit || !c.active },
  ]

  return (
    <Page wide eyebrow="Product" title="Plans & pricing" subtitle="Free and three plans, each a fixed set of modules and users. The only extra is users. Prices are before GST.">
      <DataTable id="plans" label="Plans" table={planTable} columns={planColumns} actions={planActions} searchFields={[{ key: "name", label: "Plan" }]} summary={<Count tone="green" n={plans?.filter((p) => p.isPublic).length ?? 0} label="For sale" />} />

      <div className="grid gap-6 xl:grid-cols-2">
        <div className="grid content-start gap-2">
          <h2 className="text-base font-semibold">Prices</h2>
          <p className="-mt-1 text-sm text-muted-foreground">Changing a price starts a new version; businesses already subscribed keep the old one until renewal. Plan prices change in the plan editor.</p>
          <DataTable id="prices" label="Prices" table={priceTable} columns={priceColumns} searchFields={[{ key: "item", label: "Item" }]} />
        </div>
        <div className="grid content-start gap-2">
          <div className="flex items-end justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold">Coupons</h2>
              <p className="text-sm text-muted-foreground">For campaigns: first payment only, never with a manual discount.</p>
            </div>
            {canEdit && <Button size="sm" onClick={() => setCouponOpen(true)}><Plus /> New coupon</Button>}
          </div>
          <DataTable id="coupons" label="Coupons" table={couponTable} columns={couponColumns} actions={couponActions} searchFields={[{ key: "code", label: "Code" }]} empty="No coupons yet." />
        </div>
      </div>

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
