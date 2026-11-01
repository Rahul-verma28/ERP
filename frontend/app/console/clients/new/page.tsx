"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { AlertTriangle, Check, CheckCircle2, ChevronDown } from "lucide-react"
import Link from "next/link"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { email as emailRule, gstin as gstinRule, gstinStateMismatch, length, mobileIN, personName } from "@contracts/validation"
import { industryByKey, storedIndustryKey } from "@contracts/workspace"
import { Field, FormError, NativeSelect } from "@/components/form"
import { Failed, Loading, Page, Panel, money } from "@/components/console/kit"
import { WizardRail, type OnboardingStepKey, type RailState } from "@/components/console/wizard-rail"
import { LoginLinkBox, type LoginLink } from "@/components/console/login-link"
import { api, ApiError, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useApi } from "@/lib/use-api"
import { useDebounced } from "@/lib/use-list"
import { formatPaise } from "@/lib/format"
import { IndustrySelect, StateSelect } from "@/components/search-select"
import type { Catalog, Quote } from "@/lib/console"
import { cn } from "@/lib/utils"
import { useConsoleBase } from "@/lib/console-base"

// Add client (Console v3): Business → Owner → How to start (free trial or a paid plan). The owner
// gets a login link by SMS and email and sets their own password; a paid client pays after
// signing in. A partner's client goes live straight away and is added to the partner's bill.

interface Created {
  tenantId: string
  status: string
  loginLink: LoginLink | null
  owner: { name: string; mobile: string; email: string }
}

interface Form {
  name: string
  industryKey: string
  subIndustry: string
  stateCode: string
  gstin: string
  ownerName: string
  ownerEmail: string
  ownerMobile: string
  start: "trial" | "paid"
  planKey: string
  cycle: "monthly" | "yearly"
  extraUsers: string
  discountPercent: string
  couponCode: string
}

