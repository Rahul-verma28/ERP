"use client"

import * as React from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Check, Copy, History as HistoryIcon } from "lucide-react"
import { Spinner } from "@/components/common"
import { Avatar, Section } from "@/components/page-parts"
import { PageError } from "@/components/page-states"
import { formatDateTime, formatPaise } from "@/lib/format"
import { useApi } from "@/lib/use-api"
import { cn } from "@/lib/utils"

// What every record page has besides its own content: the open tab kept in the address, the
// record's history from the audit log, and an "About" card (who made it and when, its ID).

/** The open tab, kept in ?tab= so a reload, the back button or a shared link opens the same one */
export function useTabParam<K extends string>(keys: readonly K[], fallback: K) {
  const router = useRouter()
  const params = useSearchParams()
  const asked = params.get("tab") as K | null
  const tab = asked && keys.includes(asked) ? asked : fallback
  const setTab = React.useCallback((k: K) => {
    const q = new URLSearchParams(params.toString())
    if (k === fallback) q.delete("tab")
    else q.set("tab", k)
    const s = q.toString()
    router.replace(s ? `?${s}` : "?", { scroll: false })
  }, [params, router, fallback])
  return [tab, setTab] as const
}

export type HistoryKind =
  | "item" | "price_list" | "customer" | "supplier" | "lead" | "deal" | "sales_doc" | "quotation" | "payment" | "purchase" | "supplier_payment"
  | "stock_entry" | "warehouse" | "employee" | "payroll" | "expense" | "income" | "journal" | "account" | "project" | "approval"

interface Entry { id: string; at: string; action: string; other: string | null; by: string; details: { key: string; value: unknown; was?: unknown }[] }

// "billing.invoice.issue" → "Invoice issued"; known ones read better by hand
const SAID: Record<string, string> = {
  "billing.payment.record": "Payment recorded", "billing.payment.reverse": "Payment reversed", "billing.receipt.record": "Payment received",
  "billing.advance.record": "Advance received", "billing.advance.use": "Advance used", "billing.advance.remove": "Advance taken off", "billing.credit_note.use": "Credit note used",
  "billing.refund.create": "Refund paid", "billing.invoice.over_credit_limit": "Went over the credit limit", "billing.invoice.remind": "Reminder sent",
  "billing.gst_refs.save": "E-invoice / e-way details saved", "billing.opening_balance.set": "Opening balance set", "crm.contact.import": "Imported",
  "sales.order.invoice": "Invoiced", "sales.order.challan": "Delivery challan made", "sales.delivery.invoice": "Invoiced",
  "inventory.supplier_payment.create": "Payment made", "inventory.supplier_payment.reverse": "Payment reversed", "member.role_change": "Role changed",
}
const VERB: Record<string, string> = {
  create: "created", update: "updated", edit: "edited", delete: "deleted", issue: "issued", cancel: "cancelled", archive: "archived", restore: "restored",
  approve: "approved", complete: "completed", draft: "saved as draft", won: "won", lost: "lost", exit: "exited", post: "posted", pay: "paid", reopen: "reopened",
}
const KEY: Record<string, string> = {
  totalPaise: "Total", amountPaise: "Amount", valuePaise: "Value", basicPaise: "Basic pay", discountBp: "Discount", number: "Number", invoice: "Invoice", bill: "Bill",
  creditNote: "Credit note", advance: "Advance", from: "Made from", method: "Paid by", reason: "Reason", name: "Name", title: "Title", status: "Status", lines: "Lines",
  exitOn: "Last day", exitReason: "Why", type: "Type", kind: "Kind", supplier: "Supplier", contact: "Customer", bills: "Bills", isDefault: "Default",
}
export function actionLabel(action: string) {
  if (SAID[action]) return SAID[action]
  const parts = action.split(".")
  const verb = parts.at(-1) ?? action
  const what = (parts.at(-2) ?? "").replace(/_/g, " ")
  return `${what ? what[0].toUpperCase() + what.slice(1) : "Record"} ${VERB[verb] ?? verb.replace(/_/g, " ")}`
}
const show = (key: string, v: unknown) => {
  if (typeof v === "boolean") return v ? "Yes" : "No"
  if (typeof v === "number" && key.endsWith("Paise")) return formatPaise(v)
  if (typeof v === "number" && key.endsWith("Bp")) return `${v / 100}%`
  if (typeof v === "string" && key === "method") return { upi: "UPI", cash: "Cash", card: "Card", bank: "Bank transfer", cheque: "Cheque" }[v] ?? v
  return String(v)
}

