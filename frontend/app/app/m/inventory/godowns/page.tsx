"use client"

import * as React from "react"
import Link from "next/link"
import { toast } from "sonner"
import { ArrowLeft, Plus } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { PageHeader } from "@/components/app-shell"
import { MoneyInput, Spinner } from "@/components/common"
import { Field, FormError } from "@/components/form"
import { api, ApiError, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useApi } from "@/lib/use-api"
import { formatPaise } from "@/lib/format"
import type { StockLocation } from "@/lib/inventory"

// Godowns and the stock rules: block negative stock, approval limit, how far back entries go.

function GodownDialog({ godown, onClose, onSaved }: { godown: StockLocation | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = React.useState(godown?.name ?? "")
  const [error, setError] = React.useState<string | null>(null)
  const [fieldError, setFieldError] = React.useState<string | undefined>()
  const [busy, setBusy] = React.useState(false)
  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (name.trim().length < 2) return setFieldError("Use at least 2 characters")
    setBusy(true)
    try {
      if (godown) await api.patch(`/stock-locations/${godown.id}`, { name: name.trim() })
      else await api.post("/stock-locations", { name: name.trim() })
      toast.success("Godown saved")
      onSaved()
    } catch (err) {
      if (err instanceof ApiError) setFieldError(err.fields.name)
      setError(errorMessage(err))
      setBusy(false)
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{godown ? `Rename ${godown.name}` : "New godown"}</DialogTitle></DialogHeader>
        <form onSubmit={save} className="grid gap-4">
          <Field label="Name" required error={fieldError}><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Back store" maxLength={60} autoFocus /></Field>
          <FormError message={error} />
          <DialogFooter><Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function StockRules() {
  const { can } = useAuth()
  const ws = useApi<{ preferences: { inventory: { blockNegative: boolean; adjustmentApprovalPaise: number; backdateDays: number } } }>(can("tenant.settings.view") ? "/tenant/workspace" : null)
  const [form, setForm] = React.useState<{ blockNegative: boolean; adjustmentApprovalPaise: number | null; backdateDays: string } | null>(null)
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [busy, setBusy] = React.useState(false)
  const current = ws.data?.preferences.inventory
  const v = form ?? (current ? { blockNegative: current.blockNegative, adjustmentApprovalPaise: current.adjustmentApprovalPaise, backdateDays: String(current.backdateDays) } : null)
  if (!can("tenant.settings.view") || !v) return null
  const editable = can("tenant.settings.edit")
  async function save() {
    setBusy(true)
    setErrors({})
    try {
      await api.put("/tenant/preferences/inventory", { blockNegative: v!.blockNegative, adjustmentApprovalPaise: v!.adjustmentApprovalPaise ?? 0, backdateDays: Number(v!.backdateDays || 0) })
      toast.success("Stock rules saved")
      setForm(null)
      await ws.reload()
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fields)
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Card className="mt-6">
      <CardHeader><CardTitle className="text-base">Stock rules</CardTitle></CardHeader>
      <CardContent className="grid gap-4">
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" className="mt-1" checked={v.blockNegative} disabled={!editable} onChange={(e) => setForm({ ...v, blockNegative: e.target.checked })} />
          <span><span className="font-medium">Stop sales when stock runs out</span><span className="block text-muted-foreground">Off: the bill goes through and stock shows below zero until you add stock.</span></span>
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Adjustments that need a stock manager" hint="Adjustments and counts worth more than this" error={errors.adjustmentApprovalPaise}>
            <MoneyInput value={v.adjustmentApprovalPaise} onChange={(a) => setForm({ ...v, adjustmentApprovalPaise: a })} disabled={!editable} />
          </Field>
          <Field label="Entries can go back (days)" hint="0 to 31" error={errors.backdateDays}>
            <Input inputMode="numeric" value={v.backdateDays} onChange={(e) => setForm({ ...v, backdateDays: e.target.value.replace(/\D/g, "").slice(0, 2) })} disabled={!editable} />
          </Field>
        </div>
        {editable && form && <div className="flex justify-end"><Button disabled={busy} onClick={save}>{busy ? "Saving…" : "Save rules"}</Button></div>}
      </CardContent>
    </Card>
  )
}

export default function GodownsPage() {
  const { can } = useAuth()
  const { data, error, reload } = useApi<{ data: StockLocation[] }>(can("inventory.stock.view") ? "/stock-locations" : null)
  const [editing, setEditing] = React.useState<StockLocation | "new" | null>(null)
  if (!can("inventory.stock.view")) return <PageHeader title="Godowns" description="You don't have access to stock. Ask your admin." />

  const act = async (g: StockLocation, patch: Record<string, unknown>, done: string) => {
    try {
      await api.patch(`/stock-locations/${g.id}`, patch)
      toast.success(done)
      await reload()
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }
  return (
    <>
      <Link href="/app/m/inventory" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> Stock</Link>
      <PageHeader title="Godowns" description="Where you keep stock. Sales and challans take stock from the default godown." actions={can("inventory.warehouse.create") ? <Button onClick={() => setEditing("new")}><Plus /> New godown</Button> : undefined} />
      {error ? <p className="text-sm text-muted-foreground">{error.message}</p> : !data ? <div className="grid place-items-center py-24"><Spinner /></div> : (
        <Card>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Godown</th>
                  <th className="py-2 pr-3 text-right font-medium">Items in stock</th>
                  <th className="py-2 pr-3 text-right font-medium">Value</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.data.map((g) => (
                  <tr key={g.id} className="border-b border-border/60">
                    <td className="py-2 pr-3 font-medium">{g.name}{g.isDefault && <Badge variant="outline" className="ml-2">Default</Badge>}{!g.isActive && <Badge variant="outline" className="ml-2">Closed</Badge>}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{g.itemsInStock}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{formatPaise(g.valuePaise)}</td>
                    <td className="py-2 text-right">
                      {can("inventory.warehouse.edit") && (
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="sm" onClick={() => setEditing(g)}>Rename</Button>
                          {g.isActive && !g.isDefault && <Button variant="ghost" size="sm" onClick={() => act(g, { isDefault: true }, `${g.name} is the default`)}>Make default</Button>}
                          {!g.isDefault && <Button variant="ghost" size="sm" onClick={() => act(g, { isActive: !g.isActive }, g.isActive ? `${g.name} closed` : `${g.name} reopened`)}>{g.isActive ? "Close" : "Reopen"}</Button>}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
      <StockRules />
      {editing && <GodownDialog godown={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void reload() }} />}
    </>
  )
}
