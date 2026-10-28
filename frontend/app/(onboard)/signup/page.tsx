"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { captureReferral, referralFields } from "@/lib/referral"
import { ArrowLeft, Check, Loader2, Search, Sparkles } from "lucide-react"
import {
  BUSINESS_TYPES,
  cleanMobile,
  email as emailRule,
  emailSuggestion,
  gstin as gstinRule,
  gstinStateMismatch,
  length,
  mobileIN,
  panTypeMismatch,
  type BusinessType,
  password as passwordRule,
  passwordStrength,
  personName,
  squish,
  stateName,
  upperNoSpaces,
} from "@contracts/validation"
import { BRANCH_BANDS, BRANCH_BAND_LABEL, GOALS, HEARD_FROM, INDUSTRY_GROUPS, TEAM_SIZES, TEAM_SIZE_LABEL, industryByKey, type INDUSTRIES } from "@contracts/workspace"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { ErrorSummary, Field, FormError, NativeSelect } from "@/components/form"
import { ChoiceChip, OtpInput, SignupRail, StepProgress, type RailStep } from "@/components/onboarding"
import { IndustryIcon } from "@/components/industry-icon"
import { api, ApiError } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { GST_STATES } from "@/lib/format"
import { MODULE_NAV } from "@/lib/nav"
import { useApi } from "@/lib/use-api"
import { useForm } from "@/lib/use-form"
import { useAsyncCheck } from "@/lib/use-unsaved"
import { cn } from "@/lib/utils"

// Signup v2 (Phase 1 wireframes 1.1–1.6): Account → Business → Industry → Goals → Verify,
// with a resumable draft, live checks, and the "already registered" / "duplicate trial" exits.

interface TemplateInfo {
  key: string
  name: string
  modules: string[]
  terms: Record<string, string>
  fields: string[]
  dashboard: string[]
  starterItems: number
}
interface IndustriesResponse {
  data: TemplateInfo[]
  industries: (typeof INDUSTRIES)[number][]
  groups: string[]
}

type StepKey = "account" | "business" | "industry" | "goals" | "verify"
const DRAFT_KEY = "ahead:signup-draft"
const DRAFT_DAYS = 7

const EMPTY = {
  name: "",
  email: "",
  mobile: "",
  password: "",
  terms: false,
  businessName: "",
  businessType: "",
  gstRegistered: "",
  gstin: "",
  composition: false,
  stateCode: "",
  teamSize: "",
  branches: "",
  industryKey: "",
  subIndustry: "",
  industryRequested: "",
  goals: [] as string[],
  modules: [] as string[],
  heardFrom: "",
  couponCode: "",
  marketingOptIn: true,
  otp: "",
}
type Values = typeof EMPTY

const STEP_FIELDS: Record<StepKey, (keyof Values)[]> = {
  account: ["name", "email", "mobile", "password", "terms"],
  business: ["businessName", "businessType", "gstRegistered", "gstin", "stateCode", "teamSize", "branches"],
  industry: ["industryKey", "industryRequested"],
  goals: ["goals", "couponCode"],
  verify: ["otp"],
}
const STEP_LABELS: Partial<Record<keyof Values, string>> = {
  name: "Full name", email: "Email", mobile: "Mobile", password: "Password", terms: "Terms", businessName: "Business name", businessType: "Business type",
  gstRegistered: "GST registration", gstin: "GSTIN", stateCode: "State", teamSize: "Team size", branches: "Locations", industryKey: "Industry",
  industryRequested: "What your business does", goals: "What you want to manage", otp: "Code",
}
const SERVER_FIELD: Partial<Record<string, keyof Values>> = { termsAccepted: "terms", mobileVerificationToken: "otp" }

/** Modules that are built and can be picked (others show "Soon"). */
const LIVE_MODULES = MODULE_NAV.filter((m) => m.phase === 1).map((m) => m.key as string)
const NEEDS: Record<string, string[]> = { billing: ["catalog"], sales: ["catalog"] }

function recommendModules(goals: string[], template?: TemplateInfo) {
  const fromGoals = GOALS.filter((g) => goals.includes(g.key)).flatMap((g) => g.modules as readonly string[])
  const order = [...new Set([...fromGoals, ...(template?.modules ?? [])])]
  const withDeps = [...new Set(order.flatMap((m) => [m, ...(NEEDS[m] ?? [])]))]
  return withDeps.filter((m) => LIVE_MODULES.includes(m))
}

function readDraft(): (Partial<Values> & { savedAt?: number; step?: StepKey }) | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY)
    if (!raw) return null
    const d = JSON.parse(raw)
    if (!d.savedAt || Date.now() - d.savedAt > DRAFT_DAYS * 86_400_000) return null
    return d
  } catch {
    return null
  }
}
const clearDraft = () => {
  try {
    localStorage.removeItem(DRAFT_KEY)
  } catch {
    // ignore
  }
}

