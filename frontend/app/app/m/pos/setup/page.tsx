"use client"

import * as React from "react"
import Link from "next/link"
import { toast } from "sonner"
import { Loader2, Pencil, Plus, Store } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { PageHeader } from "@/components/app-shell"
import { EmptyState } from "@/components/common"
import { Field, FormError, NativeSelect } from "@/components/form"
import { Pill } from "@/components/page-parts"
import { PageError, PageLoading } from "@/components/page-states"
import { api, ApiError, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { formatDateTime, formatPaise } from "@/lib/format"
import type { Counter } from "@/lib/pos"
import { useApi } from "@/lib/use-api"
import { useChanged } from "@/lib/use-dirty"

// Counters: each billing counter sells from a warehouse, puts cash and UPI/card into chosen
// accounts, prints on its paper, and has its own discount limit and rules.

type Opt = { id: string; name: string }
interface Setup {
  counters: (Counter & { shifts: number; todayPaise: number; openShift: { id: string; number: string; by: string; at: string } | null })[]
  branches: (Opt & { code: string })[]
  locations: (Opt & { isDefault: boolean; isActive: boolean })[]
  accounts: (Opt & { kind: string; isDefault: boolean; isActive: boolean })[]
  financeOn: boolean
}

export default function CountersPage() {
  const { can } = useAuth()
  const setup = useApi<Setup>(can("billing.pos.edit") ? "/pos/setup" : null)
  const [editing, setEditing] = React.useState<Setup["counters"][number] | "new" | null>(null)
  if (!can("billing.pos.edit")) return <PageHeader title="Counters" description="Only people who set up the POS can change counters. Ask your admin." />
  if (setup.error) return <PageError error={setup.error} />
  if (!setup.data) return <PageLoading />
  const d = setup.data
  const name = (list: Opt[], id: string | null, fallback: string) => list.find((x) => x.id === id)?.name ?? fallback
  const add = <Button className="h-10 rounded-xl px-4 font-semibold" onClick={() => setEditing("new")}><Plus /> Add counter</Button>
  return (
    <div className="grid gap-5">
      <PageHeader title="Counters" description="Billing counters: where each one's goods come from, where the money goes, and its receipt and discount rules." actions={add} />
      {!d.counters.length ? <EmptyState icon={Store} title="No counter yet" description="Add your first billing counter to start selling at the POS." action={add} /> : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {d.counters.map((c) => (
            <article key={c.id} className="grid gap-3 rounded-2xl border bg-card p-4">
              <div className="flex items-start gap-3">
                <span className="grid size-11 place-items-center rounded-xl bg-primary/10 text-primary"><Store className="size-5" /></span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{c.name}</span>
                  <span className="text-xs text-muted-foreground">{c.shifts} shift{c.shifts === 1 ? "" : "s"} · today {formatPaise(c.todayPaise)}</span>
                </span>
                {!c.isActive ? <Pill color="slate">Inactive</Pill> : c.openShift ? <Pill color="emerald" dot>Open</Pill> : <Pill color="blue">Ready</Pill>}
              </div>
              {c.openShift && <Link href={`/app/m/pos/shifts/${c.openShift.id}`} className="rounded-xl bg-emerald-50 px-3 py-2 text-xs text-emerald-800 hover:underline dark:bg-emerald-500/10 dark:text-emerald-300">{c.openShift.number} open by {c.openShift.by} since {formatDateTime(c.openShift.at)}</Link>}
              <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm">
                <dt className="text-muted-foreground">Branch</dt><dd className="truncate">{name(d.branches, c.branchId, "Any")}</dd>
                <dt className="text-muted-foreground">Warehouse</dt><dd className="truncate">{name(d.locations, c.locationId, "Default")}</dd>
                <dt className="text-muted-foreground">Cash into</dt><dd className="truncate">{name(d.accounts, c.cashAccountId, "Cash in hand")}</dd>
                <dt className="text-muted-foreground">UPI & card into</dt><dd className="truncate">{name(d.accounts, c.bankAccountId, "Default bank")}</dd>
                <dt className="text-muted-foreground">Receipt</dt><dd>{c.paper === "a4" ? "A4" : `${c.paper} thermal`}</dd>
                <dt className="text-muted-foreground">Discount limit</dt><dd>{c.maxDiscountPct == null ? "No limit" : `${c.maxDiscountPct}%`}</dd>
                <dt className="text-muted-foreground">On account</dt><dd>{c.allowCredit ? "Allowed" : "Full payment only"}</dd>
              </dl>
              <Button variant="outline" size="sm" className="justify-self-start" onClick={() => setEditing(c)}><Pencil /> Edit</Button>
            </article>
          ))}
        </div>
      )}
      {editing && <CounterDialog setup={d} counter={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void setup.reload() }} />}
    </div>
  )
}

