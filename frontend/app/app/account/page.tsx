"use client"

import * as React from "react"
import { toast } from "sonner"
import { email as emailRule, emailSuggestion, mobileIN, personName, squish, cleanMobile } from "@contracts/validation"
import { DATE_FORMATS, type PersonalPreferences } from "@contracts/account"
import { FONTS } from "@contracts/workspace"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { EditableSection } from "@/components/editable-section"
import { Field, FormError, NativeSelect } from "@/components/form"
import { ChoiceChip, OtpInput } from "@/components/onboarding"
import { ErrorState } from "@/components/page-states"
import { api, ApiError, errorMessage } from "@/lib/api"
import { formatMobile, type AccountOverview, type SessionRow } from "@/lib/account"
import { useAccountBase } from "@/lib/account-base"
import { BackupCodesCard, PasswordCard, SessionsCard, SignInsCard, TwoStepCard } from "@/components/account/security-sections"
import { NotificationsSection } from "@/components/account/notifications-section"
import { useAuth } from "@/lib/auth"
import { formatDate, initials } from "@/lib/format"
import { MODULE_NAV } from "@/lib/nav"
import { useApi } from "@/lib/use-api"
import { useForm } from "@/lib/use-form"
import { cn } from "@/lib/utils"

// My account (one page): profile, password and sign-in, look and preferences, notifications,
// and where you're signed in. The same in the ERP, the Console and the partner portal.

export default function AccountPage() {
  const { data, error, reload } = useApi<AccountOverview>("/account")
  const sessions = useApi<{ sessions: SessionRow[] }>("/account/sessions")
  const auth = useAuth()
  const base = useAccountBase()
  const inErp = base.account === "/app/account"
  const [changing, setChanging] = React.useState<"email" | "mobile" | null>(null)
  const refresh = async () => {
    await Promise.all([reload(), auth.reload()])
  }
  // Links like /account#security land on that section once it is drawn
  React.useEffect(() => {
    if (data && window.location.hash) document.getElementById(window.location.hash.slice(1))?.scrollIntoView({ block: "start" })
  }, [data])
  if (error && !data) return <ErrorState error={error} onRetry={reload} />
  return (
    <div className="mx-auto grid max-w-5xl content-start gap-3.5">
      <div>
        <h1 className="text-[22px] font-bold tracking-tight">My account</h1>
        <p className="mt-0.5 text-[13px] text-muted-foreground">Only for you, and the same everywhere you use AHEAD.</p>
      </div>
      {!data ? (
        <>
          <Skeleton className="h-64 rounded-xl" />
          <Skeleton className="h-40 rounded-xl" />
        </>
      ) : (
        <>
          <SectionTitle id="profile" title="Profile" />
          <div className="grid gap-3.5 lg:grid-cols-2">
            <ProfileCard key={data.profile.name} account={data} onSaved={refresh} onChange={setChanging} />
            {changing ? (
              <ChangeContactCard key={changing} kind={changing} account={data} onDone={async () => {
                setChanging(null)
                await refresh()
              }} onCancel={() => setChanging(null)} />
            ) : (
              <AccountFacts account={data} />
            )}
          </div>

          <SectionTitle id="security" title="Password & sign-in" />
          <div className="grid gap-3.5 lg:grid-cols-2">
            <div className="flex flex-col gap-3.5">
              <PasswordCard account={data} onChanged={sessions.reload} />
              {data.security.mfaEnabled && <BackupCodesCard account={data} onChanged={reload} />}
            </div>
            <TwoStepCard account={data} onChanged={reload} />
          </div>

          <SectionTitle id="preferences" title="Look & preferences" />
          <div className="grid gap-3.5 lg:grid-cols-2">
            <LookCard account={data} onSaved={refresh} />
            {inErp && <WorkingCard account={data} onSaved={refresh} />}
          </div>

          {inErp && (
            <>
              <SectionTitle id="notifications" title="Notifications" />
              <NotificationsSection data={data} reload={reload} />
            </>
          )}

          <SectionTitle id="devices" title="Devices & sign-ins" />
          <div className="grid gap-3.5 lg:grid-cols-2">
            <SessionsCard rows={sessions.data?.sessions ?? null} reload={sessions.reload} />
            <SignInsCard />
          </div>
        </>
      )}
    </div>
  )
}

function SectionTitle({ id, title }: { id: string; title: string }) {
  return <h2 id={id} className="mt-3 scroll-mt-20 text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">{title}</h2>
}

