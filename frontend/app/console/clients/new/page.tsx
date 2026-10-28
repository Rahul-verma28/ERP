"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { AlertTriangle, Check, ChevronDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field, FormError, NativeSelect } from "@/components/form"
import { Failed, Loading, Page, Panel, Steps, money } from "@/components/console/kit"
import { api, ApiError, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useApi } from "@/lib/use-api"
import { useDebounced } from "@/lib/use-list"
import { formatPaise, GST_STATES } from "@/lib/format"
import type { Catalog, Quote } from "@/lib/console"
import { cn } from "@/lib/utils"

// Add client: three short steps — Business, Owner, Plan. The AHEAD team and vendors create a
// paid order and the owner gets a payment link; a partner's client goes live straight away and
// is added to the partner's monthly bill.

interface Form {
  name: string
  industryKey: string
  stateCode: string
  gstin: string
  ownerName: string
  ownerEmail: string
  ownerMobile: string
  planKey: string
  cycle: "monthly" | "yearly"
  extraUsers: string
  discountPercent: string
  couponCode: string
}

const EMPTY: Form = { name: "", industryKey: "", stateCode: "", gstin: "", ownerName: "", ownerEmail: "", ownerMobile: "", planKey: "", cycle: "yearly", extraUsers: "0", discountPercent: "0", couponCode: "" }
const STEPS = ["Business", "Owner", "Plan"]

// Server field errors → the step that has the field
const FIELD_STEP: Record<string, number> = { name: 0, industryKey: 0, stateCode: 0, gstin: 0, address: 0, ownerName: 1, email: 1, mobile: 1, planKey: 2, cycle: 2, extraUsers: 2, discountPercent: 2, couponCode: 2 }

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={cn("flex justify-between gap-4 py-1 text-sm", strong && "text-base font-semibold")}>
      <span className={strong ? "" : "text-muted-foreground"}>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  )
}

