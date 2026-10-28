"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Field, FormError, NativeSelect } from "@/components/form"
import { api, ApiError, errorMessage } from "@/lib/api"
import { useApi } from "@/lib/use-api"
import { useDebounced } from "@/lib/use-list"
import { formatPaise } from "@/lib/format"
import type { Catalog, ClientDetail, Quote } from "@/lib/console"

// Wireframe C3 "Convert to paid": an order for a client already on AHEAD. Payment then goes
// through Payments (link or offline); a discount over the seller's limit waits for approval there.

export function ConvertDialog({ client, open, onOpenChange }: { client: ClientDetail; open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter()
  const catalog = useApi<Catalog>(open ? "/console/catalog" : null)
  const [form, setForm] = React.useState({ planKey: client.subscription?.plan?.key && client.subscription.plan.key !== "free" ? client.subscription.plan.key : "starter", cycle: "yearly", extraUsers: "0", discountPercent: "0", couponCode: "" })
  const [quote, setQuote] = React.useState<Quote | null>(null)
  const [quoteError, setQuoteError] = React.useState<string | null>(null)
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [busy, setBusy] = React.useState(false)
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value })
  const order = { planKey: form.planKey, cycle: form.cycle, addOns: [], extraUsers: Number(form.extraUsers) || 0, discountPercent: Number(form.discountPercent) || 0, couponCode: form.couponCode || null }
  const pricing = useDebounced(JSON.stringify(order), 400)

  React.useEffect(() => {
    if (!open || !client.billingStateCode) return
    let cancelled = false
    api
      .post<Quote>("/console/quote", { ...JSON.parse(pricing), stateCode: client.billingStateCode })
      .then((q) => !cancelled && (setQuote(q), setQuoteError(null)))
      .catch((e) => !cancelled && (setQuote(null), setQuoteError(errorMessage(e))))
    return () => {
      cancelled = true
    }
  }, [pricing, open, client.billingStateCode])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setErrors({})
    try {
      const r = await api.post<{ orderId: string; status: string }>(`/console/tenants/${client.id}/convert`, order)
      toast.success(r.status === "pending_approval" ? "Order created — the discount is waiting for approval" : "Order created — send the payment link")
      router.push(`/console/payments/${r.orderId}`)
    } catch (err) {
      setErrors(err instanceof ApiError ? { ...err.fields, form: errorMessage(err) } : { form: errorMessage(err) })
      setBusy(false)
    }
  }

  const plans = catalog.data?.plans.filter((p) => p.key !== "free") ?? []
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Convert {client.name} to paid</DialogTitle>
            <DialogDescription>Creates an order; the plan starts when the payment is received. Their data and users stay as they are.</DialogDescription>
          </DialogHeader>
          {!client.billingStateCode && <FormError message="This client has no GST state yet — the owner adds it in Settings › Business before an invoice can be made." />}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Plan" error={errors.planKey}>
              <NativeSelect value={form.planKey} onChange={set("planKey")}>
                {plans.map((p) => (
                  <option key={p.key} value={p.key}>{p.name}</option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Billing">
              <NativeSelect value={form.cycle} onChange={set("cycle")}>
                <option value="yearly">Yearly</option>
                <option value="monthly">Monthly</option>
              </NativeSelect>
            </Field>
            <Field label="Extra users" error={errors.extraUsers}>
              <Input type="number" min={0} max={500} value={form.extraUsers} onChange={set("extraUsers")} />
            </Field>
            <Field label="Discount %" error={errors.discountPercent} hint={quote ? `Your limit: ${quote.discountLimitPercent}%` : undefined}>
              <Input type="number" min={0} max={100} value={form.discountPercent} onChange={set("discountPercent")} />
            </Field>
            <Field label="Coupon" error={errors.couponCode}>
              <Input value={form.couponCode} onChange={(e) => setForm({ ...form, couponCode: e.target.value.toUpperCase() })} />
            </Field>
          </div>
          <div className="rounded-xl border px-3 py-2 text-sm">
            {quoteError ? (
              <p className="text-destructive">{quoteError}</p>
            ) : quote ? (
              <>
                <div className="flex justify-between"><span className="text-muted-foreground">Before GST</span><span className="tabular-nums">{formatPaise(quote.taxablePaise)}</span></div>
                <div className="flex justify-between font-semibold"><span>Total with GST</span><span className="tabular-nums">{formatPaise(quote.totalPaise)}</span></div>
                {quote.needsApproval && <p className="mt-1 text-xs font-semibold text-amber-700 dark:text-amber-400">Above your discount limit — a Super Admin approves it in Payments before the link can be sent.</p>}
              </>
            ) : (
              <p className="text-muted-foreground">Working out the price…</p>
            )}
          </div>
          <FormError message={errors.form} />
          <DialogFooter>
            <Button type="submit" disabled={busy || !quote || !client.billingStateCode}>{busy ? "Creating…" : "Create order"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