export default function SignupPage() {
  return (
    <React.Suspense fallback={<div className="grid min-h-svh place-items-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>}>
      <SignupFlow />
    </React.Suspense>
  )
}

function SignupFlow() {
  const router = useRouter()
  const params = useSearchParams()
  const { status, me, signIn } = useAuth()
  const addBusiness = params.get("mode") === "business"
  const catalog = useApi<IndustriesResponse>("/public/industries")
  // A vendor's referral link credits them, even if the visitor signs up days later
  React.useEffect(() => captureReferral(), [])
  const steps: StepKey[] = addBusiness ? ["business", "industry", "goals", "verify"] : ["account", "business", "industry", "goals", "verify"]
  const [stepIndex, setStepIndex] = React.useState(0)
  const [returnToReview, setReturnToReview] = React.useState(false)
  const [screen, setScreen] = React.useState<"form" | "resume" | "duplicate">("form")
  const [draftChecked, setDraftChecked] = React.useState(false)
  const step = steps[stepIndex]

  // Signed-in user on plain /signup → their workspace; "add business" needs a session.
  // Not right after creating one here: that goes to the loading screen instead.
  const createdRef = React.useRef(false)
  React.useEffect(() => {
    if (!addBusiness && status === "authenticated" && !createdRef.current) router.replace(me?.workspace === "console" ? "/console" : "/app")
    if (addBusiness && status === "anonymous") router.replace(`/login?next=${encodeURIComponent("/signup?mode=business")}`)
  }, [addBusiness, status, me, router])

  const form = useForm<Values>({
    initial: EMPTY,
    labels: STEP_LABELS,
    clean: { name: squish, email: (v) => v.trim().toLowerCase(), mobile: cleanMobile, businessName: squish, gstin: upperNoSpaces, couponCode: (v) => v.trim().toUpperCase(), industryRequested: squish },
    fromServer: (path) => SERVER_FIELD[path] ?? (path in EMPTY ? (path as keyof Values) : path === "stateCode" ? "stateCode" : undefined),
    rules: {
      name: (v) => (!v.trim() ? "Enter your name" : personName(v)),
      email: (v) => (!v.trim() ? "Enter your email" : emailRule(v)),
      mobile: (v) => (!v.trim() ? "Enter your mobile number" : mobileIN(v)),
      password: (v) => (!v ? "Choose a password" : passwordRule(v)),
      terms: (v) => (v ? null : "Please accept the Terms and Privacy Policy"),
      businessName: (v) => (!v.trim() ? "Enter your business name" : length(2, 100, "Business name")(v)),
      businessType: (v) => (v ? null : "Choose your business type"),
      gstRegistered: (v) => (v ? null : "Tell us if you're registered for GST"),
      gstin: (v, all) => (all.gstRegistered !== "yes" ? null : !v ? "Enter your GSTIN" : gstinRule(v) ?? gstinStateMismatch(v, all.stateCode) ?? panTypeMismatch(upperNoSpaces(v).slice(2, 12), (all.businessType || null) as BusinessType | null)),
      stateCode: (v) => (v ? null : "Choose your state — it decides CGST + SGST or IGST"),
      teamSize: (v) => (v ? null : "Choose your team size"),
      branches: (v) => (v ? null : "Choose how many locations you have"),
      industryKey: (v) => (v ? null : "Choose your industry"),
      industryRequested: (v, all) => (all.industryKey === "other" && squish(v).length < 3 ? "Tell us what your business does (3+ characters)" : null),
      goals: (v) => (v.length ? null : "Pick at least one"),
      otp: (v) => (step === "verify" && !addBusiness && v.length !== 6 ? "Enter the 6-digit code" : null),
    },
    onSubmit: async () => undefined,
  })
  const v = form.values

  // Resume an unfinished signup (never the password)
  React.useEffect(() => {
    if (draftChecked || addBusiness) return
    // After mount: the draft lives only in this browser, so the server render can't know it
    const t = setTimeout(() => {
      const d = readDraft()
      setDraftChecked(true)
      if (d && (d.name || d.businessName)) setScreen("resume")
    }, 0)
    return () => clearTimeout(t)
  }, [draftChecked, addBusiness])
  React.useEffect(() => {
    if (!draftChecked || addBusiness || screen !== "form") return
    const { password: _p, otp: _o, ...rest } = v
    void _p
    void _o
    if (!rest.name && !rest.email && !rest.businessName) return
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...rest, step, savedAt: Date.now() }))
    } catch {
      // ignore
    }
  }, [v, step, draftChecked, addBusiness, screen])

  const templates = catalog.data?.data ?? []
  const industry = v.industryKey ? industryByKey(v.industryKey) : undefined
  const template = templates.find((t) => t.key === industry?.template)

  const goTo = (key: StepKey) => setStepIndex(Math.max(0, steps.indexOf(key)))
  const next = () => {
    if (!form.check(STEP_FIELDS[step])) return
    if (step === "goals" && !v.modules.length) form.set("modules", recommendModules(v.goals, template))
    if (returnToReview) {
      setReturnToReview(false)
      goTo("verify")
      return
    }
    setStepIndex((i) => Math.min(steps.length - 1, i + 1))
    window.scrollTo({ top: 0, behavior: "smooth" })
  }
  const back = () => setStepIndex((i) => Math.max(0, i - 1))
  const editFromReview = (key: StepKey) => {
    setReturnToReview(true)
    goTo(key)
  }

  const businessBody = () => ({
    businessName: v.businessName,
    businessType: v.businessType,
    gstRegistered: v.gstRegistered === "yes",
    gstin: v.gstRegistered === "yes" ? v.gstin : "",
    composition: v.gstRegistered === "yes" && v.composition,
    stateCode: v.stateCode,
    teamSize: v.teamSize,
    branches: v.branches,
    industryKey: v.industryKey,
    subIndustry: v.subIndustry,
    industryRequested: v.industryRequested,
    goals: v.goals,
    modules: v.modules.length ? v.modules : recommendModules(v.goals, template),
    heardFrom: v.heardFrom,
    couponCode: v.couponCode,
    ...referralFields(),
    marketingOptIn: v.marketingOptIn,
    termsAccepted: addBusiness ? true : v.terms,
  })

  /** Send the API's field errors back to the step that owns the first one. */
  const showServerErrors = (err: ApiError) => {
    const mapped: Partial<Record<keyof Values, string>> = {}
    for (const [path, msg] of Object.entries(err.fields)) {
      const key = SERVER_FIELD[path] ?? (path in EMPTY ? (path as keyof Values) : undefined)
      if (key) mapped[key] = msg
    }
    const first = steps.find((s) => STEP_FIELDS[s].some((k) => mapped[k]))
    if (first) goTo(first)
    form.setServerErrors(mapped)
    if (!first) form.setFormError(err.message)
  }

  const [submitting, setSubmitting] = React.useState(false)
  const create = async (code?: string) => {
    if (submitting) return
    if (!addBusiness && (code ?? v.otp).length !== 6) return form.check(["otp"])
    setSubmitting(true)
    form.setFormError(null)
    try {
      let token: string
      if (addBusiness) {
        token = (await api.post<{ accessToken: string }>("/auth/businesses", businessBody())).accessToken
      } else {
        const mobile = cleanMobile(v.mobile)
        const { verificationToken } = await api.post<{ verificationToken: string }>("/auth/otp/verify", { target: mobile, purpose: "signup", code: code ?? v.otp })
        token = (
          await api.post<{ accessToken: string }>("/auth/signup", {
            name: v.name, email: v.email, mobile, password: v.password, mobileVerificationToken: verificationToken, ...businessBody(),
          })
        ).accessToken
      }
      clearDraft()
      createdRef.current = true
      await signIn(token)
      router.replace("/app/welcome")
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === "DUPLICATE_TRIAL") setScreen("duplicate")
        else if (err.code === "EMAIL_TAKEN") {
          goTo("account")
          form.setServerErrors({ email: err.message })
        } else if (err.code === "MOBILE_TAKEN") {
          goTo("account")
          form.setServerErrors({ mobile: err.message })
        } else if (err.code === "OTP_INVALID") {
          const left = err.details?.attemptsLeft
          form.setServerErrors({ otp: typeof left === "number" ? `${err.message} ${left} ${left === 1 ? "try" : "tries"} left.` : err.message })
        } else if (err.code === "VALIDATION_FAILED") showServerErrors(err)
        else form.setFormError(err.requestId ? `${err.message} (reference ${err.requestId.slice(-8).toUpperCase()})` : err.message)
      } else form.setFormError("Something went wrong. Please try again.")
    } finally {
      setSubmitting(false)
    }
  }

  if (screen === "resume") {
    const d = readDraft()
    return (
      <EdgeScreen title="Continue where you left off?">
        <p>
          You started signing up {d?.businessName ? <strong>{d.businessName}</strong> : "a business"} on this device. Your details are saved here (not your password).
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => {
              const { savedAt: _s, step: savedStep, ...rest } = d ?? {}
              void _s
              form.reset({ ...EMPTY, ...rest })
              setStepIndex(savedStep && savedStep !== "account" && savedStep !== "verify" ? steps.indexOf(savedStep) : 0)
              setScreen("form")
            }}
          >
            Continue
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              clearDraft()
              setScreen("form")
            }}
          >
            Start again
          </Button>
        </div>
      </EdgeScreen>
    )
  }

  if (screen === "duplicate") {
    return (
      <EdgeScreen title="A free trial was already used">
        <p>These details were used for an AHEAD trial before, so we can&apos;t start another one. You can still start right away on a paid plan — your answers are saved.</p>
        <div className="flex flex-wrap gap-2">
          <Link href="/#pricing" className="inline-flex h-9 items-center rounded-4xl bg-primary px-4 text-sm font-medium text-primary-foreground">
            Choose a plan
          </Link>
          <a href="mailto:sales@ahead.software?subject=Start%20AHEAD%20on%20a%20paid%20plan" className="inline-flex h-9 items-center rounded-4xl border px-4 text-sm font-medium">
            Talk to sales
          </a>
        </div>
        <button className="text-sm text-muted-foreground underline-offset-4 hover:underline" onClick={() => setScreen("form")}>
          ← Back to my details
        </button>
      </EdgeScreen>
    )
  }

  const rail: RailStep[] = steps.map((s, i) => ({
    key: s,
    label: { account: "Account", business: "Business", industry: "Industry", goals: "What you manage", verify: addBusiness ? "Review" : "Verify" }[s],
    state: i < stepIndex ? "done" : i === stepIndex ? "current" : "todo",
    summary:
      i < stepIndex
        ? {
            account: `${v.name} · ${v.email}`,
            business: [v.businessName, stateName(v.stateCode)].filter(Boolean).join(" · "),
            industry: [industry?.name, v.subIndustry].filter(Boolean).join(" · "),
            goals: `${v.goals.length} picked`,
            verify: "",
          }[s]
        : undefined,
  }))

  return (
    <div className="flex min-h-svh bg-card">
      <SignupRail
        steps={rail}
        narrow={step === "industry" || step === "goals" || step === "verify"}
        footer={addBusiness ? "Adds a new business to your login. Switch between businesses from the top bar." : "15-day free trial · every module unlocked · no card needed. Your data stays if you don't upgrade."}
      />
      <main className="flex flex-1 justify-center px-4 py-8 sm:px-10">
        <form
          {...form.formProps}
          className={cn("grid w-full content-start gap-3.5", step === "account" ? "max-w-[480px]" : step === "business" ? "max-w-[560px]" : "max-w-5xl")}
          onSubmit={(e) => {
            e.preventDefault()
            if (step === "verify") void create()
            else next()
          }}
        >
          <div className="flex items-center justify-between lg:hidden">
            <Link href="/" className="font-extrabold tracking-wider">
              AHEAD
            </Link>
          </div>
          <StepProgress
            index={stepIndex}
            total={steps.length}
            right={
              !addBusiness && (
                <span>
                  Already have an account?{" "}
                  <Link href="/login" className="font-medium text-foreground underline-offset-4 hover:underline">
                    Sign in
                  </Link>
                </span>
              )
            }
          />
          <ErrorSummary fields={STEP_FIELDS[step].filter((k) => form.errors[k]).map((k) => STEP_LABELS[k] ?? k)} show action="continue" />

          {step === "account" && <AccountStep form={form} />}
          {step === "business" && <BusinessStep form={form} />}
          {step === "industry" && <IndustryStep form={form} catalog={catalog.data ?? undefined} loading={!catalog.data && !catalog.error} template={template} />}
          {step === "goals" && <GoalsStep form={form} template={template} />}
          {step === "verify" && (
            <VerifyStep form={form} addBusiness={addBusiness} template={template} onEdit={editFromReview} onCodeComplete={(c) => void create(c)} submitting={submitting} onChangeNumber={() => editFromReview("account")} />
          )}

          <FormError message={form.formError} />
          {step === "account" && (
            <Button type="submit" size="lg" className="w-full" disabled={submitting}>
              {returnToReview ? "Save & back to review" : "Continue"}
            </Button>
          )}
          {step !== "account" && step !== "verify" && (
          <div className="mt-1.5 flex items-center justify-between gap-3">
            {stepIndex > 0 ? (
              <Button type="button" variant="outline" onClick={back} disabled={submitting}>
                <ArrowLeft /> Back
              </Button>
            ) : (
              <span />
            )}
            <Button type="submit" size="lg" disabled={submitting}>
              {returnToReview ? "Save & back to review" : "Continue"}
            </Button>
          </div>
          )}
        </form>
      </main>
    </div>
  )
}

