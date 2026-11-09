"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { FormError } from "@/components/form"
import { NoAccess } from "@/components/page-states"
import { SettingsPage } from "@/components/settings-shell"
import { DataStep, type ImportKind } from "@/components/setup/data-step"
import { StepMode } from "@/components/setup/wizard"
import { OtpInput } from "@/components/onboarding"
import { api, ApiError, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { downloadApiFile } from "@/lib/download"
import { formatDate, formatDateTime } from "@/lib/format"
import { useApi } from "@/lib/use-api"
import { useWorkspaceData } from "@/lib/use-workspace"
import { cn } from "@/lib/utils"

// Settings › Data (wireframe X6): import centre and history, export, sample data, backups,
// and closing the business (Owner only, name + code, reopen within 30 days).

const card = "flex flex-col gap-2.5 ui-surface px-[18px] py-3.5"
const chip = "h-[30px] rounded-lg border px-2.5 text-xs font-semibold"
const chipOn = "border-primary bg-accent text-accent-foreground"

export default function DataPage() {
  const { can } = useAuth()
  if (!can("tenant.settings.view")) return <NoAccess what="Data" />
  return (
    <SettingsPage title="Data" crumb>
      <div className="grid gap-3.5 lg:grid-cols-2">
        <ImportCard />
        <ExportCard />
        <SampleCard />
        <section className={cn(card, "gap-2")}>
          <h2 className="text-[15px] font-bold">Backups</h2>
          <p className="text-[13px] leading-relaxed">
            AHEAD keeps automatic database backups so we can restore the service after a fault. They aren&apos;t a copy you can download — for that, use <strong>Export › Everything</strong> any time.
          </p>
        </section>
      </div>
      <CloseCard />
    </SettingsPage>
  )
}

// ── Import ──

interface ImportRow {
  id: string
  at: string
  what: string
  by: string | null
  created: number
  updated: number
  skipped: number
  errors: number
}

function ImportCard() {
  const { term, can } = useAuth()
  const { tenant, workspace, refresh } = useWorkspaceData()
  const history = useApi<{ data: ImportRow[] }>("/tenant/imports")
  const [kind, setKind] = React.useState<ImportKind | null>(null)
  const customers = term("entity.contact.plural", "Customers")
  const items = term("entity.item.plural", "Services & products")
  return (
    <section id="import" className={card}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[15px] font-bold">Import</h2>
        <div className="flex flex-wrap gap-1.5">
          <Button variant="outline" size="sm" disabled={!can("crm.contact.create")} onClick={() => setKind("customers")}>
            {customers}
          </Button>
          <Button variant="outline" size="sm" disabled={!can("catalog.item.create")} onClick={() => setKind("items")}>
            {items}
          </Button>
          <Button variant="outline" size="sm" disabled title="Arrives with opening balances in Finance">
            Opening dues · Soon
          </Button>
        </div>
      </div>
      {!history.data ? (
        <Skeleton className="h-16" />
      ) : history.data.data.length ? (
        <table className="w-full text-xs">
          <tbody>
            {history.data.data.slice(0, 6).map((r) => (
              <tr key={r.id} className="border-b border-border/60 last:border-0">
                <td className="py-1.5 pr-2 whitespace-nowrap">{formatDateTime(r.at)}</td>
                <td className="py-1.5 pr-2">
                  {r.what}
                  {r.by ? ` · ${r.by}` : ""}
                </td>
                <td className="py-1.5">
                  {[r.created && `${r.created} created`, r.updated && `${r.updated} updated`, r.skipped && `${r.skipped} skipped`, r.errors && `${r.errors} error${r.errors === 1 ? "" : "s"}`].filter(Boolean).join(" · ") || "Nothing imported"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="text-[13px] text-muted-foreground">No imports yet.</p>
      )}
      <p className="text-xs text-muted-foreground">Same flow as setup: template → upload → map columns → preview → import.</p>
      <Dialog open={!!kind} onOpenChange={(o) => !o && setKind(null)}>
        <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>Import {kind === "items" ? items.toLowerCase() : customers.toLowerCase()}</DialogTitle>
            <DialogDescription>CSV up to 5 MB. Rows with problems are listed so you can fix them; duplicates can be skipped or updated.</DialogDescription>
          </DialogHeader>
          {tenant && workspace && kind && (
            <StepMode.Provider value="settings">
              <DataStep importKind={kind} onImported={() => void history.reload()} tenant={tenant} workspace={workspace} refresh={refresh} back={null} stepKey="data" complete={async () => setKind(null)} />
            </StepMode.Provider>
          )}
        </DialogContent>
      </Dialog>
    </section>
  )
}

// ── Export ──

const KINDS = [
  { key: "customers", label: "Customers" },
  { key: "invoices", label: "Invoices" },
  { key: "payments", label: "Payments" },
  { key: "items", label: "Services" },
] as const

function ExportCard() {
  const { can, term } = useAuth()
  const [what, setWhat] = React.useState<string[]>(["customers", "invoices"])
  const [period, setPeriod] = React.useState<"fy" | "all">("fy")
  const [format, setFormat] = React.useState<"csv" | "xlsx">("csv")
  const [busy, setBusy] = React.useState(false)
  const all = what.length === KINDS.length
  const label = (k: (typeof KINDS)[number]) => (k.key === "customers" ? term("entity.contact.plural", k.label) : k.key === "items" ? term("entity.item.plural", k.label) : k.label)
  const toggle = (k: string) => setWhat((w) => (w.includes(k) ? w.filter((x) => x !== k) : [...w, k]))
  const start = async () => {
    setBusy(true)
    try {
      const name = await downloadApiFile(`/tenant/export?what=${what.join(",")}&period=${period}&format=${format}`, `export.${format}`)
      toast.success(`${name} downloaded`)
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  if (!can("tenant.data.export")) {
    return (
      <section id="export" className={card}>
        <h2 className="text-[15px] font-bold">Export</h2>
        <p className="text-[13px] text-muted-foreground">Your role can&apos;t export business data. Ask the owner.</p>
      </section>
    )
  }
  return (
    <section id="export" className={card}>
      <h2 className="text-[15px] font-bold">Export</h2>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="What to export">
        {KINDS.map((k) => (
          <button key={k.key} type="button" aria-pressed={what.includes(k.key)} onClick={() => toggle(k.key)} className={cn(chip, what.includes(k.key) ? chipOn : "border-input bg-card")}>
            {label(k)}
          </button>
        ))}
        <button type="button" aria-pressed={all} onClick={() => setWhat(all ? [] : KINDS.map((k) => k.key))} className={cn(chip, all ? chipOn : "border-input bg-card")}>
          Everything
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        <span>Period</span>
        {(
          [
            ["fy", "This FY"],
            ["all", "All time"],
          ] as const
        ).map(([k, l]) => (
          <button key={k} type="button" aria-pressed={period === k} onClick={() => setPeriod(k)} className={cn(chip, period === k ? chipOn : "border-input bg-card")}>
            {l}
          </button>
        ))}
        <span className="ml-auto">Format</span>
        {(
          [
            ["csv", "CSV"],
            ["xlsx", "Excel"],
          ] as const
        ).map(([k, l]) => (
          <button key={k} type="button" aria-pressed={format === k} onClick={() => setFormat(k)} className={cn(chip, format === k ? chipOn : "border-input bg-card")}>
            {l}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>{format === "csv" && what.length > 1 ? "Several CSVs come in one .zip file" : "Downloads right away"} · recorded in the audit log</span>
        <Button size="sm" onClick={start} disabled={!what.length || busy}>
          {busy ? "Preparing…" : "Start export"}
        </Button>
      </div>
    </section>
  )
}

// ── Sample data ──

function SampleCard() {
  const { can } = useAuth()
  const { data, reload } = useApi<{ contacts: number }>("/tenant/sample-data")
  const [busy, setBusy] = React.useState(false)
  return (
    <section id="sample" className={cn(card, "gap-2")}>
      <h2 className="text-[15px] font-bold">Sample data</h2>
      <p className="text-[13px]">{!data ? "Checking…" : data.contacts ? `${data.contacts} sample customers are in your workspace.` : "No sample data in your workspace."}</p>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        Only records tagged as sample are removed.
        <Button
          variant="outline"
          size="sm"
          disabled={!data?.contacts || busy || !can("tenant.settings.edit")}
          onClick={async () => {
            setBusy(true)
            try {
              const r = await api.delete<{ removed: number; kept: number }>("/tenant/sample-data")
              toast.success(r.kept ? `${r.removed} removed. ${r.kept} kept because they're on invoices.` : `${r.removed} sample records removed`)
              await reload()
            } catch (e) {
              toast.error(errorMessage(e))
            } finally {
              setBusy(false)
            }
          }}
        >
          Remove sample data
        </Button>
      </div>
    </section>
  )
}

// ── Close business ──

function CloseCard() {
  const { me, reload, signOut } = useAuth()
  const router = useRouter()
  const t = me?.tenant
  const [name, setName] = React.useState("")
  const [sent, setSent] = React.useState<{ mobile: string; devCode?: string } | null>(null)
  const [code, setCode] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [done, setDone] = React.useState<string | null>(null)
  if (!t) return null
  const nameOk = name.trim().toLowerCase() === t.name.trim().toLowerCase()

  if (t.status === "closed") return <ReopenCard />
  if (!t.isOwner) {
    return (
      <section className={cn(card, "border-red-200 dark:border-red-900")}>
        <h2 className="text-[15px] font-bold text-destructive">Close {t.name}</h2>
        <p className="text-[13px] text-muted-foreground">Only the Owner can close the business.</p>
      </section>
    )
  }

  const sendCode = async () => {
    setBusy(true)
    setError(null)
    try {
      setSent(await api.post("/tenant/close/start"))
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  const close = async () => {
    if (!nameOk) return setError("The name doesn't match")
    if (!/^\d{6}$/.test(code)) return setError("Enter the 6-digit code")
    setBusy(true)
    setError(null)
    try {
      const r = await api.post<{ purgeAt: string }>("/tenant/close", { name: name.trim(), code })
      setDone(r.purgeAt)
      await reload()
    } catch (e) {
      setError(e instanceof ApiError && Object.keys(e.fields).length ? Object.values(e.fields)[0] : errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section id="close" className="grid gap-6 rounded-xl border border-red-200 bg-card px-[18px] py-4 lg:grid-cols-[1fr_420px] dark:border-red-900">
      <div className="flex flex-col gap-2">
        <h2 className="text-[15px] font-bold text-destructive">Close {t.name}</h2>
        <ul className="list-disc space-y-0.5 pl-4 text-[13px] leading-relaxed text-foreground/80">
          <li>Everyone loses access right away; the workspace becomes read-only for you.</li>
          <li>
            You can reopen it within <strong>30 days</strong> — after that all data is deleted for good.
          </li>
          <li>Your paid plan stops renewing; no refund for the current period.</li>
          <li>Export your data first if you need it.</li>
        </ul>
      </div>
      <div className="flex flex-col gap-2 rounded-[10px] bg-red-50/60 p-3 dark:bg-red-950/20">
        <label className="text-xs font-semibold" htmlFor="close-name">
          Type <strong>{t.name}</strong> to confirm
        </label>
        <Input id="close-name" value={name} onChange={(e) => setName(e.target.value)} aria-invalid={!!name && !nameOk} autoComplete="off" />
        {name && !nameOk && <p className="text-xs text-destructive">The name doesn&apos;t match</p>}
        {sent ? (
          <>
            <span className="text-xs font-semibold">Code sent to {sent.mobile}</span>
            <OtpInput size="sm" value={code} onChange={setCode} autoFocus={false} />
            {sent.devCode && <p className="text-xs text-muted-foreground">Development code: {sent.devCode}</p>}
          </>
        ) : (
          <Button variant="outline" size="sm" disabled={!nameOk || busy} onClick={sendCode}>
            Send code to my mobile
          </Button>
        )}
        <FormError message={error} />
        <Button variant="destructive" disabled={!nameOk || !sent || code.length !== 6 || busy} onClick={close}>
          {busy && sent ? "Closing…" : "Close business"}
        </Button>
        <p className="text-[11px] text-muted-foreground">Owner only · audit entry · email to all admins</p>
      </div>
      <Dialog open={!!done} onOpenChange={() => undefined}>
        <DialogContent className="sm:max-w-sm" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{t.name} is closed</DialogTitle>
            <DialogDescription>Everyone else has been signed out. You can reopen it until {done ? formatDate(done) : "30 days from now"} from Settings › Data.</DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => signOut().then(() => router.replace("/login"))}>
              Sign out
            </Button>
            <Button onClick={() => setDone(null)}>Stay (read-only)</Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  )
}

function ReopenCard() {
  const { me, reload } = useAuth()
  const [busy, setBusy] = React.useState(false)
  if (!me?.tenant) return null
  return (
    <section id="close" className={cn(card, "border-amber-300 dark:border-amber-800")}>
      <h2 className="text-[15px] font-bold">{me.tenant.name} is closed</h2>
      <p className="text-[13px]">It&apos;s read-only and nobody else can sign in. Reopen it to continue on the Free plan; data is deleted for good 30 days after closing.</p>
      {me.tenant.isOwner && (
        <div className="flex justify-end">
          <Button
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              try {
                await api.post("/tenant/reopen")
                toast.success(`${me.tenant!.name} is open again`)
                await reload()
              } catch (e) {
                toast.error(errorMessage(e))
              } finally {
                setBusy(false)
              }
            }}
          >
            Reopen business
          </Button>
        </div>
      )}
    </section>
  )
}