/** The account at a glance: when it was made, last sign-in, two-step and verified contacts. */
function AccountFacts({ account }: { account: AccountOverview }) {
  const s = account.security
  const rows: [string, React.ReactNode][] = [
    ["Two-step verification", s.mfaEnabled ? <span className="font-semibold text-emerald-700 dark:text-emerald-400">On</span> : <span className="font-semibold text-amber-700">Off</span>],
    ["Password changed", s.passwordChangedAt ? formatDate(s.passwordChangedAt) : "—"],
    ["Email", account.profile.emailVerified ? "Verified" : "Not verified"],
    ["Mobile", account.profile.mobileVerified ? "Verified" : "Not verified"],
    ["Businesses you belong to", account.businesses.length || "None"],
  ]
  return (
    <section className={card}>
      <h2 className="text-[15px] font-bold">Account</h2>
      <dl className="grid gap-2 text-[13px]">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-center justify-between gap-3 border-b border-border/60 pb-2 last:border-0 last:pb-0">
            <dt className="text-muted-foreground">{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

const card = "flex flex-col gap-3 rounded-xl border bg-card px-[18px] py-4"
const k = "text-xs font-semibold text-muted-foreground"

function Verified({ ok }: { ok: boolean }) {
  return ok ? <span className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">✓ verified</span> : <span className="text-[11px] font-semibold text-amber-700">not verified</span>
}

function ProfileCard({ account, onSaved, onChange }: { account: AccountOverview; onSaved: () => Promise<void>; onChange: (k: "email" | "mobile") => void }) {
  const p = account.profile
  const form = useForm({
    initial: { name: p.name },
    labels: { name: "Name" },
    clean: { name: squish },
    rules: { name: personName },
    fromServer: (path) => (path === "name" ? "name" : undefined),
    onSubmit: async (v) => {
      await api.patch("/account/profile", { name: v.name })
      await onSaved()
      toast.success("Name saved")
    },
  })
  return (
    <EditableSection
      title="Profile"
      form={form}
      canEdit
      view={
        <div className="grid gap-3">
          <div className="flex items-center gap-3.5">
            <span className="grid size-14 place-items-center rounded-full bg-primary text-lg font-bold text-primary-foreground">{initials(p.name)}</span>
            <p className="text-xs text-muted-foreground">Photo upload needs file storage — initials for now.</p>
          </div>
          <div>
            <div className={k}>Name</div>
            <div className="mt-0.5 text-sm">{p.name}</div>
          </div>
          <div>
            <div className={k}>Email</div>
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-sm">
              {p.email} <Verified ok={p.emailVerified} />
              <button type="button" className="text-xs font-semibold text-primary hover:underline" onClick={() => onChange("email")}>
                Change
              </button>
            </div>
          </div>
          <div>
            <div className={k}>Mobile</div>
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-sm">
              {formatMobile(p.mobile)} <Verified ok={p.mobileVerified} />
              <button type="button" className="text-xs font-semibold text-primary hover:underline" onClick={() => onChange("mobile")}>
                Change
              </button>
            </div>
          </div>
        </div>
      }
    >
      <Field label="Name" required error={form.errors.name}>
        <Input {...form.field("name")} autoComplete="name" autoFocus />
      </Field>
    </EditableSection>
  )
}

/** New email/mobile + password → code to the new address → switched (old address gets a notice). */
function ChangeContactCard({ kind, account, onDone, onCancel }: { kind: "email" | "mobile"; account: AccountOverview; onDone: () => Promise<void>; onCancel: () => void }) {
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
    } catch (e) {
      setErrors(e instanceof ApiError && e.code === "OTP_INVALID" ? { code: e.message } : { form: errorMessage(e) })
    } finally {
      setBusy(false)
    }
  }

  const hint = kind === "email" ? emailSuggestion(value) : null
  return (
    <form
      className={cn(card, "border-primary/50 ring-2 ring-primary/15")}
      onSubmit={(e) => {
        e.preventDefault()
        if (token) void confirm()
        else void send()
      }}
    >
      <h2 className="text-[15px] font-bold">Change {kind}</h2>
      <Field label={`New ${label}`} error={errors.value} hint={hint ? `Did you mean ${hint}?` : kind === "mobile" ? "10 digits, starting 6–9" : undefined}>
        <Input value={value} onChange={(e) => setValue(e.target.value)} type={kind === "email" ? "email" : "tel"} inputMode={kind === "email" ? "email" : "numeric"} autoComplete="off" disabled={!!token} autoFocus placeholder={kind === "email" ? "" : account.profile.mobile.slice(3)} />
      </Field>
      <Field label="Your password" error={errors.password}>
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
      <p className="text-xs text-muted-foreground">
        Your old {kind === "email" ? "email" : "number"} gets a notice. {kind === "email" ? "Sign-in uses the new one right away." : "Sign-in with the new number works right away."}
      </p>
      <FormError message={errors.form} />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy}>
          {busy ? "Please wait…" : token ? "Confirm change" : "Send code"}
        </Button>
      </div>
    </form>
  )
}