export default function NewClientPage() {
  const router = useRouter()
  const { me } = useAuth()
  const partner = me?.console?.partner ?? null
  const catalog = useApi<Catalog>("/console/catalog")
  const industries = useApi<{ data: { key: string; name: string }[] }>("/public/industries")
  const [form, setForm] = React.useState<Form>(EMPTY)
  const [step, setStep] = React.useState(0)
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [busy, setBusy] = React.useState(false)
  const [more, setMore] = React.useState(false)
  const [quote, setQuote] = React.useState<Quote | null>(null)
  const [quoteError, setQuoteError] = React.useState<string | null>(null)
  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setForm((f) => ({ ...f, [k]: v }))
    setErrors((e) => ({ ...e, [k]: "" }))
  }

  const priceOf = (planKey: string, cycle: "monthly" | "yearly") => catalog.data?.prices.find((p) => p.itemType === "plan" && p.itemRef === planKey && p.cycle === cycle)?.amountPaise ?? null
  // Plans without a list price (e.g. Enterprise, quoted by AHEAD) can't be sold from here
  const plans = (catalog.data?.plans ?? []).filter((p) => p.key !== "free" && p.isPublic && (priceOf(p.key, "monthly") !== null || priceOf(p.key, "yearly") !== null))
  // Partners are billed monthly, whatever they charge their client
  const cycle = partner ? "monthly" : form.cycle
  // The first plan is picked until someone chooses another
  const sold = plans.filter((p) => priceOf(p.key, cycle) !== null)
  const planKey = sold.some((p) => p.key === form.planKey) ? form.planKey : sold[0]?.key ?? ""

  // Live price for the AHEAD team and vendors (GST depends on the client's state)
  const pricing = useDebounced(JSON.stringify({ planKey, cycle: form.cycle, extraUsers: form.extraUsers, discountPercent: form.discountPercent, couponCode: form.couponCode, stateCode: form.stateCode }), 350)
  React.useEffect(() => {
    const p = JSON.parse(pricing) as Form
    if (partner || step !== 2 || !p.planKey || !p.stateCode) return
    let cancelled = false
    api
      .post<Quote>("/console/quote", { planKey: p.planKey, cycle: p.cycle, addOns: [], extraUsers: Number(p.extraUsers) || 0, discountPercent: Number(p.discountPercent) || 0, couponCode: p.couponCode || null, stateCode: p.stateCode })
      .then((q) => !cancelled && (setQuote(q), setQuoteError(null)))
      .catch((e) => !cancelled && (setQuote(null), setQuoteError(errorMessage(e))))
    return () => {
      cancelled = true
    }
  }, [pricing, partner, step])

  function check(s: number) {
    const e: Record<string, string> = {}
    if (s === 0) {
      if (form.name.trim().length < 2) e.name = "Enter the business name"
      if (!form.industryKey) e.industryKey = "Choose the industry"
      if (!form.stateCode) e.stateCode = "Choose the state"
      if (form.gstin && !/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(form.gstin)) e.gstin = "A GSTIN has 15 characters, like 27ABCDE1234F1Z5"
    }
    if (s === 1) {
      if (form.ownerName.trim().length < 2) e.ownerName = "Enter the owner's name"
      if (!/^\S+@\S+\.\S+$/.test(form.ownerEmail)) e.email = "Enter a valid email"
      if (!/^[6-9]\d{9}$/.test(form.ownerMobile.replace(/\D/g, "").slice(-10))) e.mobile = "Enter a 10-digit mobile number"
    }
    setErrors(e)
    return !Object.keys(e).length
  }

  const next = () => check(step) && setStep((s) => s + 1)

  async function submit() {
    if (!check(0) || !check(1)) return
    setBusy(true)
    setErrors({})
    const business = { name: form.name, industryKey: form.industryKey, gstin: form.gstin || null, stateCode: form.stateCode }
    const owner = { name: form.ownerName, email: form.ownerEmail, mobile: form.ownerMobile }
    try {
      if (partner) {
        const r = await api.post<{ tenantId: string }>("/console/partner-clients", { business, owner, planKey, cycle })
        toast.success(`${form.name} is live — the owner can sign in now`)
        router.push(`/console/clients/${r.tenantId}`)
        return
      }
      const r = await api.post<{ tenantId: string; orderId: string; status: string }>("/console/clients", {
        business,
        owner,
        order: { planKey: planKey, cycle: form.cycle, addOns: [], extraUsers: Number(form.extraUsers) || 0, discountPercent: Number(form.discountPercent) || 0, couponCode: form.couponCode || null },
      })
      if (r.status === "pending_approval") {
        toast.success("Client added — the discount is waiting for approval, then the payment link goes out")
      } else {
        try {
          await api.post(`/console/orders/${r.orderId}/payment-link`, { resend: false })
          toast.success(`Client added — payment link sent to ${form.ownerEmail}`)
        } catch (e) {
          toast.warning(`Client added, but the payment link wasn't sent: ${errorMessage(e)}`)
        }
      }
      router.push(`/console/clients/${r.tenantId}`)
    } catch (err) {
      if (err instanceof ApiError) {
        const fields = Object.fromEntries(Object.entries(err.fields).map(([k, v]) => [k.split(".").pop()!, v]))
        setErrors({ ...fields, form: errorMessage(err) })
        const first = Object.keys(fields).map((k) => FIELD_STEP[k]).filter((x) => x !== undefined)
        if (first.length) setStep(Math.min(...first))
      } else setErrors({ form: errorMessage(err) })
      setBusy(false)
    }
  }

  const listPrice = planKey ? priceOf(planKey, form.cycle) : null
  const partnerMonthly = planKey ? priceOf(planKey, "monthly") ?? Math.round((priceOf(planKey, "yearly") ?? 0) / 12) : 0

  return (
    <Page title="Add client" subtitle={partner ? "The client goes live as soon as you finish. It appears on your next monthly bill." : "The owner gets a payment link by email. Their workspace opens as soon as they pay."} back={{ href: "/console/clients", label: "Clients" }}>
      <Steps steps={STEPS} current={step} />
      {catalog.error && <Failed error={catalog.error} onRetry={catalog.reload} />}

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <Panel title={STEPS[step] === "Business" ? "About the business" : STEPS[step] === "Owner" ? "Who owns it" : "Choose a plan"} description={step === 1 ? "They sign in with this mobile number (one-time code). If the email already has an AHEAD account, that person becomes the owner." : undefined}>
          {step === 0 && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Business name" required error={errors.name} className="sm:col-span-2">
                <Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Glow Studio" autoFocus />
              </Field>
              <Field label="Industry" required error={errors.industryKey}>
                <NativeSelect value={form.industryKey} onChange={(e) => set("industryKey", e.target.value)}>
                  <option value="">Choose…</option>
                  {industries.data?.data.map((i) => (
                    <option key={i.key} value={i.key}>
                      {i.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="State" required hint="Used for GST on the invoice" error={errors.stateCode}>
                <NativeSelect value={form.stateCode} onChange={(e) => set("stateCode", e.target.value)}>
                  <option value="">Choose…</option>
                  {GST_STATES.map(([code, name]) => (
                    <option key={code} value={code}>
                      {name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="GSTIN" hint="Optional" error={errors.gstin} className="sm:col-span-2">
                <Input value={form.gstin} onChange={(e) => set("gstin", e.target.value.toUpperCase().replace(/\s/g, ""))} maxLength={15} placeholder="27ABCDE1234F1Z5" />
              </Field>
            </div>
          )}

          {step === 1 && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Owner's name" required error={errors.ownerName} className="sm:col-span-2">
                <Input value={form.ownerName} onChange={(e) => set("ownerName", e.target.value)} autoFocus />
              </Field>
              <Field label="Email" required error={errors.email}>
                <Input type="email" value={form.ownerEmail} onChange={(e) => (set("ownerEmail", e.target.value), setErrors((x) => ({ ...x, email: "" })))} />
              </Field>
              <Field label="Mobile" required error={errors.mobile}>
                <Input inputMode="tel" value={form.ownerMobile} onChange={(e) => (set("ownerMobile", e.target.value), setErrors((x) => ({ ...x, mobile: "" })))} placeholder="98765 43210" />
              </Field>
            </div>
          )}

          {step === 2 && (
            <div className="grid gap-5">
              {!partner && (
              <div className="flex w-fit rounded-xl border p-1" role="group" aria-label="Billing">
                {(["yearly", "monthly"] as const).map((c) => (
                  <button key={c} type="button" onClick={() => set("cycle", c)} aria-pressed={form.cycle === c} className={cn("h-8 rounded-lg px-4 text-[13px] font-medium", form.cycle === c ? "bg-accent text-accent-foreground" : "text-muted-foreground")}>
                    {c === "yearly" ? "Yearly" : "Monthly"}
                  </button>
                ))}
              </div>
              )}
              {!catalog.data ? (
                <Loading rows={2} />
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {plans.map((p) => {
                    const price = priceOf(p.key, cycle)
                    const on = planKey === p.key
                    return (
                      <button key={p.key} type="button" disabled={price === null} onClick={() => set("planKey", p.key)} aria-pressed={on} className={cn("relative rounded-2xl border p-4 text-left transition disabled:cursor-not-allowed disabled:opacity-50", on ? "border-primary bg-accent/40 ring-2 ring-primary/30" : "hover:border-primary/40")}>
                        {on && (
                          <span className="absolute top-3 right-3 grid size-5 place-items-center rounded-full bg-primary text-primary-foreground">
                            <Check className="size-3" />
                          </span>
                        )}
                        <div className="font-semibold">{p.name}</div>
                        {p.tagline && <div className="mt-0.5 text-[13px] text-muted-foreground">{p.tagline}</div>}
                        <div className="mt-3 text-xl font-semibold tabular-nums">
                          {price === null ? (
                            <span className="text-sm font-normal text-muted-foreground">{cycle === "yearly" ? "Monthly only" : "Yearly only"}</span>
                          ) : (
                            <>
                              {formatPaise(price, true)}
                              <span className="text-[13px] font-normal text-muted-foreground"> / {cycle === "yearly" ? "year" : "month"}{partner ? " list price" : ""}</span>
                            </>
                          )}
                        </div>
                        <div className="mt-1 text-[13px] text-muted-foreground">
                          {p.limits.users} users · {p.fullModules.length} modules
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
              {!partner && (
                <div>
                  <button type="button" onClick={() => setMore((m) => !m)} className="inline-flex items-center gap-1 text-[13px] font-medium text-primary">
                    <ChevronDown className={cn("size-4 transition", more && "rotate-180")} /> Extra users, discount or coupon
                  </button>
                  {more && (
                    <div className="mt-3 grid gap-4 sm:grid-cols-3">
                      <Field label="Extra users" error={errors.extraUsers}>
                        <Input type="number" min={0} max={500} value={form.extraUsers} onChange={(e) => set("extraUsers", e.target.value)} />
                      </Field>
                      <Field label="Discount %" hint={quote ? `Up to ${quote.discountLimitPercent}% without approval` : undefined} error={errors.discountPercent}>
                        <Input type="number" min={0} max={100} value={form.discountPercent} onChange={(e) => set("discountPercent", e.target.value)} />
                      </Field>
                      <Field label="Coupon" error={errors.couponCode}>
                        <Input value={form.couponCode} onChange={(e) => set("couponCode", e.target.value.toUpperCase())} />
                      </Field>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <FormError message={errors.form} />
          <div className="mt-6 flex items-center justify-between gap-2 border-t pt-4">
            <Button type="button" variant="ghost" onClick={() => (step ? setStep(step - 1) : router.push("/console/clients"))}>
              {step ? "Back" : "Cancel"}
            </Button>
            {step < 2 ? (
              <Button type="button" onClick={next}>
                Continue
              </Button>
            ) : (
              <Button type="button" onClick={submit} disabled={busy || !planKey || (!partner && !quote)}>
                {busy ? "Adding…" : partner ? "Add client" : quote?.needsApproval ? "Add and ask for approval" : "Add and send payment link"}
              </Button>
            )}
          </div>
        </Panel>

        <div className="lg:sticky lg:top-8 lg:self-start">
          <Panel title="Summary">
            <div className="grid gap-1 text-sm">
              <Line label="Business" value={form.name || "—"} />
              <Line label="Owner" value={form.ownerName || "—"} />
              <Line label="Plan" value={plans.find((p) => p.key === planKey)?.name ?? "—"} />
              <div className="my-2 border-t" />
              {partner ? (
                <>
                  <Line label="List price / month" value={money(partnerMonthly)} />
                  <Line label={`Your discount`} value={`${partner.discountPercent}%`} />
                  <Line label="You pay AHEAD / month" value={money(Math.round((partnerMonthly * (100 - partner.discountPercent)) / 100))} strong />
                  <p className="mt-2 text-xs text-muted-foreground">Plus GST, on your monthly bill. You set the client&apos;s own price.</p>
                </>
              ) : step < 2 ? (
                <Line label={form.cycle === "yearly" ? "Price / year" : "Price / month"} value={listPrice === null ? "—" : formatPaise(listPrice, true)} />
              ) : quoteError ? (
                <p className="text-sm text-destructive">{quoteError}</p>
              ) : quote ? (
                <>
                  <Line label="Price" value={formatPaise(quote.listPaise)} />
                  {quote.discountPaise > 0 && <Line label="Discount" value={`−${formatPaise(quote.discountPaise)}`} />}
                  <Line label={`GST ${quote.gstRateBp / 100}%`} value={formatPaise(quote.cgstPaise + quote.sgstPaise + quote.igstPaise)} />
                  <Line label="Total" value={formatPaise(quote.totalPaise)} strong />
                  {quote.needsApproval && (
                    <p className="mt-2 flex gap-2 rounded-xl bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-950/50 dark:text-amber-200">
                      <AlertTriangle className="size-4 shrink-0" /> Above your {quote.discountLimitPercent}% limit — a Super Admin approves it before the link is sent.
                    </p>
                  )}
                </>
              ) : (
                <Loading rows={1} />
              )}
            </div>
          </Panel>
        </div>
      </div>
    </Page>
  )
}
