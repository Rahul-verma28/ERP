"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { CreditCard } from "lucide-react"
import { LoadMore } from "@/components/common"
import { Chip, Empty, Failed, Loading, Page, Panel, relDays, type Tone } from "@/components/console/kit"
import { useAuth } from "@/lib/auth"
import { useList } from "@/lib/use-list"
import { formatDate, formatPaise } from "@/lib/format"
import { ORDER_STATUS_LABEL, type OrderRow, type OrderStatus } from "@/lib/console"
import { cn } from "@/lib/utils"

// Payments: every order for an AHEAD plan, whether it's paid, and its GST invoice.

const TABS: { value: string; label: string }[] = [
  { value: "", label: "All" },
  { value: "awaiting_payment", label: "Waiting for payment" },
  { value: "pending_approval", label: "Discount to approve" },
  { value: "paid", label: "Paid" },
  { value: "cancelled", label: "Cancelled" },
]
const TONE: Record<OrderStatus, Tone> = { pending_approval: "amber", awaiting_payment: "amber", paid: "green", cancelled: "grey" }

function PaymentsList() {
  const router = useRouter()
  const params = useSearchParams()
  const { me } = useAuth()
  const [status, setStatus] = React.useState(params.get("status") ?? "")
  const list = useList<OrderRow>("/console/orders", { status })
  const vendor = me?.console?.audience === "vendor"

  return (
    <Page title="Payments" subtitle={vendor ? "Orders from the clients you brought in, and whether they've paid." : "Every order for an AHEAD plan, whether it's paid, and its GST invoice."}>
      <div className="flex gap-1 overflow-x-auto rounded-xl border bg-card p-1" role="tablist" aria-label="Status">
        {TABS.map((t) => (
          <button key={t.value || "all"} type="button" role="tab" aria-selected={status === t.value} onClick={() => setStatus(t.value)} className={cn("h-8 shrink-0 rounded-lg px-3 text-[13px] font-medium", status === t.value ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground")}>
            {t.label}
          </button>
        ))}
      </div>
      <Panel padded={false}>
        {list.error ? (
          <div className="p-5">
            <Failed error={list.error} onRetry={list.reload} />
          </div>
        ) : list.loading ? (
          <Loading rows={5} className="p-5" />
        ) : !list.rows.length ? (
          <Empty icon={CreditCard} title="No orders here" text="An order is made when you add a client or convert a trial to paid." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="px-5 py-3 font-medium">Client</th>
                  <th className="px-3 py-3 font-medium">Status</th>
                  <th className="px-3 py-3 text-right font-medium">Amount</th>
                  <th className="px-3 py-3 font-medium">Date</th>
                  <th className="px-5 py-3 font-medium">Invoice</th>
                </tr>
              </thead>
              <tbody>
                {list.rows.map((o) => (
                  <tr key={o.id} onClick={() => router.push(`/console/payments/${o.id}`)} className="cursor-pointer border-b last:border-0 hover:bg-muted/50">
                    <td className="px-5 py-3.5">
                      <Link href={`/console/payments/${o.id}`} onClick={(e) => e.stopPropagation()} className="font-medium hover:underline">
                        {o.clientName ?? "Client"}
                      </Link>
                      <div className="text-[13px] text-muted-foreground">
                        {o.kind === "renewal" ? "Renewal · " : ""}
                        {o.cycle === "yearly" ? "Yearly" : "Monthly"}
                        {o.discountBp > 0 && ` · ${o.discountBp / 100}% off`}
                        {o.createdByName ? ` · by ${o.createdByName}` : ""}
                      </div>
                    </td>
                    <td className="px-3 py-3.5">
                      <Chip tone={TONE[o.status]}>{ORDER_STATUS_LABEL[o.status]}</Chip>
                      {o.status === "awaiting_payment" && <div className="mt-1 text-[13px] text-muted-foreground">cancels {relDays(o.expiresAt)}</div>}
                    </td>
                    <td className="px-3 py-3.5 text-right tabular-nums">{formatPaise(o.totalPaise)}</td>
                    <td className="px-3 py-3.5 text-muted-foreground">{formatDate(o.paidAt ?? o.createdAt)}</td>
                    <td className="px-5 py-3.5">
                      {o.invoice ? (
                        <Link href={`/console/invoices/${o.invoice.id}`} onClick={(e) => e.stopPropagation()} className="font-mono text-[13px] hover:underline">
                          {o.invoice.number}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <LoadMore hasMore={list.hasMore} loading={list.loadingMore} onClick={list.loadMore} />
      </Panel>
    </Page>
  )
}

export default function PaymentsPage() {
  return (
    <React.Suspense>
      <PaymentsList />
    </React.Suspense>
  )
}