function usePreferences(account: AccountOverview, onSaved: () => Promise<void>) {
  const [saving, setSaving] = React.useState(false)
  const save = async (patch: Partial<PersonalPreferences> & { defaultTenantId?: string }, message = "Preference saved") => {
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
  return { saving, save }
}

function LookCard({ account, onSaved }: { account: AccountOverview; onSaved: () => Promise<void> }) {
  const { me } = useAuth()
  const { saving, save } = usePreferences(account, onSaved)
  const p = account.preferences
  const ws = me?.tenant?.branding
  const cap = (s?: string) => (s ? s[0].toUpperCase() + s.slice(1) : "")
  const chips = <T extends string>(label: string, current: T, options: { key: T; label: string }[], field: keyof PersonalPreferences) => (
    <div>
      <div className={cn(k, "mb-1.5")}>{label}</div>
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <ChoiceChip key={o.key} selected={current === o.key} onClick={() => !saving && current !== o.key && save({ [field]: o.key } as Partial<PersonalPreferences>, `${label} updated`)} className="min-h-[30px] px-2.5 py-1 text-xs">
            {o.label}
          </ChoiceChip>
        ))}
      </div>
    </div>
  )
  return (
    <section className={card}>
      <h2 className="text-[15px] font-bold">Look &amp; feel</h2>
      {chips("Theme", p.theme, [
        { key: "workspace", label: `Workspace default${ws ? ` (${cap(ws.theme)})` : ""}` },
        { key: "light", label: "Light" },
        { key: "dark", label: "Dark" },
        { key: "system", label: "System" },
      ], "theme")}
      {chips("Font", p.font, [{ key: "workspace", label: "Workspace default" }, ...FONTS.map((f) => ({ key: f.key, label: f.label }))], "font")}
      {chips("Density", p.density, [
        { key: "workspace", label: "Workspace default" },
        { key: "comfortable", label: "Comfortable" },
        { key: "compact", label: "Compact" },
      ], "density")}
    </section>
  )
}

const SHORTCUTS = [
  ["E", "Edit the card you're looking at"],
  ["Ctrl + S", "Save while editing"],
  ["Esc", "Cancel editing"],
  ["D", "Switch light / dark for now"],
  ["↑ ↓ then Enter", "Move through a list and open a row"],
]

function WorkingCard({ account, onSaved }: { account: AccountOverview; onSaved: () => Promise<void> }) {
  const { me } = useAuth()
  const { saving, save } = usePreferences(account, onSaved)
  const [shortcuts, setShortcuts] = React.useState(false)
  const p = account.preferences
  const modules = MODULE_NAV.filter((m) => me?.modules?.[m.key] && me.modules[m.key].status !== "inactive")
  const row = "flex items-center justify-between gap-3 border-b py-2 text-[13px]"
  const sel = "h-8 max-w-[55%] text-[13px] font-semibold"
  return (
    <section className={cn(card, "gap-1")}>
      <h2 className="mb-1 text-[15px] font-bold">Working preferences</h2>
      <label className={row}>
        <span>Start page after sign-in</span>
        <NativeSelect className={sel} value={p.startPage} disabled={saving} onChange={(e) => save({ startPage: e.target.value }, "Start page saved")}>
          <option value="dashboard">Dashboard</option>
          {modules.map((m) => (
            <option key={m.key} value={m.key}>
              {m.label}
            </option>
          ))}
        </NativeSelect>
      </label>
      <label className={row}>
        <span>Date format</span>
        <NativeSelect className={sel} value={p.dateFormat} disabled={saving} onChange={(e) => save({ dateFormat: e.target.value as PersonalPreferences["dateFormat"] }, "Date format saved")}>
          {DATE_FORMATS.map((d) => (
            <option key={d.key} value={d.key}>
              {d.label}
            </option>
          ))}
        </NativeSelect>
      </label>
      <label className={row}>
        <span>Default business</span>
        <NativeSelect className={sel} value={account.lastTenantId ?? ""} disabled={saving || account.businesses.length < 2} onChange={(e) => save({ defaultTenantId: e.target.value }, "Default business saved")}>
          {account.businesses.map((b) => (
            <option key={b.tenantId} value={b.tenantId}>
              {b.name}
            </option>
          ))}
        </NativeSelect>
      </label>
      <div className={cn(row, "border-b-0")}>
        <span>Keyboard shortcuts</span>
        <button type="button" className="font-semibold text-primary hover:underline" onClick={() => setShortcuts(true)}>
          View list
        </button>
      </div>
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
    </section>
  )
}
