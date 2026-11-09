"use client"

import * as React from "react"
import { toast } from "sonner"
import { BadgeCheck, Bell, Laptop, type LucideIcon, Pencil, ShieldCheck, SlidersHorizontal, UserRound } from "lucide-react"
import { email as emailRule, emailSuggestion, mobileIN, personName, squish, cleanMobile } from "@contracts/validation"
import { DATE_FORMATS, type PersonalPreferences } from "@contracts/account"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Field, FormError, NativeSelect } from "@/components/form"
import { OtpInput } from "@/components/onboarding"
import { ErrorState } from "@/components/page-states"
import { api, ApiError, errorMessage } from "@/lib/api"
import { formatMobile, type AccountOverview, type SessionRow } from "@/lib/account"
import { useAccountBase } from "@/lib/account-base"
import { BackupCodesRow, PasswordRow, Row, Rows, SessionsCard, SignInsCard, TwoStepRow } from "@/components/account/security-sections"
import { NotificationsSection } from "@/components/account/notifications-section"
import { useAuth } from "@/lib/auth"
import { formatDate, initials } from "@/lib/format"
import { MODULE_NAV } from "@/lib/nav"
import { useApi } from "@/lib/use-api"
import { useForm } from "@/lib/use-form"
import { cn } from "@/lib/utils"

// My account (one page): who you are at the top, then your details, password and sign-in,
// working preferences, notifications and devices as plain lists. Changes open in a dialog.
// The same in the ERP, the Console and the partner portal.

export default function AccountPage() {
  const { data, error, reload } = useApi<AccountOverview>("/account")
  const sessions = useApi<{ sessions: SessionRow[] }>("/account/sessions")
  const auth = useAuth()
  const base = useAccountBase()
  const inErp = base.account === "/app/account"
  const [dialog, setDialog] = React.useState<"name" | "email" | "mobile" | null>(null)
  const refresh = async () => {
    await Promise.all([reload(), auth.reload()])
  }
  // Links like /account#security land on that section once it is drawn
  React.useEffect(() => {
    if (data && window.location.hash) document.getElementById(window.location.hash.slice(1))?.scrollIntoView({ block: "start" })
  }, [data])
  if (error && !data) return <ErrorState error={error} onRetry={reload} />
  if (!data)
    return (
      <div className="grid w-full gap-4">
        <Skeleton className="h-52 rounded-2xl" />
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    )

  const sections: { id: string; label: string; icon: LucideIcon }[] = [
    { id: "profile", label: "Personal details", icon: UserRound },
    { id: "security", label: "Password & sign-in", icon: ShieldCheck },
    ...(inErp
      ? [
          { id: "preferences", label: "Working preferences", icon: SlidersHorizontal },
          { id: "notifications", label: "Notifications", icon: Bell },
        ]
      : []),
    { id: "devices", label: "Devices", icon: Laptop },
  ]
  const p = data.profile

  return (
    <div className="grid w-full content-start gap-6">
      <Hero account={data} role={auth.me?.console?.role.name ?? auth.me?.role?.name ?? null} onEdit={() => setDialog("name")} />

      <div className="grid items-start gap-6 lg:grid-cols-[13.5rem_minmax(0,1fr)]">
        <nav aria-label="My account" className="flex gap-1 overflow-x-auto lg:sticky lg:top-20 lg:grid lg:overflow-visible">
          {sections.map((s) => (
            <a key={s.id} href={`#${s.id}`} className="flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-[13.5px] font-medium text-foreground/75 transition-colors hover:bg-muted hover:text-foreground">
              <s.icon className="size-4 opacity-70" /> {s.label}
            </a>
          ))}
        </nav>

        <div className="grid min-w-0 gap-8">
          <Section id="profile" title="Personal details" hint="How you sign in and how people see you.">
            <Rows>
              <Row label="Full name" value={p.name} action={<Button variant="outline" size="sm" onClick={() => setDialog("name")}>Edit</Button>} />
              <Row label="Email" hint="Used to sign in" value={<>{p.email} <Verified ok={p.emailVerified} /></>} action={<Button variant="outline" size="sm" onClick={() => setDialog("email")}>Change</Button>} />
              <Row label="Mobile" hint="Used to sign in and for codes" value={<>{formatMobile(p.mobile)} <Verified ok={p.mobileVerified} /></>} action={<Button variant="outline" size="sm" onClick={() => setDialog("mobile")}>Change</Button>} />
            </Rows>
          </Section>

          <Section id="security" title="Password & sign-in" hint="Keep your account safe.">
            <Rows>
              <PasswordRow account={data} onChanged={sessions.reload} />
              <TwoStepRow account={data} onChanged={reload} />
              {data.security.mfaEnabled && <BackupCodesRow account={data} onChanged={reload} />}
            </Rows>
          </Section>

          {inErp && (
            <Section id="preferences" title="Working preferences" hint="Only for you, in every business you use.">
              <WorkingRows account={data} onSaved={refresh} />
            </Section>
          )}

          {inErp && (
            <Section id="notifications" title="Notifications" hint="Choose the team alerts you want.">
              <NotificationsSection data={data} reload={reload} />
            </Section>
          )}

          <Section id="devices" title="Devices & sign-ins" hint="Where your account is open, and recent sign-ins.">
            <div className="grid gap-4">
              <SessionsCard rows={sessions.data?.sessions ?? null} reload={sessions.reload} />
              <SignInsCard />
            </div>
          </Section>
        </div>
      </div>

      {dialog === "name" && <NameDialog account={data} onClose={() => setDialog(null)} onSaved={refresh} />}
      {(dialog === "email" || dialog === "mobile") && <ChangeContactDialog key={dialog} kind={dialog} account={data} onClose={() => setDialog(null)} onDone={refresh} />}
    </div>
  )
}