const EMPTY: Form = { name: "", industryKey: "", subIndustry: "", stateCode: "", gstin: "", ownerName: "", ownerEmail: "", ownerMobile: "", start: "paid", planKey: "", cycle: "yearly", extraUsers: "0", discountPercent: "0", couponCode: "" }

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
  const base = useConsoleBase()
  const { me } = useAuth()
  const partner = me?.console?.partner ?? null
  const catalog = useApi<Catalog>("/console/catalog")
  const [form, setForm] = React.useState<Form>(EMPTY)
  const [step, setStep] = React.useState(0)
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [busy, setBusy] = React.useState(false)
  const [more, setMore] = React.useState(false)
  const [quote, setQuote] = React.useState<Quote | null>(null)
  const [quoteError, setQuoteError] = React.useState<string | null>(null)
  const [created, setCreated] = React.useState<Created | null>(null)
  const trial = !partner && form.start === "trial"
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
    if (partner || trial || step !== 2 || !p.planKey || !p.stateCode) return
    let cancelled = false
    api
      .post<Quote>("/console/quote", { planKey: p.planKey, cycle: p.cycle, addOns: [], extraUsers: Number(p.extraUsers) || 0, discountPercent: Number(p.discountPercent) || 0, couponCode: p.couponCode || null, stateCode: p.stateCode })
      .then((q) => !cancelled && (setQuote(q), setQuoteError(null)))
      .catch((e) => !cancelled && (setQuote(null), setQuoteError(errorMessage(e))))
    return () => {
      cancelled = true
    }
  }, [pricing, partner, trial, step])

  function check(s: number) {
    const e: Record<string, string> = {}
    if (s === 0) {
      const name = !form.name.trim() ? "Enter the business name" : length(2, 100, "Business name")(form.name)
      const gstin = form.gstin ? gstinRule(form.gstin) ?? gstinStateMismatch(form.gstin, form.stateCode) : null
      if (name) e.name = name
      if (!form.industryKey) e.industryKey = "Choose the industry"
      if (!form.stateCode) e.stateCode = "Choose the state"
      if (gstin) e.gstin = gstin
    }
    if (s === 1) {
      const name = !form.ownerName.trim() ? "Enter the owner's name" : personName(form.ownerName)
      const email = !form.ownerEmail.trim() ? "Enter the owner's email" : emailRule(form.ownerEmail)
      const mobile = !form.ownerMobile ? "Enter the owner's mobile number" : mobileIN(form.ownerMobile)
      if (name) e.ownerName = name
      if (email) e.email = email
      if (mobile) e.mobile = mobile
    }
    setErrors(e)
    return !Object.keys(e).length
  }

  const next = () => check(step) && setStep((s) => s + 1)
  const subs = industryByKey(form.industryKey)?.sub ?? []
  const order: OnboardingStepKey[] = ["business", "owner", "plan"]
  const railStates: Partial<Record<OnboardingStepKey, RailState>> = Object.fromEntries(order.map((k, i) => [k, i < step ? "done" : i === step ? "current" : "todo"]))

  /** setup = continue in the onboarding wizard (steps 4–7); otherwise send the login link now */
  async function submit(setup: boolean) {
    if (!check(0) || !check(1)) return
    setBusy(true)
    setErrors({})
    const business = { name: form.name, industryKey: storedIndustryKey(form.industryKey, form.subIndustry), gstin: form.gstin || null, stateCode: form.stateCode }
    const owner = { name: form.ownerName, email: form.ownerEmail, mobile: form.ownerMobile }
    try {
      const r = partner
        ? await api.post<Created>("/console/partner-clients", { business, owner, planKey, cycle, setup })
        : await api.post<Created>("/console/clients", {
            business,
            owner,
            start: form.start,
            setup,
            order: trial ? undefined : { planKey, cycle: form.cycle, addOns: [], extraUsers: Number(form.extraUsers) || 0, discountPercent: Number(form.discountPercent) || 0, couponCode: form.couponCode || null },
          })
      if (setup) {
        router.push(`${base}/onboarding/${r.tenantId}`)
        return
      }
      setCreated(r)
      setBusy(false)
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

  if (created)
    return (
      <Page title="Onboard a business" back={{ href: `${base}/clients`, label: "Businesses" }}>
        <Panel className="mx-auto w-full max-w-xl">
          <div className="grid gap-4 py-2 text-center">
            <CheckCircle2 className="mx-auto size-11 text-emerald-600" />
            <div>
              <h2 className="text-lg font-semibold text-balance">{form.name} is ready</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                We sent a login link to {created.owner.name} on {created.owner.mobile} (SMS) and {created.owner.email}.
                {created.status === "pending_approval" ? " The discount waits for an Admin's approval before they can pay." : trial ? " Their free trial has started." : partner ? "" : " They pay on the same screen after setting up their login."}
              </p>
            </div>
            {created.loginLink && <LoginLinkBox link={created.loginLink} mobile={created.owner.mobile} message={`Hi ${created.owner.name}, set up your login for ${form.name} on AHEAD:`} className="text-left" />}
            <div className="flex flex-wrap justify-center gap-2">
              <Link href={`${base}/clients/${created.tenantId}`} className={buttonVariants({ variant: "outline" })}>Open business</Link>
              <Button type="button" variant="ghost" onClick={() => (setCreated(null), setForm(EMPTY), setStep(0), setQuote(null))}>Add another</Button>
            </div>
          </div>
        </Panel>
      </Page>
    )

  return (
    <Page title="Onboard a business" subtitle={partner ? "The client goes live as soon as you finish. It appears on your next monthly bill." : "The owner gets a login link by SMS and email and sets their own password."} back={{ href: `${base}/clients`, label: "Businesses" }}>

      {catalog.error && <Failed error={catalog.error} onRetry={catalog.reload} />}

      <div className="grid gap-6 lg:grid-cols-[17rem_1fr] xl:grid-cols-[17rem_1fr_19rem]">
        <div className="lg:sticky lg:top-20 lg:self-start">
          <WizardRail states={railStates} />
        </div>
        <Panel title={step === 0 ? "About the business" : step === 1 ? "Who owns it" : partner ? "Choose a plan" : "How to start"} description={step === 1 ? "We send the login link to this mobile and email. If the email already has an AHEAD account, that person becomes the owner." : undefined}>
          {step === 0 && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Business name" required error={errors.name} className="sm:col-span-2">
                <Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Glow Studio" autoFocus />
              </Field>
              <Field label="Industry" required error={errors.industryKey}>
                <IndustrySelect value={form.industryKey} onChange={(v) => (set("industryKey", v), set("subIndustry", ""))} />
              </Field>
              <Field label="State" required hint="Used for GST on the invoice" error={errors.stateCode}>
                <StateSelect value={form.stateCode} onChange={(v) => set("stateCode", v)} />
              </Field>
              {subs.length > 0 && (
                <Field label="Type of business" hint="Optional. Sets up the right starting fields" className="sm:col-span-2">
                  <NativeSelect value={form.subIndustry} onChange={(e) => set("subIndustry", e.target.value)}>
                    <option value="">Choose…</option>
                    {subs.map((x) => <option key={x} value={x}>{x}</option>)}
                  </NativeSelect>
                </Field>
              )}
              <Field label="GSTIN" hint="Optional" error={errors.gstin} className="sm:col-span-2">
                <Input mask="gstin" value={form.gstin} onChange={(e) => set("gstin", e.target.value)} placeholder="27ABCDE1234F1Z5" />
              </Field>
            </div>
          )}

          {step === 1 && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Owner's name" required error={errors.ownerName} className="sm:col-span-2">
                <Input mask="name" value={form.ownerName} onChange={(e) => set("ownerName", e.target.value)} autoFocus />
              </Field>
              <Field label="Email" required error={errors.email}>
                <Input mask="email" type="email" value={form.ownerEmail} onChange={(e) => (set("ownerEmail", e.target.value), setErrors((x) => ({ ...x, email: "" })))} />
              </Field>
              <Field label="Mobile" required error={errors.mobile}>
                <Input mask="mobile" value={form.ownerMobile} onChange={(e) => (set("ownerMobile", e.target.value), setErrors((x) => ({ ...x, mobile: "" })))} placeholder="98765 43210" />
              </Field>
            </div>
          )}

          {step === 2 && (
            <div className="grid gap-5">
              {!partner && (
                <div className="grid gap-3 sm:grid-cols-2" role="group" aria-label="How to start">
                  {([
                    ["trial", "Free trial", "All modules for the trial period. No payment now."],
                    ["paid", "Paid plan", "Choose a plan. The owner pays after setting up their login."],
                  ] as const).map(([key, title, text]) => (
                    <button key={key} type="button" onClick={() => set("start", key)} aria-pressed={form.start === key} className={cn("rounded-2xl border p-4 text-left transition", form.start === key ? "border-primary bg-accent/40 ring-2 ring-primary/30" : "hover:border-primary/40")}>
                      <div className="font-semibold">{title}</div>
                      <div className="mt-0.5 text-[13px] text-muted-foreground">{text}</div>
                    </button>
                  ))}
                </div>
              )}
              {!partner && !trial && (
              <div className="flex w-fit rounded-xl border p-1" role="group" aria-label="Billing">
                {(["yearly", "monthly"] as const).map((c) => (
                  <button key={c} type="button" onClick={() => set("cycle", c)} aria-pressed={form.cycle === c} className={cn("h-8 rounded-lg px-4 text-[13px] font-medium", form.cycle === c ? "bg-accent text-accent-foreground" : "text-muted-foreground")}>
                    {c === "yearly" ? "Yearly" : "Monthly"}
                  </button>
                ))}
              </div>
              )}
              {trial ? null : !catalog.data ? (
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
              {!partner && !trial && (
                <div>
                  <button type="button" onClick={() => setMore((m) => !m)} className="inline-flex items-center gap-1 text-[13px] font-medium text-primary">
                    <ChevronDown className={cn("size-4 transition", more && "rotate-180")} /> Extra users, discount or coupon
                  </button>
                  {more && (
                    <div className="mt-3 grid gap-4 sm:grid-cols-3">
                      <Field label="Extra users" error={errors.extraUsers}>
                        <Input type="number" min={0} max={500} value={form.extraUsers} onChange={(e) => set("extraUsers", e.target.value)} />
                      </Field>
                      {/* Console v3: one discount per order — a manual discount or a coupon */}
                      <Field label="Discount %" hint={form.couponCode ? "Not with a coupon" : quote ? `Up to ${quote.discountLimitPercent}% without approval` : undefined} error={errors.discountPercent}>
                        <Input type="number" min={0} max={100} value={form.discountPercent} disabled={!!form.couponCode} onChange={(e) => set("discountPercent", e.target.value)} />
                      </Field>
                      <Field label="Coupon" hint={Number(form.discountPercent) > 0 ? "Not with a discount" : undefined} error={errors.couponCode}>
                        <Input mask="code" value={form.couponCode} disabled={Number(form.discountPercent) > 0} onChange={(e) => set("couponCode", e.target.value)} />
                      </Field>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <FormError message={errors.form} />
          <div className="mt-6 flex items-center justify-between gap-2 border-t pt-4">
            <Button type="button" variant="ghost" onClick={() => (step ? setStep(step - 1) : router.push(`${base}/clients`))}>
              {step ? "Back" : "Cancel"}
            </Button>
            {step < 2 ? (
              <Button type="button" onClick={next}>
                Continue
              </Button>
            ) : (
              <div className="flex flex-wrap justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => submit(false)} disabled={busy || (!trial && (!planKey || (!partner && !quote)))}>
                  Create &amp; send login link now
                </Button>
                <Button type="button" onClick={() => submit(true)} disabled={busy || (!trial && (!planKey || (!partner && !quote)))}>
                  {busy ? "Creating…" : quote?.needsApproval ? "Create (needs approval) & continue set-up" : "Create & continue set-up"}
                </Button>
              </div>
            )}
          </div>
        </Panel>

        <div className="lg:col-start-2 xl:col-start-3 xl:sticky xl:top-20 xl:self-start">
          <Panel title="Summary">
            <div className="grid gap-1 text-sm">
              <Line label="Business" value={form.name || "—"} />
              <Line label="Owner" value={form.ownerName || "—"} />
              <Line label="Plan" value={trial ? "Free trial" : plans.find((p) => p.key === planKey)?.name ?? "—"} />
              <div className="my-2 border-t" />
              {trial ? (
                <p className="text-sm text-muted-foreground">Nothing to pay now. When the trial ends, the client chooses a plan or moves to Free.</p>
              ) : partner ? (
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
                      <AlertTriangle className="size-4 shrink-0" /> Above your {quote.discountLimitPercent}% limit — an Admin approves it before the link is sent.
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