function CounterDialog({ setup, counter, onClose, onSaved }: { setup: Setup; counter: Counter | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = React.useState({
    name: counter?.name ?? (setup.counters.length ? `Counter ${setup.counters.length + 1}` : "Counter 1"),
    branchId: counter?.branchId ?? "", locationId: counter?.locationId ?? "", cashAccountId: counter?.cashAccountId ?? "", bankAccountId: counter?.bankAccountId ?? "",
    paper: counter?.paper ?? "80mm", receiptNote: counter?.receiptNote ?? "", maxDiscountPct: counter?.maxDiscountPct == null ? "" : String(counter.maxDiscountPct),
    allowCredit: counter?.allowCredit ?? true, needCustomer: counter?.needCustomer ?? false, isActive: counter?.isActive ?? true,
  })
  const unchanged = !useChanged(f)
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => { setF((x) => ({ ...x, [k]: v })); setErrors((e) => ({ ...e, [k]: "" })) }
  const cash = setup.accounts.filter((a) => a.kind === "cash" && a.isActive)
  const bank = setup.accounts.filter((a) => a.kind !== "cash" && a.isActive)
  async function save() {
    const errs: Record<string, string> = {}
    if (f.name.trim().length < 2) errs.name = "Use at least 2 characters"
    const pct = f.maxDiscountPct === "" ? null : Number(f.maxDiscountPct)
    if (pct !== null && (!Number.isFinite(pct) || pct < 0 || pct > 100)) errs.maxDiscountPct = "Between 0 and 100"
    setErrors(errs)
    if (Object.keys(errs).length) return
    setBusy(true)
    setError(null)
    const body = { ...f, name: f.name.trim(), branchId: f.branchId || null, locationId: f.locationId || null, cashAccountId: f.cashAccountId || null, bankAccountId: f.bankAccountId || null, receiptNote: f.receiptNote.trim() || null, maxDiscountPct: pct, version: counter?.version }
    try {
      if (counter) await api.patch(`/pos/counters/${counter.id}`, body)
      else await api.post("/pos/counters", body)
      toast.success(counter ? "Counter saved" : "Counter added")
      onSaved()
    } catch (e) {
      if (e instanceof ApiError) setErrors(e.fields)
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[94vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{counter ? `Edit ${counter.name}` : "Add counter"}</DialogTitle>
          <DialogDescription>Bills from this counter use these settings. Changes apply to the next bill.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" error={errors.name} required><Input value={f.name} maxLength={60} onChange={(e) => set("name", e.target.value)} autoFocus /></Field>
          <Field label="Branch" hint="Who can use it: people of this branch">
            <NativeSelect value={f.branchId} onChange={(e) => set("branchId", e.target.value)}><option value="">Any branch</option>{setup.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</NativeSelect>
          </Field>
          <Field label="Sell from warehouse" error={errors.locationId} hint="Stock goes out of here">
            <NativeSelect value={f.locationId} onChange={(e) => set("locationId", e.target.value)}><option value="">Default warehouse</option>{setup.locations.filter((l) => l.isActive).map((l) => <option key={l.id} value={l.id}>{l.name}{l.isDefault ? " (default)" : ""}</option>)}</NativeSelect>
          </Field>
          <Field label="Receipt paper">
            <NativeSelect value={f.paper} onChange={(e) => set("paper", e.target.value as Counter["paper"])}><option value="80mm">80 mm thermal</option><option value="58mm">58 mm thermal</option><option value="a4">A4 invoice</option></NativeSelect>
          </Field>
          <Field label="Cash goes into" error={errors.cashAccountId} hint={setup.financeOn ? undefined : "Cash and bank accounts are in Finance"}>
            <NativeSelect value={f.cashAccountId} onChange={(e) => set("cashAccountId", e.target.value)}><option value="">First cash account</option>{cash.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</NativeSelect>
          </Field>
          <Field label="UPI and card go into" error={errors.bankAccountId}>
            <NativeSelect value={f.bankAccountId} onChange={(e) => set("bankAccountId", e.target.value)}><option value="">Default bank account</option>{bank.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</NativeSelect>
          </Field>
          <Field label="Most discount a cashier can give (%)" error={errors.maxDiscountPct} hint="Empty = no limit. A manager can give more.">
            <Input inputMode="decimal" value={f.maxDiscountPct} onChange={(e) => set("maxDiscountPct", e.target.value.replace(/[^\d.]/g, "").slice(0, 5))} placeholder="e.g. 10" />
          </Field>
          <Field label="Line at the bottom of the receipt"><Textarea rows={2} maxLength={300} value={f.receiptNote} onChange={(e) => set("receiptNote", e.target.value)} placeholder="Thank you! No exchange without bill." /></Field>
        </div>
        <div className="grid gap-2 rounded-xl border p-3 text-sm">
          <label className="flex items-start gap-2"><input type="checkbox" className="mt-0.5 size-4 accent-primary" checked={f.allowCredit} onChange={(e) => set("allowCredit", e.target.checked)} /><span><b>Allow on account</b><span className="block text-muted-foreground">A known customer may pay part now and owe the rest, within their credit limit.</span></span></label>
          <label className="flex items-start gap-2"><input type="checkbox" className="mt-0.5 size-4 accent-primary" checked={f.needCustomer} onChange={(e) => set("needCustomer", e.target.checked)} /><span><b>Ask the customer&apos;s name and phone on every bill</b><span className="block text-muted-foreground">Useful for warranty and to send the bill on WhatsApp.</span></span></label>
          {counter && <label className="flex items-start gap-2"><input type="checkbox" className="mt-0.5 size-4 accent-primary" checked={f.isActive} onChange={(e) => set("isActive", e.target.checked)} /><span><b>Active</b><span className="block text-muted-foreground">Make a counter you no longer use inactive. Its bills and shifts stay.</span></span></label>}
        </div>
        <FormError message={error} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => void save()} disabled={busy || (!!counter && unchanged)}>{busy && <Loader2 className="animate-spin" />} {counter ? "Save" : "Add counter"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

