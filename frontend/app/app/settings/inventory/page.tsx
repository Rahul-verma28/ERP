"use client"

import * as React from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { MoneyInput } from "@/components/common"
import { Field, NativeSelect } from "@/components/form"
import { api, ApiError, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useApi } from "@/lib/use-api"

// How stock behaves in this business.

export default function InventorySettingsPage() {
  const { can } = useAuth()
  const ws = useApi<{ preferences: { inventory: { blockNegative: boolean; adjustmentApprovalPaise: number; backdateDays: number; valuation: "average" | "fifo"; nearExpiryDays: number; purchaseOrders: boolean } } }>(can("tenant.settings.view") ? "/tenant/workspace" : null)
  const [form, setForm] = React.useState<{ blockNegative: boolean; adjustmentApprovalPaise: number | null; backdateDays: string; valuation: "average" | "fifo"; nearExpiryDays: string; purchaseOrders: boolean } | null>(null)
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [busy, setBusy] = React.useState(false)
  const current = ws.data?.preferences.inventory
  const v = form ?? (current ? { blockNegative: current.blockNegative, adjustmentApprovalPaise: current.adjustmentApprovalPaise, backdateDays: String(current.backdateDays), valuation: current.valuation, nearExpiryDays: String(current.nearExpiryDays), purchaseOrders: current.purchaseOrders } : null)
  if (!can("tenant.settings.view") || !v) return null
  const editable = can("tenant.settings.edit")
  async function save() {
    setBusy(true)
    setErrors({})
    try {
      await api.put("/tenant/preferences/inventory", { blockNegative: v!.blockNegative, adjustmentApprovalPaise: v!.adjustmentApprovalPaise ?? 0, backdateDays: Number(v!.backdateDays || 0), valuation: v!.valuation, nearExpiryDays: Number(v!.nearExpiryDays || 30), purchaseOrders: v!.purchaseOrders })
      toast.success("Stock rules saved")
      // The menu is built from the signed-in details, so a changed switch needs a fresh load
      if (v!.purchaseOrders !== current?.purchaseOrders) return window.location.reload()
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
    <Card>
      <CardContent className="grid gap-4">
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" className="mt-1" checked={v.blockNegative} disabled={!editable} onChange={(e) => setForm({ ...v, blockNegative: e.target.checked })} />
          <span><span className="font-medium">Stop sales when stock runs out</span><span className="block text-muted-foreground">Off: the bill goes through and stock shows below zero until you add stock.</span></span>
        </label>
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" className="mt-1" checked={v.purchaseOrders} disabled={!editable} onChange={(e) => setForm({ ...v, purchaseOrders: e.target.checked })} />
          <span><span className="font-medium">Use Purchase Orders and Goods Receipts</span><span className="block text-muted-foreground">Off: purchases start straight at the invoice. On: order first, receive the goods, then enter the invoice.</span></span>
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Adjustments that need a stock manager" hint="Adjustments and counts worth more than this" error={errors.adjustmentApprovalPaise}>
            <MoneyInput value={v.adjustmentApprovalPaise} onChange={(a) => setForm({ ...v, adjustmentApprovalPaise: a })} disabled={!editable} />
          </Field>
          <Field label="Entries can go back (days)" hint="0 to 31" error={errors.backdateDays}>
            <Input inputMode="numeric" value={v.backdateDays} onChange={(e) => setForm({ ...v, backdateDays: e.target.value.replace(/\D/g, "").slice(0, 2) })} disabled={!editable} />
          </Field>
          <Field label="Cost method" hint="Chosen once, before the first stock entry. Ask your CA." error={errors.valuation}>
            <NativeSelect value={v.valuation} onChange={(e) => setForm({ ...v, valuation: e.target.value as "average" | "fifo" })} disabled={!editable} aria-label="Cost method">
              <option value="average">Moving average</option>
              <option value="fifo">First in, first out (FIFO)</option>
            </NativeSelect>
          </Field>
          <Field label="Near expiry (days)" hint="Batches expiring within this show as near expiry" error={errors.nearExpiryDays}>
            <Input inputMode="numeric" value={v.nearExpiryDays} onChange={(e) => setForm({ ...v, nearExpiryDays: e.target.value.replace(/\D/g, "").slice(0, 3) })} disabled={!editable} />
          </Field>
        </div>
        {editable && form && <div className="flex justify-end"><Button disabled={busy} onClick={save}>{busy ? "Saving…" : "Save rules"}</Button></div>}
      </CardContent>
    </Card>
  )
}

