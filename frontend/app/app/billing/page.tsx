"use client"

import * as React from "react"
import { toast } from "sonner"
import { Check, ExternalLink, FileText, Loader2, Receipt, Users } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Field } from "@/components/form"
import { NumberStepper } from "@/components/number-stepper"
import { PageHeader } from "@/components/app-shell"
import { NoAccessPage } from "@/components/page-states"
import { StorageBar, type StorageUsage } from "@/components/storage-usage"
import { useApi } from "@/lib/use-api"
import { api, ApiError, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { formatDate, formatNumber, formatPaise } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { PlanLimits, TenantStatus } from "@/lib/types"

// Plan & billing: the owner's plan, what is due, buying or changing a plan, and AHEAD's invoices.
// Plans, bills and invoices come from the AHEAD Console through this ERP; the licence and usage are
// this workspace's own.

type Cycle = "monthly" | "yearly"
interface Plan { key: string; name: string; tagline: string; monthlyPaise: number | null; yearlyPaise: number | null; limits: PlanLimits; modules: string[]; isFree: boolean; isTrial: boolean }
interface Plans { plans: Plan[]; extraUserPaise: { monthly: number; yearly: number }; trialDays: number }
interface Local { status: TenantStatus; planKey: string; trialEndsAt: string | null; currentPeriodEnd: string | null; limits: PlanLimits; usage: { users: number; branches: number; storage?: StorageUsage } }
interface Billing {
  billedBy: { kind: "ahead" } | { kind: "partner"; name: string }
  subscription: { status: TenantStatus; plan: { key: string; name: string }; cycle: Cycle; extraUsers: number; trialEndsAt: string | null; periodEnd: string | null; graceEndsAt: string | null } | null
  openOrder: { id: string; status: "pending_approval" | "awaiting_payment"; planKey: string; cycle: Cycle; totalPaise: number; linkUrl: string | null; expiresAt: string } | null
  invoices: { id: string; number: string; issuedAt: string; totalPaise: number; creditNote: string | null }[]
}
interface Quote { kind: "new" | "renewal" | "change"; listPaise: number; discountPaise: number; taxablePaise: number; cgstPaise: number; sgstPaise: number; igstPaise: number; totalPaise: number; lines: { description: string; quantity: number; amountPaise: number }[] }

const STATUS_LABEL: Record<TenantStatus, string> = {
  incomplete: "Waiting for the first payment",
  trialing: "Free trial",
  active: "Active",
  past_due: "Payment due",
  free: "Free plan",
  closed: "Closed",
  purged: "Closed",
}
const limit = (n: number | null) => (n === null ? "Unlimited" : formatNumber(n))

export default function BillingPage() {
  const { can } = useAuth()
  const plans = useApi<Plans>("/billing/plans")
  const local = useApi<Local>(can("tenant.billing.view") ? "/billing/subscription" : null)
  const billing = useApi<Billing>(can("tenant.billing.view") ? "/billing" : null)
  const [cycle, setCycle] = React.useState<Cycle>("monthly")
  const [buying, setBuying] = React.useState<Plan | null>(null)
  const [invoice, setInvoice] = React.useState<string | null>(null)
  if (!can("tenant.billing.view")) return <NoAccessPage title="Plan & billing" permission="tenant.billing.view" />
  const err = plans.error ?? local.error ?? billing.error
  if (err && (!plans.data || !local.data || !billing.data)) {
    return (
      <>
        <PageHeader title="Plan & billing" />
        <Card><CardHeader><CardTitle>Couldn’t load your plan</CardTitle><CardDescription>{errorMessage(err)}</CardDescription></CardHeader><CardFooter><Button variant="outline" onClick={() => { void plans.reload(); void local.reload(); void billing.reload() }}>Try again</Button></CardFooter></Card>
      </>
    )
  }
  if (!plans.data || !local.data || !billing.data) return <Skeleton className="h-96 rounded-2xl" />

  const s = local.data
  const b = billing.data
  const sub = b.subscription
  const byPartner = b.billedBy.kind === "partner" ? b.billedBy.name : null
  const canBuy = can("tenant.billing.edit") && !byPartner && s.status !== "closed"
  const paidPlanKey = sub && ["active", "past_due"].includes(sub.status) ? sub.plan.key : null

  return (
    <>
      <PageHeader title="Plan & billing" description="Prices are before 18% GST. A new plan starts the day it is paid; the same plan again continues your current period." />

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            {STATUS_LABEL[s.status]}
            {sub && s.status !== "trialing" && <Badge variant="secondary">{sub.plan.name}</Badge>}
            {sub?.extraUsers ? <Badge variant="outline">+{sub.extraUsers} users</Badge> : null}
          </CardTitle>
          <CardDescription>
            {s.status === "trialing" && s.trialEndsAt && `Every module is open until ${formatDate(s.trialEndsAt)}. After that you move to the Free plan — nothing is deleted.`}
            {s.status === "free" && "Free core modules stay open. Paid modules you used are view only until you choose a plan."}
            {s.status === "active" && (byPartner ? `Your plan is managed and billed by ${byPartner}.` : s.currentPeriodEnd ? `Paid until ${formatDate(s.currentPeriodEnd)}. The renewal comes by email a week before.` : "Active.")}
            {s.status === "incomplete" && "Your workspace is ready. Modules open as soon as the payment below is received."}
            {s.status === "past_due" && `The renewal is unpaid. Everything keeps working${sub?.graceEndsAt ? ` until ${formatDate(sub.graceEndsAt)}` : ""}; after that paid modules become view only.`}
            {s.status === "closed" && "This business is closed. Reopen it from Settings › Data to choose a plan again."}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Usage label="Users" used={s.usage.users} max={s.limits.users} />
          <Usage label="Branches" used={s.usage.branches} max={s.limits.branches} />
          {s.usage.storage && <StorageBar usage={s.usage.storage} manageHref={can("tenant.file.view") ? "/app/settings/files" : null} className="sm:col-span-2" />}
        </CardContent>
      </Card>

      {b.openOrder && !byPartner && <OpenOrder order={b.openOrder} planName={plans.data.plans.find((p) => p.key === b.openOrder!.planKey)?.name ?? b.openOrder.planKey} canPay={can("tenant.billing.edit")} />}

      {byPartner ? (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Billed by {byPartner}</CardTitle>
            <CardDescription>Your AHEAD plan comes through {byPartner}. To change it, or for any bill, talk to them.</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Plans</h2>
            <div className="inline-flex rounded-full bg-muted p-1 text-sm" role="radiogroup" aria-label="Billing cycle">
              {(["monthly", "yearly"] as const).map((c) => (
                <button key={c} type="button" role="radio" aria-checked={cycle === c} onClick={() => setCycle(c)} className={cn("rounded-full px-3 py-1", cycle === c && "bg-background font-medium shadow-sm")}>
                  {c === "monthly" ? "Monthly" : "Yearly"} {c === "yearly" && <span className="text-xs text-muted-foreground">2 months free</span>}
                </button>
              ))}
            </div>
          </div>
          <div className="mb-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {plans.data.plans.map((p) => {
              const price = cycle === "monthly" ? p.monthlyPaise : p.yearlyPaise
              const quoted = price === null
              const current = paidPlanKey === p.key || (p.isFree && s.status === "free")
              return (
                <Card key={p.key} className={cn(p.isTrial && "ring-2 ring-primary")}>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      {p.name} {p.isTrial && <Badge>Most chosen</Badge>}
                    </CardTitle>
                    <CardDescription>{p.tagline}</CardDescription>
                  </CardHeader>
                  <CardContent className="grid gap-4">
                    <p>
                      <span className="text-3xl font-semibold">{quoted ? "Custom" : formatPaise(price, true)}</span>
                      {!quoted && price > 0 && <span className="text-sm text-muted-foreground"> /{cycle === "monthly" ? "month" : "year"}</span>}
                    </p>
                    <ul className="grid gap-1.5 text-sm">
                      <li className="flex gap-2"><Check className="size-4 shrink-0" /> {p.limits.users} users, {p.limits.branches} branch{p.limits.branches === 1 ? "" : "es"}</li>
                      <li className="flex gap-2"><Check className="size-4 shrink-0" /> {limit(p.limits.invoicesPerMonth)} invoices a month</li>
                      <li className="flex gap-2"><Check className="size-4 shrink-0" /> {limit(p.limits.contacts)} customers</li>
                      <li className="flex gap-2"><Check className="size-4 shrink-0" /> {formatNumber(Math.round(p.limits.storageMb / 1024))} GB for files</li>
                    </ul>
                  </CardContent>
                  <CardFooter>
                    {current ? (
                      <Button className="w-full" variant="outline" disabled>Your plan</Button>
                    ) : p.isFree ? (
                      <Button className="w-full" variant="outline" disabled>Free forever</Button>
                    ) : quoted ? (
                      <a href="mailto:sales@aheaderp.com?subject=Enterprise%20plan" className="w-full"><Button className="w-full" variant="outline">Talk to AHEAD</Button></a>
                    ) : (
                      <Button className="w-full" disabled={!canBuy} onClick={() => setBuying(p)}>{paidPlanKey ? "Switch to this plan" : "Choose"}</Button>
                    )}
                  </CardFooter>
                </Card>
              )
            })}
          </div>
          {paidPlanKey && canBuy && (
            <p className="-mt-4 mb-8 text-sm text-muted-foreground">
              Want to pay the next period early or add users?{" "}
              <button type="button" className="font-medium text-primary hover:underline" onClick={() => setBuying(plans.data!.plans.find((p) => p.key === paidPlanKey) ?? null)}>
                Renew {sub?.plan.name}
              </button>
            </p>
          )}
        </>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Receipt className="size-4" /> Invoices from AHEAD</CardTitle>
          <CardDescription>GST invoices for what you paid. {byPartner ? `Bills from ${byPartner} come from them.` : ""}</CardDescription>
        </CardHeader>
        <CardContent>
          {b.invoices.length ? (
            <ul className="divide-y text-sm">
              {b.invoices.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                  <span className="flex items-center gap-2">
                    <FileText className="size-4 text-muted-foreground" aria-hidden />
                    <span className="font-mono">{i.number}</span>
                    <span className="text-muted-foreground">· {formatDate(i.issuedAt)}</span>
                    {i.creditNote && <Badge variant="outline">Credited ({i.creditNote})</Badge>}
                  </span>
                  <span className="flex items-center gap-3">
                    <span className="font-medium tabular-nums">{formatPaise(i.totalPaise)}</span>
                    <Button size="sm" variant="outline" onClick={() => setInvoice(i.id)}>View</Button>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No invoices yet. They appear here once a payment is made.</p>
          )}
        </CardContent>
      </Card>

      {buying && <BuyDialog plan={buying} cycle={cycle} extraUserPaise={plans.data.extraUserPaise} currentExtra={sub?.extraUsers ?? 0} onClose={() => setBuying(null)} />}
      {invoice && <InvoiceDialog id={invoice} onClose={() => setInvoice(null)} />}
    </>
  )
}

function OpenOrder({ order, planName, canPay }: { order: NonNullable<Billing["openOrder"]>; planName: string; canPay: boolean }) {
  const [opening, setOpening] = React.useState(false)
  const pay = async () => {
    setOpening(true)
    try {
      window.location.href = order.linkUrl ?? (await api.post<{ url: string }>(`/billing/orders/${order.id}/link`)).url
    } catch (e) {
      toast.error(errorMessage(e))
      setOpening(false)
    }
  }
  return (
    <Card className="mb-6 border-primary">
      <CardHeader>
        <CardTitle>Payment due · {formatPaise(order.totalPaise)}</CardTitle>
        <CardDescription>
          {order.status === "pending_approval"
            ? "Your AHEAD contact is finalising this order. You'll get a payment link by email shortly."
            : `${planName}, ${order.cycle === "yearly" ? "1 year" : "1 month"}, GST included. Pay by ${formatDate(order.expiresAt)}.`}
        </CardDescription>
      </CardHeader>
      {order.status === "awaiting_payment" && canPay && (
        <CardFooter>
          <Button disabled={opening} onClick={() => void pay()}>
            {opening ? <Loader2 className="animate-spin" /> : <ExternalLink />} {opening ? "Opening…" : `Pay ${formatPaise(order.totalPaise)}`}
          </Button>
        </CardFooter>
      )}
    </Card>
  )
}

/** Choose the cycle, extra users and a coupon; see the exact amount with GST; then pay */
function BuyDialog({ plan, cycle: startCycle, extraUserPaise, currentExtra, onClose }: { plan: Plan; cycle: Cycle; extraUserPaise: { monthly: number; yearly: number }; currentExtra: number; onClose: () => void }) {
  const [cycle, setCycle] = React.useState<Cycle>(startCycle)
  const [extra, setExtra] = React.useState(String(currentExtra))
  const [coupon, setCoupon] = React.useState("")
  const [applied, setApplied] = React.useState<string | null>(null)
  const [couponError, setCouponError] = React.useState<string | null>(null)
  const [quote, setQuote] = React.useState<Quote | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [paying, setPaying] = React.useState(false)
  const body = React.useMemo(() => ({ planKey: plan.key, cycle, extraUsers: Number(extra || 0), couponCode: applied }), [plan.key, cycle, extra, applied])

  React.useEffect(() => {
    let live = true
    Promise.resolve()
      .then(() => {
        if (live) setLoading(true)
        return api.post<Quote>("/billing/quote", body)
      })
      .then((q) => live && setQuote(q))
      .catch((e) => {
        if (!live) return
        // A coupon that doesn't apply is said beside it; the quote falls back to no coupon
        if (e instanceof ApiError && e.fields.couponCode) {
          setCouponError(e.fields.couponCode)
          setApplied(null)
        } else toast.error(errorMessage(e))
      })
      .finally(() => live && setLoading(false))
    return () => {
      live = false
    }
  }, [body])

  const pay = async () => {
    setPaying(true)
    try {
      const o = await api.post<{ id: string; status: string; linkUrl: string | null }>("/billing/orders", body)
      if (o.status !== "awaiting_payment" || !o.linkUrl) {
        toast.success("Your order is with AHEAD. The payment link comes by email.")
        onClose()
        return
      }
      window.location.href = o.linkUrl
    } catch (e) {
      toast.error(errorMessage(e))
      setPaying(false)
    }
  }
  const gst = quote ? quote.cgstPaise + quote.sgstPaise + quote.igstPaise : 0

  return (
    <Dialog open onOpenChange={(o) => !o && !paying && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{plan.name} plan</DialogTitle>
          <DialogDescription>{plan.tagline}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="inline-flex w-fit rounded-full bg-muted p-1 text-sm" role="radiogroup" aria-label="Billing cycle">
            {(["monthly", "yearly"] as const).map((c) => (
              <button key={c} type="button" role="radio" aria-checked={cycle === c} onClick={() => setCycle(c)} className={cn("rounded-full px-3 py-1", cycle === c && "bg-background font-medium shadow-sm")}>
                {c === "monthly" ? "Monthly" : "Yearly"}
              </button>
            ))}
          </div>
          <Field label="Extra users" hint={`${plan.limits.users} included · ${formatPaise(extraUserPaise[cycle])} each per ${cycle === "monthly" ? "month" : "year"}`}>
            <div className="flex items-center gap-2"><Users className="size-4 text-muted-foreground" aria-hidden /><NumberStepper value={extra} onChange={setExtra} min={0} max={500} aria-label="Extra users" className="w-36" /></div>
          </Field>
          <Field label="Coupon" error={couponError} success={applied ? `${applied} applied` : null}>
            <div className="flex gap-2">
              <Input value={coupon} onChange={(e) => { setCoupon(e.target.value.toUpperCase()); setCouponError(null) }} placeholder="e.g. WELCOME10" maxLength={20} className="font-mono uppercase" />
              <Button type="button" variant="outline" disabled={!coupon.trim() || loading} onClick={() => { setCouponError(null); setApplied(coupon.trim()) }}>Apply</Button>
            </div>
          </Field>
          <dl className="grid gap-1 rounded-xl bg-muted/50 p-3 text-sm">
            {quote ? (
              <>
                {quote.lines.map((l) => (
                  <div key={l.description} className="flex justify-between"><dt className="text-muted-foreground">{l.description}{l.quantity > 1 ? ` × ${l.quantity}` : ""}</dt><dd className="tabular-nums">{formatPaise(l.amountPaise)}</dd></div>
                ))}
                {quote.discountPaise > 0 && <div className="flex justify-between text-emerald-700 dark:text-emerald-400"><dt>Discount</dt><dd className="tabular-nums">− {formatPaise(quote.discountPaise)}</dd></div>}
                <div className="flex justify-between"><dt className="text-muted-foreground">GST{quote.igstPaise ? " (IGST)" : " (CGST + SGST)"}</dt><dd className="tabular-nums">{formatPaise(gst)}</dd></div>
                <div className="mt-1 flex justify-between border-t pt-2 text-base font-semibold"><dt>Total</dt><dd className="tabular-nums">{formatPaise(quote.totalPaise)}</dd></div>
                {quote.kind === "renewal" && <p className="mt-1 text-xs text-muted-foreground">Continues from the end of your current period.</p>}
              </>
            ) : (
              <Skeleton className="h-24" />
            )}
          </dl>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={paying}>Cancel</Button>
          <Button onClick={() => void pay()} disabled={!quote || loading || paying}>
            {paying ? <Loader2 className="animate-spin" /> : null} {paying ? "Opening payment…" : quote ? `Pay ${formatPaise(quote.totalPaise)}` : "Pay"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

interface InvoiceDoc {
  number: string
  issuedAt: string
  seller: { legalName: string; gstin: string; address: string; sac: string }
  billTo: { name: string; gstin: string | null; stateCode: string | null }
  lines: { description: string; sac: string; quantity: number; amountPaise: number }[]
  taxablePaise: number
  cgstPaise: number
  sgstPaise: number
  igstPaise: number
  totalPaise: number
  creditNote: { number: string; reason: string } | null
  order: { payments: { method: string; reference: string | null; receivedAt: string }[] }
}

function InvoiceDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const inv = useApi<InvoiceDoc>(`/billing/invoices/${id}`)
  const d = inv.data
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Tax invoice {d?.number ?? ""}</DialogTitle>
          <DialogDescription>{d ? `${formatDate(d.issuedAt)} · from ${d.seller.legalName}` : "Loading…"}</DialogDescription>
        </DialogHeader>
        {d ? (
          <div className="grid gap-4 text-sm">
            <div className="grid gap-3 sm:grid-cols-2">
              <div><p className="text-xs text-muted-foreground">From</p><p className="font-medium">{d.seller.legalName}</p><p className="text-muted-foreground">{d.seller.address}</p>{d.seller.gstin && <p className="font-mono text-xs">GSTIN {d.seller.gstin}</p>}</div>
              <div><p className="text-xs text-muted-foreground">To</p><p className="font-medium">{d.billTo.name}</p>{d.billTo.gstin && <p className="font-mono text-xs">GSTIN {d.billTo.gstin}</p>}</div>
            </div>
            <ul className="divide-y rounded-lg border">
              {d.lines.map((l) => (
                <li key={l.description} className="flex justify-between gap-3 px-3 py-2"><span>{l.description}{l.quantity > 1 ? ` × ${l.quantity}` : ""} <span className="text-xs text-muted-foreground">SAC {l.sac}</span></span><span className="tabular-nums">{formatPaise(l.amountPaise)}</span></li>
              ))}
            </ul>
            <dl className="ml-auto grid w-full max-w-xs gap-1">
              <div className="flex justify-between"><dt className="text-muted-foreground">Taxable value</dt><dd className="tabular-nums">{formatPaise(d.taxablePaise)}</dd></div>
              {d.igstPaise ? <div className="flex justify-between"><dt className="text-muted-foreground">IGST</dt><dd className="tabular-nums">{formatPaise(d.igstPaise)}</dd></div> : (
                <>
                  <div className="flex justify-between"><dt className="text-muted-foreground">CGST</dt><dd className="tabular-nums">{formatPaise(d.cgstPaise)}</dd></div>
                  <div className="flex justify-between"><dt className="text-muted-foreground">SGST</dt><dd className="tabular-nums">{formatPaise(d.sgstPaise)}</dd></div>
                </>
              )}
              <div className="flex justify-between border-t pt-1 font-semibold"><dt>Total</dt><dd className="tabular-nums">{formatPaise(d.totalPaise)}</dd></div>
            </dl>
            {d.order.payments[0] && <p className="text-xs text-muted-foreground">Paid {formatDate(d.order.payments[0].receivedAt)} · {d.order.payments[0].method}{d.order.payments[0].reference ? ` · ${d.order.payments[0].reference}` : ""}</p>}
            {d.creditNote && <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">Credited in full by {d.creditNote.number}: {d.creditNote.reason}</p>}
          </div>
        ) : (
          <Skeleton className="h-56" />
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => window.print()} disabled={!d}>Print</Button>
          <Button onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Usage({ label, used, max }: { label: string; used: number; max: number }) {
  const pct = Math.min(100, (used / max) * 100)
  return (
    <div>
      <div className="mb-1 flex justify-between text-sm">
        <span>{label}</span>
        <span className="text-muted-foreground">
          {used} of {max}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label={label} aria-valuenow={used} aria-valuemax={max}>
        <div className={cn("h-full rounded-full", pct >= 100 ? "bg-destructive" : "bg-primary")} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}