function Hero({ account, role, onEdit }: { account: AccountOverview; role: string | null; onEdit: () => void }) {
  const p = account.profile
  const s = account.security
  const count = account.businesses.length
  const facts = [
    { label: "Two-step", value: s.mfaEnabled ? "On" : "Off", good: s.mfaEnabled },
    { label: "Password changed", value: s.passwordChangedAt ? formatDate(s.passwordChangedAt) : "Not yet" },
    ...(count ? [{ label: count === 1 ? "Business" : "Businesses", value: String(count) }] : []),
  ]
  return (
    <section className="overflow-hidden rounded-2xl border bg-card">
      <div className="h-24 bg-gradient-to-r from-primary via-primary/80 to-primary/45 sm:h-28" aria-hidden />
      <div className="px-5 pb-5 sm:px-7">
        <div className="-mt-10 flex flex-wrap items-end justify-between gap-3">
          <span className="grid size-20 place-items-center rounded-2xl bg-primary text-2xl font-bold text-primary-foreground shadow-md ring-4 ring-card">{initials(p.name)}</span>
          <Button variant="outline" size="sm" onClick={onEdit}><Pencil className="size-3.5" /> Edit name</Button>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <h1 className="text-[22px] font-bold tracking-tight">{p.name}</h1>
          {role && <span className="rounded-full bg-accent px-2.5 py-0.5 text-xs font-semibold text-accent-foreground">{role}</span>}
        </div>
        <p className="mt-0.5 text-[13.5px] break-all text-muted-foreground">{p.email} · {formatMobile(p.mobile)}</p>
        <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-2 border-t pt-4">
          {facts.map((f) => (
            <div key={f.label}>
              <dt className="text-xs text-muted-foreground">{f.label}</dt>
              <dd className={cn("text-sm font-semibold", f.good && "text-emerald-700 dark:text-emerald-400")}>{f.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  )
}

function Section({ id, title, hint, children }: { id: string; title: string; hint: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={`${id}-title`} className="grid scroll-mt-20 gap-3" id={id}>
      <div>
        <h2 id={`${id}-title`} className="text-base font-semibold">{title}</h2>
        <p className="text-[13px] text-muted-foreground">{hint}</p>
      </div>
      {children}
    </section>
  )
}

function Verified({ ok }: { ok: boolean }) {
  return ok ? (
    <span className="ml-1 inline-flex items-center gap-0.5 align-middle text-[11px] font-semibold text-emerald-700 dark:text-emerald-400"><BadgeCheck className="size-3.5" aria-hidden /> Verified</span>
  ) : (
    <span className="ml-1 align-middle text-[11px] font-semibold text-amber-700 dark:text-amber-400">Not verified</span>
  )
}

function NameDialog({ account, onClose, onSaved }: { account: AccountOverview; onClose: () => void; onSaved: () => Promise<void> }) {
  const form = useForm({
    initial: { name: account.profile.name },
    labels: { name: "Name" },
    clean: { name: squish },
    rules: { name: personName },
    fromServer: (path) => (path === "name" ? "name" : undefined),
    onSubmit: async (v) => {
      await api.patch("/account/profile", { name: v.name })
      await onSaved()
      toast.success("Name saved")
      onClose()
    },
  })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form {...form.formProps} onSubmit={form.submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Edit your name</DialogTitle>
            <DialogDescription>This is how your team sees you.</DialogDescription>
          </DialogHeader>
          <Field label="Full name" required error={form.errors.name}>
            <Input mask="name" {...form.field("name")} autoComplete="name" autoFocus />
          </Field>
          <FormError message={form.formError} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={form.submitting}>{form.submitting ? "Saving…" : "Save"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** New email/mobile + password → code to the new address → switched (old address gets a notice). */
function ChangeContactDialog({ kind, account, onClose, onDone }: { kind: "email" | "mobile"; account: AccountOverview; onClose: () => void; onDone: () => Promise<void> }) {
  const [value, setValue] = React.useState("")
  const [password, setPassword] = React.useState("")
  const [code, setCode] = React.useState("")
  const [token, setToken] = React.useState<string | null>(null)
  const [sentTo, setSentTo] = React.useState("")
  const [devCode, setDevCode] = React.useState<string | undefined>()
  const [errors, setErrors] = React.useState<Record<string, string | null>>({})
  const [busy, setBusy] = React.useState(false)
  const label = kind === "email" ? "email" : "mobile number"

  const check = () => {
    const e = {
      value: !value.trim() ? `Enter the new ${label}` : kind === "email" ? emailRule(value) : mobileIN(value),
      password: password ? null : "Enter your password",
    }
    setErrors(e)
    return !e.value && !e.password
  }

  const send = async () => {
    if (!check()) return
    setBusy(true)
    try {
      const out = await api.post<{ changeToken: string; devCode?: string }>(`/account/${kind}/start`, { value: kind === "email" ? value.trim().toLowerCase() : cleanMobile(value), password })
      setToken(out.changeToken)
      setDevCode(out.devCode)
      setSentTo(kind === "email" ? value.trim().toLowerCase() : `+91 ${cleanMobile(value)}`)
      setErrors({})
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) setErrors({ value: e.fields.value ?? null, password: e.fields.password ?? null })
      else setErrors({ form: errorMessage(e) })
    } finally {
      setBusy(false)
    }
  }

  const confirm = async (c = code) => {
    if (!/^\d{6}$/.test(c)) return setErrors({ code: "Enter the 6-digit code" })
    setBusy(true)
    try {
      await api.post(`/account/${kind}/confirm`, { changeToken: token, code: c })
      toast.success(kind === "email" ? "Email changed. Sign in with the new one from now on." : "Mobile number changed.")
      await onDone()
      onClose()
    } catch (e) {
      setErrors(e instanceof ApiError && e.code === "OTP_INVALID" ? { code: e.message } : { form: errorMessage(e) })
    } finally {
      setBusy(false)
    }
  }

  const hint = kind === "email" ? emailSuggestion(value) : null
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form
          noValidate
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (token) void confirm()
            else void send()
          }}
        >
          <DialogHeader>
            <DialogTitle>Change {kind}</DialogTitle>
            <DialogDescription>
              Your old {kind === "email" ? "email" : "number"} gets a notice. {kind === "email" ? "Sign-in uses the new one right away." : "Sign-in with the new number works right away."}
            </DialogDescription>
          </DialogHeader>
          <Field label={`New ${label}`} required error={errors.value} hint={hint ? `Did you mean ${hint}?` : kind === "mobile" ? "10 digits, starting 6–9" : undefined}>
            <Input mask={kind === "email" ? "email" : "mobile"} value={value} onChange={(e) => setValue(e.target.value)} type={kind === "email" ? "email" : "tel"} autoComplete="off" disabled={!!token} autoFocus placeholder={kind === "email" ? "" : account.profile.mobile.slice(3)} />
          </Field>
          <Field label="Your password" required error={errors.password}>
            <Input value={password} onChange={(e) => setPassword(e.target.value)} type="password" autoComplete="current-password" disabled={!!token} />
          </Field>
          {token && (
            <div className="grid gap-1.5">
              <span className="text-xs font-semibold">Code sent to {sentTo}</span>
              <OtpInput size="sm" value={code} onChange={setCode} onComplete={(c) => void confirm(c)} invalid={!!errors.code} />
              {errors.code && <p className="text-xs text-destructive">{errors.code}</p>}
              {devCode && <p className="text-xs text-muted-foreground">Development code: {devCode}</p>}
            </div>
          )}
          <FormError message={errors.form} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button type="submit" disabled={busy}>{busy ? "Please wait…" : token ? "Confirm change" : "Send code"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

const SHORTCUTS = [
  ["E", "Edit the card you're looking at"],
  ["Ctrl + S", "Save while editing"],
  ["Esc", "Cancel editing"],
  ["D", "Switch light / dark for now"],
  ["↑ ↓ then Enter", "Move through a list and open a row"],
]

function WorkingRows({ account, onSaved }: { account: AccountOverview; onSaved: () => Promise<void> }) {
  const { me } = useAuth()
  const [saving, setSaving] = React.useState(false)
  const [shortcuts, setShortcuts] = React.useState(false)
  const save = async (patch: Partial<PersonalPreferences> & { defaultTenantId?: string }, message: string) => {
    setSaving(true)
    try {
      await api.put("/account/preferences", { ...account.preferences, ...patch })
      await onSaved()
      toast.success(message)
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }
  const p = account.preferences
  const modules = MODULE_NAV.filter((m) => me?.modules?.[m.key] && me.modules[m.key].status !== "inactive")
  const sel = "h-9 sm:w-56"
  return (
    <Rows>
      <Row label="Start page" hint="Opens after you sign in" action={
        <NativeSelect className={sel} aria-label="Start page" value={p.startPage} disabled={saving} onChange={(e) => save({ startPage: e.target.value }, "Start page saved")}>
          <option value="dashboard">Dashboard</option>
          {modules.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
        </NativeSelect>
      } />
      <Row label="Date format" action={
        <NativeSelect className={sel} aria-label="Date format" value={p.dateFormat} disabled={saving} onChange={(e) => save({ dateFormat: e.target.value as PersonalPreferences["dateFormat"] }, "Date format saved")}>
          {DATE_FORMATS.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
        </NativeSelect>
      } />
      <Row label="Default business" hint="Opens first when you have more than one" action={
        <NativeSelect className={sel} aria-label="Default business" value={account.lastTenantId ?? ""} disabled={saving || account.businesses.length < 2} onChange={(e) => save({ defaultTenantId: e.target.value }, "Default business saved")}>
          {account.businesses.map((b) => <option key={b.tenantId} value={b.tenantId}>{b.name}</option>)}
        </NativeSelect>
      } />
      <Row label="Keyboard shortcuts" action={<Button variant="outline" size="sm" onClick={() => setShortcuts(true)}>View list</Button>} />
      <Dialog open={shortcuts} onOpenChange={setShortcuts}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Keyboard shortcuts</DialogTitle>
            <DialogDescription>They work anywhere except while typing in a field.</DialogDescription>
          </DialogHeader>
          <dl className="grid gap-2 text-sm">
            {SHORTCUTS.map(([key, what]) => (
              <div key={key} className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">{what}</dt>
                <dd>
                  <kbd className="rounded-md border bg-muted px-1.5 py-0.5 font-mono text-xs">{key}</kbd>
                </dd>
              </div>
            ))}
          </dl>
        </DialogContent>
      </Dialog>
    </Rows>
  )
}