type SignupForm = ReturnType<typeof useForm<Values>>

function EdgeScreen({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="grid min-h-svh place-items-center bg-muted/40 px-4">
      <div className="grid w-full max-w-lg gap-4 rounded-4xl bg-card p-8 text-sm leading-relaxed shadow-md ring-1 ring-foreground/5">
        <Link href="/" className="font-extrabold tracking-wider">
          AHEAD
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {children}
      </div>
    </div>
  )
}

function StepTitle({ title, description }: { title: string; description?: string }) {
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
      {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
    </div>
  )
}

const STRENGTH = [
  { label: "", tone: "bg-muted" },
  { label: "Weak", tone: "bg-destructive" },
  { label: "Fair", tone: "bg-amber-500" },
  { label: "Good", tone: "bg-emerald-500" },
  { label: "Strong", tone: "bg-emerald-600" },
]

function AccountStep({ form }: { form: SignupForm }) {
  const v = form.values
  const [show, setShow] = React.useState(false)
  const emailOk = !!v.email && !emailRule(v.email)
  const mobileOk = !!v.mobile && !mobileIN(v.mobile)
  const emailCheck = useAsyncCheck(emailOk ? v.email.trim().toLowerCase() : "", async (e) => ((await api.get<{ email: boolean }>(`/public/signup/check?email=${encodeURIComponent(e)}`)).email ? "taken" : null))
  const mobileCheck = useAsyncCheck(mobileOk ? cleanMobile(v.mobile) : "", async (m) => ((await api.get<{ mobile: boolean }>(`/public/signup/check?mobile=${m}`)).mobile ? "taken" : null))
  const strength = passwordStrength(v.password)
  const suggestion = emailOk ? emailSuggestion(v.email) : null
  const takenNote = (what: string) => (
    <>
      This {what} already has an AHEAD account.{" "}
      <Link href="/login" className="font-medium underline underline-offset-2">
        Sign in
      </Link>{" "}
      or{" "}
      <Link href={`/login?next=${encodeURIComponent("/signup?mode=business")}`} className="font-medium underline underline-offset-2">
        add another business
      </Link>
    </>
  )

  return (
    <>
      <StepTitle title="Create your account" />
      {/* Google sign-up needs an OAuth client (TASKS: Phase 1 "Not built yet"); shown as drawn, not active */}
      <Button type="button" variant="outline" size="lg" className="w-full" disabled title="Google sign-up is coming soon">
        <svg viewBox="0 0 24 24" className="size-[18px]" aria-hidden>
          <path fill="#4285F4" d="M22.6 12.2c0-.8-.1-1.5-.2-2.2H12v4.2h5.9a5 5 0 0 1-2.2 3.3v2.7h3.6c2.1-1.9 3.3-4.8 3.3-8z" />
          <path fill="#34A853" d="M12 23c3 0 5.5-1 7.3-2.7l-3.6-2.7c-1 .7-2.2 1.1-3.7 1.1-2.9 0-5.3-1.9-6.2-4.5H2.1v2.8A11 11 0 0 0 12 23z" />
          <path fill="#FBBC05" d="M5.8 14.2a6.6 6.6 0 0 1 0-4.3V7.1H2.1a11 11 0 0 0 0 9.9z" />
          <path fill="#EA4335" d="M12 5.4c1.6 0 3.1.6 4.2 1.7l3.2-3.2A11 11 0 0 0 2.1 7.1l3.7 2.8C6.7 7.3 9.1 5.4 12 5.4z" />
        </svg>
        Continue with Google
        <span className="ml-1 rounded-full bg-muted px-1.5 text-[10px] font-semibold text-muted-foreground">Soon</span>
      </Button>
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span className="h-px flex-1 bg-border" />
        or with email
        <span className="h-px flex-1 bg-border" />
      </div>
      <div className="grid gap-3.5">
        <Field label="Full name" required error={form.errors.name}>
          <Input {...form.field("name")} autoComplete="name" autoFocus />
        </Field>
        <Field
          label="Work email"
          required
          error={form.errors.email ?? (emailCheck.status === "error" ? (takenNote("email")) : null)}
          checking={emailCheck.status === "checking"}
          hint={
            suggestion ? (
              <>
                Did you mean{" "}
                <button type="button" className="font-medium text-primary underline-offset-2 hover:underline" onClick={() => form.set("email", suggestion)}>
                  {suggestion}
                </button>
                ?
              </>
            ) : undefined
          }
        >
          <Input {...form.field("email")} type="email" inputMode="email" autoComplete="email" />
        </Field>
        <Field
          label="Mobile"
          required
          error={form.errors.mobile ?? (mobileCheck.status === "error" ? (takenNote("mobile number")) : null)}
          checking={mobileCheck.status === "checking"}
          hint="We'll send a code to verify it at the last step"
        >
          <div className="flex gap-2">
            <span className="grid h-9 w-14 shrink-0 place-items-center rounded-3xl bg-muted text-sm text-muted-foreground">+91</span>
            <Input {...form.field("mobile")} inputMode="tel" autoComplete="tel-national" placeholder="98765 43210" />
          </div>
        </Field>
        <Field
          label="Password"
          required
          error={form.errors.password}
          hint={[v.password ? STRENGTH[strength].label : "", v.password && strength < 4 ? (strength < 3 ? "add a symbol or make it longer" : "add a symbol") : "", "8+ characters with a letter and a number"].filter(Boolean).join(" · ")}
        >
          <div className="grid gap-2">
            <div className="relative">
              <Input {...form.field("password")} type={show ? "text" : "password"} autoComplete="new-password" className="pr-14" />
              <button type="button" className="absolute top-1/2 right-3 -translate-y-1/2 text-xs font-semibold text-primary hover:underline" onClick={() => setShow((s) => !s)} aria-label={show ? "Hide password" : "Show password"}>
                {show ? "Hide" : "Show"}
              </button>
            </div>
            {v.password && (
              <div className="flex items-center gap-2" aria-live="polite">
                <div className="flex flex-1 gap-1">
                  {[1, 2, 3, 4].map((i) => (
                    <span key={i} className={cn("h-1 flex-1 rounded-full", i <= strength ? STRENGTH[strength].tone : "bg-muted")} />
                  ))}
                </div>
              </div>
            )}
          </div>
        </Field>
      </div>
      <label className="flex items-start gap-3 text-sm">
        <Checkbox name="terms" checked={v.terms} onCheckedChange={(c) => form.set("terms", !!c)} aria-invalid={!!form.errors.terms || undefined} className="mt-0.5" />
        <span>
          I agree to the{" "}
          <Link href="/terms" target="_blank" className="font-medium underline underline-offset-2">
            Terms of Service
          </Link>{" "}
          and{" "}
          <Link href="/privacy" target="_blank" className="font-medium underline underline-offset-2">
            Privacy Policy
          </Link>
          {form.errors.terms && <span className="mt-1 block text-xs text-destructive">{form.errors.terms}</span>}
        </span>
      </label>
    </>
  )
}