/**
 * The History tab: what happened to the record, newest first, ending with when it was made.
 * `ref` is its number or name, so entries that name it (a payment on this invoice) show too.
 */
export function RecordHistory({ kind, id, refText, created }: { kind: HistoryKind; id: string; refText?: string | null; created?: { at: string | null | undefined; by?: string | null } }) {
  const res = useApi<{ data: Entry[] }>(`/history?kind=${kind}&id=${id}${refText ? `&ref=${encodeURIComponent(refText)}` : ""}`)
  const rows = res.data?.data ?? []
  return (
    <Section title="History" description="What happened to this record and who did it" flush>
      {res.error && !res.data ? <PageError error={res.error} onRetry={() => void res.reload()} /> : !res.data ? <div className="grid place-items-center py-10"><Spinner /></div> : (
        <ol className="relative grid gap-0 px-5 py-4">
          {rows.map((e) => (
            <li key={e.id} className="relative flex gap-3 pb-5 last:pb-0">
              <span className="absolute top-8 bottom-0 left-4 w-px bg-border" aria-hidden />
              <Avatar name={e.by} className="size-8 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-sm"><span className="font-semibold">{actionLabel(e.action)}</span> <span className="text-muted-foreground">by {e.by}</span></p>
                <p className="text-xs text-muted-foreground">{formatDateTime(e.at)}</p>
                {e.details.length > 0 && (
                  <dl className="mt-1.5 flex flex-wrap gap-1.5">
                    {e.details.map((d) => (
                      <div key={d.key} className="rounded-lg border bg-muted/40 px-2 py-0.5 text-xs">
                        <dt className="inline text-muted-foreground">{KEY[d.key] ?? d.key.replace(/([A-Z])/g, " $1").toLowerCase()}: </dt>
                        <dd className="inline font-medium">{d.was !== undefined && <><span className="text-muted-foreground line-through">{show(d.key, d.was)}</span> → </>}{show(d.key, d.value)}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </div>
            </li>
          ))}
          {created?.at && (
            <li className="relative flex gap-3">
              <span className="grid size-8 shrink-0 place-items-center rounded-full bg-primary/10 text-primary"><HistoryIcon className="size-4" /></span>
              <div><p className="text-sm"><span className="font-semibold">Created</span>{created.by && <span className="text-muted-foreground"> by {created.by}</span>}</p><p className="text-xs text-muted-foreground">{formatDateTime(created.at)}</p></div>
            </li>
          )}
          {!rows.length && !created?.at && <p className="py-6 text-center text-sm text-muted-foreground">Nothing recorded yet.</p>}
        </ol>
      )}
    </Section>
  )
}

/** Who made the record and when, when it last changed, and its ID to copy for support */
export function AboutCard({ id, createdAt, createdBy, updatedAt, extra, className }: { id: string; createdAt?: string | null; createdBy?: string | null; updatedAt?: string | null; extra?: [string, React.ReactNode][]; className?: string }) {
  const [copied, setCopied] = React.useState(false)
  const copy = () => { void navigator.clipboard?.writeText(id).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) }) }
  const rows: [string, React.ReactNode][] = [
    ...(extra ?? []),
    ...(createdBy ? [["Created by", createdBy] as [string, React.ReactNode]] : []),
    ...(createdAt ? [["Created on", formatDateTime(createdAt)] as [string, React.ReactNode]] : []),
    ...(updatedAt && updatedAt !== createdAt ? [["Last changed", formatDateTime(updatedAt)] as [string, React.ReactNode]] : []),
  ]
  return (
    <Section title="About this record" className={className}>
      <dl className="grid gap-2.5 text-sm">
        {rows.map(([k, v]) => <div key={k} className="flex justify-between gap-3"><dt className="text-muted-foreground">{k}</dt><dd className="text-right font-medium">{v}</dd></div>)}
        <div className="flex items-center justify-between gap-3">
          <dt className="text-muted-foreground">Record ID</dt>
          <dd><button type="button" onClick={copy} className={cn("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground hover:bg-muted", copied && "text-emerald-600")} title="Copy the ID">{copied ? <Check className="size-3" /> : <Copy className="size-3" />}{id.slice(0, 8)}…</button></dd>
        </div>
      </dl>
    </Section>
  )
}
