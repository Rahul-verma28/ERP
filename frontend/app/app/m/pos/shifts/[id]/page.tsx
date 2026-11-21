"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { toast } from "sonner"
import { Banknote, Loader2, Lock, Printer, ShoppingBag, Smartphone, Store, Undo2, Wallet } from "lucide-react"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { MoneyInput } from "@/components/common"
import { Field, FormError } from "@/components/form"
import { BackLink, DetailHeader, DetailList, Pill, Section, StatGrid } from "@/components/page-parts"
import { PageError, PageLoading } from "@/components/page-states"
import { Difference } from "@/components/pos/bits"
import { api, ApiError, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { formatDateTime, formatPaise } from "@/lib/format"
import { MOVE_REASON, NOTES, TENDER_LABEL, type Register, type ShiftSummary } from "@/lib/pos"
import { useApi } from "@/lib/use-api"
import { cn } from "@/lib/utils"

// One shift: what was sold and how it was paid, the cash that should be in the drawer, cash moves,
// returns, and closing it on the notes and coins counted.

export default function ShiftPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = React.use(params)
  const { me } = useAuth()
  const search = useSearchParams()
  const shift = useApi<ShiftSummary>(`/pos/shifts/${id}`)
  const reg = useApi<Register>("/pos/register")
  const [closing, setClosing] = React.useState(search.get("close") === "1")
  if (shift.error) return <PageError error={shift.error} />
  if (!shift.data) return <PageLoading />
  const s = shift.data
  const mine = s.openedBy === me?.user?.id
  const canClose = s.status === "open" && (mine || reg.data?.can.approve)
  const methodRows = Object.entries(s.methods)

  return (
    <div className="grid gap-5">
      <BackLink href="/app/m/pos/shifts">Shifts</BackLink>
      <DetailHeader
        icon={Store}
        title={`${s.counter.name} · ${s.number}`}
        pills={<Pill color={s.status === "open" ? "emerald" : "slate"} dot>{s.status === "open" ? "Open" : "Closed"}</Pill>}
        subtitle={`${s.openedByName} · opened ${formatDateTime(s.openedAt)}${s.closedAt ? ` · closed ${formatDateTime(s.closedAt)}` : ""}`}
        actions={
          <>
            {s.status === "open" && mine && <Link href="/app/m/pos" className={buttonVariants({ variant: "outline" })}><Store /> Back to counter</Link>}
            <Button variant="outline" onClick={() => window.print()}><Printer /> Print</Button>
            {canClose && !closing && <Button onClick={() => setClosing(true)}><Lock /> Close shift</Button>}
          </>
        }
      />
      <StatGrid className="lg:grid-cols-5" items={[
        { label: "Sales", value: formatPaise(s.totals.salesPaise), hint: `${s.totals.bills} bills · average ${formatPaise(s.totals.averagePaise)}`, color: "blue", icon: ShoppingBag },
        { label: "Cash expected", value: formatPaise(s.cash.expectedPaise), hint: "In the drawer now", color: "emerald", icon: Banknote },
        { label: "UPI & card", value: formatPaise(methodRows.filter(([m]) => m !== "cash").reduce((a, [, v]) => a + v.inPaise - v.outPaise, 0)), hint: "Into the bank account", color: "violet", icon: Smartphone },
        { label: "On account", value: formatPaise(s.totals.duePaise), hint: "Owed by customers", color: "amber", icon: Wallet },
        { label: "Returns", value: formatPaise(s.totals.returnsPaise), hint: `${s.totals.returns} returns`, color: "rose", icon: Undo2 },
      ]} />

      {closing && canClose && <CloseForm shift={s} financeOn={!!reg.data?.financeOn} onCancel={() => setClosing(false)} onClosed={(x) => { shift.setData(x); setClosing(false) }} />}

      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Cash in the drawer">
          <dl className="grid gap-1.5 p-4 text-sm">
            {([["Opening cash", s.cash.openingPaise, 1], ["Cash sales", s.cash.salesPaise, 1], ["Cash refunds", s.cash.refundsPaise, -1], ["Cash put in", s.cash.inPaise, 1], ["Cash taken out", s.cash.outPaise, -1]] as const).map(([l, v, sign]) => (
              <div key={l} className="flex justify-between"><dt className="text-muted-foreground">{l}</dt><dd className="tabular-nums">{sign < 0 && v ? "− " : ""}{formatPaise(v)}</dd></div>
            ))}
            <div className="mt-1 flex justify-between border-t pt-2 font-semibold"><dt>Should be in the drawer</dt><dd className="tabular-nums">{formatPaise(s.cash.expectedPaise)}</dd></div>
            {s.counted && (
              <>
                <div className="flex justify-between"><dt className="text-muted-foreground">Counted at close</dt><dd className="tabular-nums">{formatPaise(s.counted.countedPaise)}</dd></div>
                <div className="flex justify-between"><dt className="text-muted-foreground">Difference</dt><dd><Difference paise={s.counted.differencePaise} /></dd></div>
                {s.counted.depositPaise > 0 && <div className="flex justify-between"><dt className="text-muted-foreground">Sent to the bank</dt><dd className="tabular-nums">{formatPaise(s.counted.depositPaise)}</dd></div>}
                {s.counted.note && <p className="mt-1 rounded-lg bg-muted/60 px-3 py-2 text-xs">{s.counted.note}</p>}
              </>
            )}
          </dl>
        </Section>
        <Section title="How it was paid">
          {!methodRows.length ? <p className="p-4 text-sm text-muted-foreground">No payments yet.</p> : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground"><tr><th className="px-4 py-2">Method</th><th className="px-4 py-2 text-right">Payments</th><th className="px-4 py-2 text-right">In</th><th className="px-4 py-2 text-right">Refunds</th><th className="px-4 py-2 text-right">Net</th></tr></thead>
              <tbody>{methodRows.map(([m, v]) => <tr key={m} className="border-t"><td className="px-4 py-2 font-medium">{TENDER_LABEL[m] ?? m}</td><td className="px-4 py-2 text-right tabular-nums">{v.count}</td><td className="px-4 py-2 text-right tabular-nums">{formatPaise(v.inPaise)}</td><td className="px-4 py-2 text-right tabular-nums">{v.outPaise ? formatPaise(v.outPaise) : "—"}</td><td className="px-4 py-2 text-right font-semibold tabular-nums">{formatPaise(v.inPaise - v.outPaise)}</td></tr>)}</tbody>
            </table>
          )}
          {s.counted?.denominations && (
            <div className="border-t p-4">
              <p className="mb-2 text-xs font-medium text-muted-foreground">Notes and coins counted</p>
              <div className="flex flex-wrap gap-1.5">{Object.entries(s.counted.denominations).filter(([, n]) => n).sort((a, b) => Number(b[0]) - Number(a[0])).map(([k, n]) => <span key={k} className="rounded-lg border px-2 py-0.5 text-xs tabular-nums">₹{k} × {n}</span>)}</div>
            </div>
          )}
        </Section>
      </div>

      <Section title="Bills" description={`${s.sales.length} bill${s.sales.length === 1 ? "" : "s"} on this shift`}>
        {!s.sales.length ? <p className="p-4 text-sm text-muted-foreground">No bills yet.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground"><tr><th className="px-4 py-2">Bill no.</th><th className="px-4 py-2">Time</th><th className="px-4 py-2">Customer</th><th className="px-4 py-2 text-right">Lines</th><th className="px-4 py-2 text-right">Amount</th><th className="px-4 py-2 text-right">Due</th><th className="px-4 py-2" /></tr></thead>
              <tbody>
                {s.sales.map((d) => (
                  <tr key={d.id} className="border-t hover:bg-muted/40">
                    <td className="px-4 py-2"><Link href={`/app/m/billing/${d.id}`} className="font-mono text-xs font-medium text-primary hover:underline">{d.number}</Link></td>
                    <td className="px-4 py-2">{d.at ? new Date(d.at).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }) : "—"}</td>
                    <td className="px-4 py-2">{d.customer}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{d.lines}</td>
                    <td className={cn("px-4 py-2 text-right font-semibold tabular-nums", d.status === "cancelled" && "text-muted-foreground line-through")}>{formatPaise(d.totalPaise)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{d.duePaise > 0 && d.status !== "cancelled" ? formatPaise(d.duePaise) : "—"}</td>
                    <td className="px-4 py-2 text-right"><a href={`/print/pos/${d.id}`} target="_blank" rel="noreferrer" className={buttonVariants({ variant: "ghost", size: "icon-sm" })} aria-label={`Print ${d.number}`}><Printer /></a></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Cash in and out">
          {!s.moves.length ? <p className="p-4 text-sm text-muted-foreground">No cash put in or taken out.</p> : (
            <ul className="divide-y">
              {s.moves.map((m) => (
                <li key={m.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <span className="min-w-0 flex-1"><span className="block font-medium">{MOVE_REASON[m.reason] ?? m.reason}{m.expenseId && <Link href={`/app/m/finance/expenses/${m.expenseId}`} className="ml-2 text-xs font-normal text-primary hover:underline">Expense</Link>}</span><span className="text-xs text-muted-foreground">{[m.note, m.by, formatDateTime(m.at)].filter(Boolean).join(" · ")}</span></span>
                  <span className={cn("font-semibold tabular-nums", m.kind === "out" ? "text-destructive" : "text-emerald-700 dark:text-emerald-400")}>{m.kind === "out" ? "−" : "+"}{formatPaise(m.amountPaise)}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Section title="Top items">
          {!s.topItems.length ? <p className="p-4 text-sm text-muted-foreground">Nothing sold yet.</p> : (
            <ul className="divide-y">{s.topItems.map((i) => <li key={i.name} className="flex justify-between gap-3 px-4 py-2.5 text-sm"><span>{i.name}<span className="ml-2 text-xs text-muted-foreground">× {Number(i.qty.toFixed(3))}</span></span><span className="font-semibold tabular-nums">{formatPaise(i.totalPaise)}</span></li>)}</ul>
          )}
        </Section>
      </div>
      {s.returns.length > 0 && (
        <Section title="Returns">
          <ul className="divide-y">{s.returns.map((r) => <li key={r.id} className="flex justify-between gap-3 px-4 py-2.5 text-sm"><span><Link href={`/app/m/billing/credit-notes/${r.id}`} className="font-mono text-xs font-medium text-primary hover:underline">{r.number}</Link><span className="ml-2 text-muted-foreground">{r.customer}{r.against ? ` · on ${r.against}` : ""}</span></span><span className="font-semibold tabular-nums">{formatPaise(r.totalPaise)}</span></li>)}</ul>
        </Section>
      )}
      <Section title="About this shift">
        <div className="p-4"><DetailList items={[["Counter", s.counter.name], ["Cashier", s.openedByName], ["Opened", formatDateTime(s.openedAt)], ["Closed", s.closedAt ? `${formatDateTime(s.closedAt)}${s.closedByName ? ` by ${s.closedByName}` : ""}` : "Still open"], ["Bills cancelled later", String(s.totals.cancelled)], ["Opening cash", formatPaise(s.openingCashPaise)]]} /></div>
      </Section>
    </div>
  )
}

/** Close: count the notes and coins (or type the total), say why if it is short or over, and send cash to the bank */
function CloseForm({ shift, financeOn, onCancel, onClosed }: { shift: ShiftSummary; financeOn: boolean; onCancel: () => void; onClosed: (s: ShiftSummary) => void }) {
  const router = useRouter()
  const [counts, setCounts] = React.useState<Record<string, string>>({})
  const [byNotes, setByNotes] = React.useState(true)
  const [typed, setTyped] = React.useState<number | null>(null)
  const [note, setNote] = React.useState("")
  const [deposit, setDeposit] = React.useState<number | null>(0)
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const fromNotes = NOTES.reduce((a, n) => a + n * 100 * Number(counts[n] || 0), 0)
  const counted = byNotes ? fromNotes : typed ?? 0
  const difference = counted - shift.cash.expectedPaise
  async function close() {
    const errs: Record<string, string> = {}
    if (!byNotes && typed === null) errs.countedCashPaise = "Enter the cash counted"
    if (difference !== 0 && !note.trim()) errs.note = `Say why the drawer is ${difference < 0 ? "short" : "over"}`
    if ((deposit ?? 0) > counted) errs.depositPaise = "More than the cash counted"
    setErrors(errs)
    if (Object.keys(errs).length) return
    setBusy(true)
    setError(null)
    try {
      const denominations = byNotes ? Object.fromEntries(NOTES.filter((n) => Number(counts[n] || 0) > 0).map((n) => [String(n), Number(counts[n])])) : null
      const s = await api.post<ShiftSummary>(`/pos/shifts/${shift.id}/close`, { countedCashPaise: counted, denominations, note: note.trim() || null, depositPaise: deposit ?? 0, version: shift.version })
      toast.success(`Shift ${shift.number} closed`)
      onClosed(s)
      router.replace(`/app/m/pos/shifts/${shift.id}`)
    } catch (e) {
      if (e instanceof ApiError) setErrors(e.fields)
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Section title="Close shift" description="Count the cash in the drawer. Bills on hold stay at the counter for the next shift.">
      <div className="grid gap-5 p-4 lg:grid-cols-[1fr_320px]">
        <div className="grid gap-3">
          <div className="flex w-fit gap-1 rounded-xl border p-1 text-sm" role="radiogroup" aria-label="How to count">
            {[[true, "Count notes and coins"], [false, "Type the total"]].map(([v, l]) => <button key={String(v)} type="button" role="radio" aria-checked={byNotes === v} onClick={() => setByNotes(v as boolean)} className={cn("rounded-lg px-3 py-1.5 font-medium text-muted-foreground", byNotes === v && "bg-primary text-primary-foreground")}>{l as string}</button>)}
          </div>
          {byNotes ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              {NOTES.map((n) => (
                <label key={n} className="grid gap-1 rounded-xl border p-2 text-sm">
                  <span className="font-medium">₹{n}</span>
                  <Input inputMode="numeric" value={counts[n] ?? ""} onChange={(e) => setCounts((c) => ({ ...c, [n]: e.target.value.replace(/\D/g, "").slice(0, 6) }))} placeholder="0" aria-label={`Number of ₹${n}`} className="h-8 text-right tabular-nums" />
                  <span className="text-right text-xs text-muted-foreground tabular-nums">{formatPaise(n * 100 * Number(counts[n] || 0), true)}</span>
                </label>
              ))}
            </div>
          ) : (
            <Field label="Cash counted" error={errors.countedCashPaise} required><MoneyInput value={typed} onChange={setTyped} className="max-w-xs" /></Field>
          )}
          <Field label="Note" error={errors.note} required={difference !== 0} hint={difference !== 0 ? "Needed when the cash does not match" : undefined}>
            <Textarea rows={2} maxLength={500} value={note} onChange={(e) => { setNote(e.target.value); setErrors((x) => ({ ...x, note: "" })) }} placeholder="e.g. Gave ₹10 extra change" />
          </Field>
          {financeOn && (
            <Field label="Send to the bank now" error={errors.depositPaise} hint="Saved as a transfer from the counter's cash to its bank account. The rest stays as tomorrow's float.">
              <MoneyInput value={deposit} onChange={setDeposit} className="max-w-xs" />
            </Field>
          )}
        </div>
        <div className="grid h-fit gap-2 rounded-2xl bg-muted/50 p-4 text-sm">
          <p className="flex justify-between"><span className="text-muted-foreground">Should be in the drawer</span><span className="font-medium tabular-nums">{formatPaise(shift.cash.expectedPaise)}</span></p>
          <p className="flex justify-between"><span className="text-muted-foreground">Counted</span><span className="font-medium tabular-nums">{formatPaise(counted)}</span></p>
          <p className="flex justify-between border-t pt-2 text-base"><span className="font-semibold">Difference</span><Difference paise={difference} /></p>
          {financeOn && (deposit ?? 0) > 0 && <p className="flex justify-between text-muted-foreground"><span>Left for the next shift</span><span className="tabular-nums">{formatPaise(counted - (deposit ?? 0))}</span></p>}
          <FormError message={error} />
          <div className="mt-2 flex gap-2">
            <Button variant="outline" onClick={onCancel} disabled={busy}>Cancel</Button>
            <Button className="flex-1" onClick={() => void close()} disabled={busy}>{busy ? <Loader2 className="animate-spin" /> : <Lock />} Close shift</Button>
          </div>
        </div>
      </div>
    </Section>
  )
}