/** 4th PAN letter → holder type */
const PAN_HOLDER_LABEL: Record<string, string> = { P: "Individual / proprietor", F: "Firm / LLP", C: "Company", H: "HUF", T: "Trust", A: "Association of persons", B: "Body of individuals", G: "Government", L: "Local authority", J: "Artificial juridical person" }

function BusinessStep({ form }: { form: SignupForm }) {
  const v = form.values
  const gstOk = v.gstRegistered === "yes" && v.gstin.length === 15 && !gstinRule(v.gstin)
  // A valid GSTIN decides the state
  React.useEffect(() => {
    if (gstOk && v.stateCode !== v.gstin.slice(0, 2)) form.set("stateCode", v.gstin.slice(0, 2))
  }, [gstOk, v.gstin, v.stateCode, form])

  return (
    <>
      <StepTitle title="Tell us about your business" description="Everything here can be changed later in Settings." />
      <Field label="Business name" required error={form.errors.businessName} hint="Printed on invoices and receipts">
        <Input {...form.field("businessName")} autoComplete="organization" autoFocus />
      </Field>
      <fieldset className="grid gap-2">
        <legend className="mb-2 text-sm font-medium">
          Business type<span className="text-destructive">*</span>
        </legend>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Business type">
          {BUSINESS_TYPES.map((t) => (
            <ChoiceChip key={t.key} selected={v.businessType === t.key} onClick={() => form.set("businessType", t.key)}>
              {t.label}
            </ChoiceChip>
          ))}
        </div>
        {form.errors.businessType && <p className="text-xs text-destructive">{form.errors.businessType}</p>}
      </fieldset>
      <fieldset className="grid gap-2">
        <legend className="mb-2 text-sm font-medium">
          Is your business registered for GST?<span className="text-destructive">*</span>
        </legend>
        <div className="flex gap-2" role="radiogroup" aria-label="GST registration">
          <ChoiceChip selected={v.gstRegistered === "yes"} onClick={() => form.set("gstRegistered", "yes")}>
            Yes
          </ChoiceChip>
          <ChoiceChip selected={v.gstRegistered === "no"} onClick={() => form.set("gstRegistered", "no")}>
            No
          </ChoiceChip>
        </div>
        {form.errors.gstRegistered && <p className="text-xs text-destructive">{form.errors.gstRegistered}</p>}
      </fieldset>
      {v.gstRegistered === "yes" && (
        <>
          <Field label="GSTIN" required error={form.errors.gstin} hint={gstOk ? undefined : "15 characters, e.g. 27ABCDE1234F1Z5"}>
            <div className="flex gap-2">
              <Input {...form.field("gstin")} maxLength={15} className="font-mono uppercase" spellCheck={false} autoCapitalize="characters" data-valid={gstOk && !form.errors.gstin ? "true" : undefined} />
              {/* Needs a GST Suvidha Provider API to look up the legal name and address */}
              <Button type="button" variant="outline" className="shrink-0" disabled title="Fetching details from the GST network is coming soon">
                Fetch details
              </Button>
            </div>
          </Field>
          {gstOk && !form.errors.gstin && (
            <div className="rounded-[10px] border border-[#BFE0CC] bg-[#F1F8F4] px-3.5 py-3 text-[13px] leading-relaxed dark:border-emerald-900 dark:bg-emerald-950/40">
              <p className="font-bold text-[#1F7A4D] dark:text-emerald-400">✓ GSTIN is valid</p>
              <p>
                State: <strong>{stateName(v.gstin.slice(0, 2))} ({v.gstin.slice(0, 2)})</strong> · PAN <strong className="font-mono">{v.gstin.slice(2, 12)}</strong> · {PAN_HOLDER_LABEL[v.gstin[5]] ?? "Other"}
              </p>
            </div>
          )}
          <label className="flex items-center gap-2.5 text-[13px]">
            <Checkbox checked={v.composition} onCheckedChange={(c) => form.set("composition", !!c)} />
            I&apos;m registered under the Composition scheme
          </label>
        </>
      )}
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="State" required error={form.errors.stateCode} hint={gstOk ? "Taken from your GSTIN" : undefined}>
          <NativeSelect {...form.field("stateCode")} disabled={gstOk}>
            <option value="">Select state</option>
            {GST_STATES.map(([code, name]) => (
              <option key={code} value={code}>
                {name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Team size" required error={form.errors.teamSize}>
          <NativeSelect {...form.field("teamSize")}>
            <option value="">Choose</option>
            {TEAM_SIZES.map((t) => (
              <option key={t} value={t}>
                {TEAM_SIZE_LABEL[t]}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Locations" required error={form.errors.branches} hint={v.branches && v.branches !== "1" ? "More branches come with Growth and up" : undefined}>
          <NativeSelect {...form.field("branches")}>
            <option value="">Choose</option>
            {BRANCH_BANDS.map((b) => (
              <option key={b} value={b}>
                {BRANCH_BAND_LABEL[b]}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>
    </>
  )
}

const humanize = (k: string) => k.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase())

function IndustryStep({ form, catalog, loading, template }: { form: SignupForm; catalog?: IndustriesResponse; loading: boolean; template?: TemplateInfo }) {
  const v = form.values
  const [query, setQuery] = React.useState("")
  const q = query.trim().toLowerCase()
  const list = (catalog?.industries ?? []).filter((i) => !q || `${i.name} ${i.keywords ?? ""} ${i.sub.join(" ")}`.toLowerCase().includes(q))
  const chosen = v.industryKey ? industryByKey(v.industryKey) : undefined
  const terms = template?.terms ?? {}

  return (
    <>
      <StepTitle title="What kind of business is it?" description="We set up the words, fields and dashboard for your industry." />
      <div className="grid gap-6 lg:grid-cols-[1fr_17rem]">
        <div className="grid content-start gap-4">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search — salon, kirana, clinic, coaching…" className="pl-9" aria-label="Search industries" />
          </div>
          {loading && <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Loading industries…</p>}
          {INDUSTRY_GROUPS.map((g) => {
            const items = list.filter((i) => i.group === g)
            if (!items.length) return null
            return (
              <section key={g} className="grid gap-2" aria-label={g}>
                <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{g}</h2>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3" role="radiogroup" aria-label={g}>
                  {items.map((i) => (
                    <ChoiceChip
                      key={i.key}
                      selected={v.industryKey === i.key}
                      onClick={() => {
                        form.set("industryKey", i.key)
                        form.set("subIndustry", "")
                      }}
                      className="flex items-center gap-2.5 rounded-[10px] p-2.5"
                    >
                      <span className={cn("grid size-[30px] shrink-0 place-items-center rounded-lg", v.industryKey === i.key ? "bg-primary text-primary-foreground" : "bg-muted text-foreground/70")}>
                        {v.industryKey === i.key ? <Check className="size-4" /> : <IndustryIcon industry={i.key} className="size-4" />}
                      </span>
                      <span className="min-w-0 flex-1 leading-tight">{i.name}</span>
                      {!i.ready && <span className="shrink-0 rounded-full bg-amber-100 px-1.5 text-[10px] font-semibold text-amber-900 dark:bg-amber-950 dark:text-amber-100">Soon</span>}
                    </ChoiceChip>
                  ))}
                </div>
              </section>
            )
          })}
          {!loading && !list.length && <p className="text-sm text-muted-foreground">No industry matches “{query}”. Choose <strong>Other</strong> and tell us.</p>}
          {form.errors.industryKey && <p className="text-xs text-destructive">{form.errors.industryKey}</p>}
          {chosen && chosen.sub.length > 0 && (
            <div className="grid gap-2 rounded-3xl border border-primary/30 bg-primary/5 p-4">
              <p className="text-sm font-medium">
                Which best describes it? <span className="font-normal text-muted-foreground">(optional)</span>
              </p>
              <div className="flex flex-wrap gap-2">
                {chosen.sub.map((s) => (
                  <ChoiceChip key={s} selected={v.subIndustry === s} onClick={() => form.set("subIndustry", v.subIndustry === s ? "" : s)} className="rounded-full py-1.5 text-xs">
                    {s}
                  </ChoiceChip>
                ))}
              </div>
            </div>
          )}
          {(chosen?.key === "other" || (chosen && !chosen.ready)) && (
            <Field
              label={chosen.key === "other" ? "What does your business do?" : "Anything we should know? (optional)"}
              required={chosen.key === "other"}
              error={form.errors.industryRequested}
              hint={chosen.key === "other" ? undefined : `${chosen.name} setup is coming soon. We'll start you on the ${template?.name ?? "closest"} setup and remember your choice.`}
            >
              <Input {...form.field("industryRequested")} maxLength={80} />
            </Field>
          )}
        </div>
        <aside className="h-fit rounded-3xl border bg-muted/30 p-5 text-sm lg:sticky lg:top-8" aria-live="polite">
          <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">You&apos;ll get</p>
          {template && chosen ? (
            <div className="mt-2 grid gap-3">
              <p className="text-base font-semibold">{template.name} setup</p>
              <p>
                <strong>Words:</strong> {terms["entity.contact.plural"]}, {terms["entity.item.plural"]}, {terms["entity.appointment.plural"]}
              </p>
              {template.fields.length > 0 && (
                <p>
                  <strong>Extra fields:</strong> {template.fields.join(", ")}
                </p>
              )}
              {template.dashboard.length > 0 && (
                <p>
                  <strong>Dashboard:</strong> {template.dashboard.map(humanize).join(", ")}
                </p>
              )}
              {template.starterItems > 0 && (
                <p>
                  <strong>Starter catalogue:</strong> {template.starterItems} common items with GST rates
                </p>
              )}
              <p className="border-t pt-3 text-xs text-muted-foreground">Not quite right? Every word and field can be changed later.</p>
            </div>
          ) : (
            <p className="mt-2 text-muted-foreground">Pick an industry to see what we set up for you.</p>
          )}
        </aside>
      </div>
    </>
  )
}

function GoalsStep({ form, template }: { form: SignupForm; template?: TemplateInfo }) {
  const v = form.values
  const recommended = recommendModules(v.goals, template)
  const fromGoals = GOALS.filter((g) => v.goals.includes(g.key)).flatMap((g) => g.modules as readonly string[])
  const modules = v.modules.length ? v.modules : recommended
  const couponOk = /^[A-Z0-9_-]{2,20}$/.test(v.couponCode)
  const coupon = useAsyncCheck(couponOk ? v.couponCode : "", async (c) => {
    const r = await api.get<{ valid: boolean; message: string }>(`/public/coupons/${encodeURIComponent(c)}`)
    return r.valid ? `ok:${r.message}` : r.message
  })
  const couponGood = coupon.status === "error" && coupon.message?.startsWith("ok:")
  const toggleGoal = (k: string) => {
    const next = v.goals.includes(k) ? v.goals.filter((g) => g !== k) : [...v.goals, k]
    form.set("goals", next)
    form.set("modules", recommendModules(next, template))
  }
  const toggleModule = (k: string) => {
    if (modules.includes(k)) {
      // Keep dependencies: can't drop Products & Services while Billing needs it
      const neededBy = modules.filter((m) => NEEDS[m]?.includes(k))
      if (neededBy.length) return
      form.set("modules", modules.filter((m) => m !== k))
    } else form.set("modules", [...new Set([...modules, k, ...(NEEDS[k] ?? [])])])
  }

  return (
    <>
      <StepTitle title="What do you want to manage in AHEAD?" description="Pick all that apply. We'll put these first in your menu." />
      <div className="grid gap-6 lg:grid-cols-[1fr_17rem]">
        <div className="grid content-start gap-4">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3" role="group" aria-label="Goals">
            {GOALS.map((g) => (
              <ChoiceChip key={g.key} role="checkbox" selected={v.goals.includes(g.key)} onClick={() => toggleGoal(g.key)} className="grid gap-0.5 py-3">
                <span>{g.label}</span>
                <span className="text-xs font-normal text-muted-foreground">{g.description}</span>
              </ChoiceChip>
            ))}
          </div>
          {form.errors.goals && <p className="text-xs text-destructive">{form.errors.goals}</p>}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="How did you hear about us?">
              <NativeSelect {...form.field("heardFrom")}>
                <option value="">Choose (optional)</option>
                {HEARD_FROM.map((h) => (
                  <option key={h}>{h}</option>
                ))}
              </NativeSelect>
            </Field>
            <Field
              label="Referral or coupon code"
              error={form.errors.couponCode ?? (coupon.status === "error" && !couponGood ? coupon.message : v.couponCode && !couponOk ? "Use letters and digits only" : null)}
              success={couponGood ? coupon.message!.slice(3) : null}
              checking={coupon.status === "checking"}
              hint="Optional"
            >
              <Input {...form.field("couponCode")} className="uppercase" maxLength={20} />
            </Field>
          </div>
        </div>
        <aside className="h-fit rounded-3xl border bg-muted/30 p-5 text-sm">
          <p className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Your modules</p>
          <ul className="divide-y">
            {MODULE_NAV.map((m) => {
              const live = LIVE_MODULES.includes(m.key)
              const on = modules.includes(m.key)
              const locked = on && modules.some((x) => NEEDS[x]?.includes(m.key))
              const why = !live ? "Soon" : locked ? `needed by ${MODULE_NAV.find((x) => modules.includes(x.key) && NEEDS[x.key]?.includes(m.key))?.label}` : fromGoals.includes(m.key) ? "your pick" : recommended.includes(m.key) ? `${template?.name ?? "industry"} pick` : ""
              return (
                <li key={m.key}>
                  <label className={cn("flex items-center gap-2 py-2", !live && "text-muted-foreground")}>
                    <Checkbox checked={on} disabled={!live || locked} onCheckedChange={() => toggleModule(m.key)} />
                    <span className="flex-1">{m.label}</span>
                    <span className="text-xs text-muted-foreground">{why}</span>
                  </label>
                </li>
              )
            })}
          </ul>
          <p className="mt-3 flex gap-2 text-xs text-muted-foreground">
            <Sparkles className="size-4 shrink-0" /> Your trial opens every module anyway. This only sets what you see first — change it any time in Settings.
          </p>
        </aside>
      </div>
    </>
  )
}

function VerifyStep({
  form,
  addBusiness,
  template,
  onEdit,
  onCodeComplete,
  onChangeNumber,
  submitting,
}: {
  form: SignupForm
  addBusiness: boolean
  template?: TemplateInfo
  onEdit: (s: StepKey) => void
  onCodeComplete: (code: string) => void
  onChangeNumber: () => void
  submitting: boolean
}) {
  const v = form.values
  const mobile = cleanMobile(v.mobile)
  const [sent, setSent] = React.useState<{ at: number; devCode?: string } | null>(null)
  const [sendError, setSendError] = React.useState<string | null>(null)
  const [now, setNow] = React.useState(0)
  const [sending, setSending] = React.useState(false)

  const send = React.useCallback(async () => {
    setSending(true)
    setSendError(null)
    try {
      const r = await api.post<{ devCode?: string }>("/auth/otp/send", { target: mobile, purpose: "signup" })
      setSent({ at: Date.now(), devCode: r.devCode })
      form.set("otp", "")
    } catch (err) {
      if (err instanceof ApiError && err.code === "MOBILE_TAKEN") {
        onChangeNumber()
        form.setServerErrors({ mobile: err.message })
      } else setSendError(err instanceof ApiError && err.code === "RATE_LIMITED" ? "Too many codes requested. Please wait a few minutes and try again." : err instanceof Error ? err.message : "Couldn't send the code.")
    } finally {
      setSending(false)
    }
  }, [mobile, form, onChangeNumber])

  // Send the first code when the step opens
  const startedRef = React.useRef(false)
  React.useEffect(() => {
    if (addBusiness || startedRef.current) return
    startedRef.current = true
    void send()
  }, [addBusiness, send])
  React.useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  const resendIn = sent ? Math.max(0, 30 - Math.floor((now - sent.at) / 1000)) : 0
  const expiresIn = sent ? Math.max(0, 300 - Math.floor((now - sent.at) / 1000)) : 0
  const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`
  const industry = industryByKey(v.industryKey)
  const rows: { step: StepKey; label: string; value: string }[] = [
    ...(!addBusiness ? [{ step: "account" as StepKey, label: "Account", value: `${v.name} · ${v.email} · +91 ${mobile}` }] : []),
    {
      step: "business",
      label: "Business",
      value: [v.businessName, BUSINESS_TYPES.find((b) => b.key === v.businessType)?.label, v.gstRegistered === "yes" ? `GSTIN ${v.gstin}` : "Not GST registered", stateName(v.stateCode), TEAM_SIZE_LABEL[v.teamSize as keyof typeof TEAM_SIZE_LABEL]].filter(Boolean).join(" · "),
    },
    { step: "industry", label: "Industry", value: [industry?.name, v.subIndustry].filter(Boolean).join(" · ") + (industry && !industry.ready ? ` (starts on ${template?.name ?? "the closest"} setup)` : "") },
    {
      step: "goals",
      label: "Modules first",
      value: (v.modules.length ? v.modules : []).map((k) => MODULE_NAV.find((m) => m.key === k)?.label ?? k).join(", ") || "—",
    },
    ...(v.couponCode ? [{ step: "goals" as StepKey, label: "Code", value: v.couponCode }] : []),
  ]

  return (
    <>
      <StepTitle title={addBusiness ? "Review your new business" : "Verify your mobile"} description={addBusiness ? "Check the details, then create the business." : undefined} />
      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        {!addBusiness && (
          <div className="grid content-start gap-4">
            <p className="text-sm">
              {sending && !sent ? "Sending a code to " : "We sent a 6-digit code to "}
              <strong>+91 {mobile}</strong>.{" "}
              <button type="button" className="font-medium text-primary underline-offset-2 hover:underline" onClick={onChangeNumber}>
                Change number
              </button>
            </p>
            <OtpInput value={v.otp} onChange={(c) => form.set("otp", c)} onComplete={onCodeComplete} invalid={!!form.errors.otp} disabled={submitting} />

            {sendError && <p className="text-sm text-destructive">{sendError}</p>}
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
              <span>{sent ? (expiresIn ? `Code expires in ${mmss(expiresIn)}` : "This code has expired — request a new one") : ""}</span>
              <button type="button" className="font-medium text-foreground disabled:font-normal disabled:text-muted-foreground" disabled={resendIn > 0 || sending} onClick={() => void send()}>
                {resendIn > 0 ? `Resend code in 0:${String(resendIn).padStart(2, "0")}` : "Resend code"}
              </button>
            </div>
            {sent?.devCode && <p className="rounded-2xl bg-muted px-3 py-2 text-xs text-muted-foreground">Development code: {sent.devCode}</p>}
            {form.errors.otp && (
              <div role="alert" className="rounded-lg border border-[#F1B5AE] bg-[#FDECEA] px-3 py-2.5 text-[13px] text-[#7A1A12] dark:border-red-900 dark:bg-red-950 dark:text-red-200">
                {form.errors.otp}
                {/tries? left/.test(String(form.errors.otp)) ? " After 3 wrong tries the code stops working." : ""}
              </div>
            )}
            <label className="mt-1 flex items-center gap-2.5 text-[13px]">
              <Checkbox checked={v.marketingOptIn} onCheckedChange={(c) => form.set("marketingOptIn", !!c)} />
              Send me product updates on email (optional)
            </label>
            <Button type="submit" size="lg" className="mt-1.5 w-full" disabled={submitting}>
              {submitting ? (
                <>
                  <Loader2 className="animate-spin" /> Creating your workspace…
                </>
              ) : (
                "Verify & create workspace"
              )}
            </Button>
            <p className="text-xs text-muted-foreground">The email link to verify {v.email} comes after this — it won&apos;t block you.</p>
          </div>
        )}
        <aside className={cn("h-fit rounded-xl border bg-background px-5 py-4 text-sm", addBusiness && "lg:col-span-2")}>
          <p className="mb-1 text-base font-semibold">Review</p>
          <dl className="divide-y">
            {rows.map((r) => (
              <div key={r.label} className="flex items-start justify-between gap-3 py-3">
                <div className="min-w-0">
                  <dt className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{r.label}</dt>
                  <dd className="mt-0.5 break-words">{r.value}</dd>
                </div>
                <button type="button" className="shrink-0 text-sm font-medium text-primary underline-offset-2 hover:underline" onClick={() => onEdit(r.step)}>
                  Edit
                </button>
              </div>
            ))}
          </dl>
          {!addBusiness && <p className="mt-2 text-xs text-muted-foreground">Free trial with every module. No card needed.</p>}
          {addBusiness && (
            <Button type="submit" size="lg" className="mt-3 w-full" disabled={submitting}>
              {submitting ? "Creating…" : "Create business"}
            </Button>
          )}
        </aside>
      </div>
    </>
  )
}
