"use client"

import * as React from "react"
import Link from "next/link"
import { toast } from "sonner"
import { ClipboardList, PackageCheck } from "lucide-react"
import { BackLink, DetailHeader, Pill, Section, StatGrid, Steps, type Step } from "@/components/page-parts"
import { Button } from "@/components/ui/button"
import { api, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useApi } from "@/lib/use-api"
import { formatDate, formatPaise } from "@/lib/format"
import { ENTRY_LABEL, REASONS, qty, type StockEntry } from "@/lib/inventory"
import { PageError, PageLoading } from "@/components/page-states"

export default function StockEntryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = React.use(params)
  const { can } = useAuth()
  const { data: e, error, setData } = useApi<StockEntry>(`/stock/entries/${id}`)
  const [busy, setBusy] = React.useState(false)
  if (error) return <PageError error={error} />
  if (!e) return <PageLoading />
  const showValue = can("inventory.valuation.view") || can("inventory.receipt.create")
  const count = e.kind === "count"
  const costed = e.lines.some((l) => l.ratePaise != null)

  async function receive() {
    setBusy(true)
    try {
      setData(await api.post<StockEntry>(`/stock/entries/${id}/receive`))
      toast.success("Received. Stock is in the warehouse now.")
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const transfer = e.kind === "transfer"
  const steps: Step[] | null = transfer ? [
    { key: "sent", label: `Sent from ${e.location}`, sub: formatDate(e.entryDate), state: "done" },
    { key: "way", label: "On the way", state: e.status === "in_transit" ? "current" : "done", color: "amber" },
    { key: "got", label: `Received at ${e.toLocation}`, sub: e.receivedAt ? formatDate(e.receivedAt) : undefined, state: e.status === "received" ? "current" : e.status === "in_transit" ? "todo" : "done", color: "emerald" },
  ] : null
  return (
    <div className="grid gap-5">
      <BackLink href={transfer ? "/app/m/inventory/transfers" : "/app/m/inventory/entries"}>{transfer ? "Transfers" : "Stock entries"}</BackLink>
      <DetailHeader
        title={ENTRY_LABEL[e.kind]}
        icon={ClipboardList}
        pills={<>{e.status === "in_transit" && <Pill color="amber" dot>On the way</Pill>}{e.status === "received" && <Pill color="emerald">Received</Pill>}</>}
        subtitle={[formatDate(e.entryDate), e.toLocation ? `${e.location} → ${e.toLocation}` : e.location].filter(Boolean).join(" · ")}
        actions={e.status === "in_transit" && can("inventory.transfer.create") ? <Button disabled={busy} onClick={receive}><PackageCheck /> {busy ? "Receiving…" : `Received at ${e.toLocation}`}</Button> : undefined}
      />
      {steps && <Steps steps={steps} label="Transfer" />}
      <StatGrid items={[
        { label: "Items", value: e.lines.length },
        showValue && { label: "Value", value: formatPaise(e.valuePaise) },
        e.reason ? { label: "Reason", value: REASONS.find((r) => r.value === e.reason)?.label ?? e.reason } : e.party ? { label: "Supplier", value: e.party, hint: e.reference ?? undefined } : null,
        { label: "Warehouse", value: e.toLocation ? `${e.location} → ${e.toLocation}` : e.location },
      ]} />
      {e.note && <Section title="Note"><p className="text-sm whitespace-pre-wrap">{e.note}</p></Section>}
      <Section title="Items" flush>
        <div className="overflow-x-auto px-5 py-2">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="py-2 pr-3 font-medium">Item</th>
                {count ? (
                  <>
                    <th className="py-2 pr-3 text-right font-medium">Books</th>
                    <th className="py-2 pr-3 text-right font-medium">Counted</th>
                    <th className="py-2 text-right font-medium">Difference</th>
                  </>
                ) : (
                  <>
                    <th className="py-2 pr-3 text-right font-medium">Quantity</th>
                    {showValue && costed && <th className="py-2 text-right font-medium">Cost per unit</th>}
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {e.lines.map((l, i) => (
                <tr key={i} className="border-b border-border/60 align-top">
                  <td className="py-2 pr-3">
                    <Link href={`/app/m/catalog/${l.itemId}?tab=stock`} className="hover:underline">{l.name}</Link>
                    {l.batch && <span className="block text-xs text-muted-foreground">Batch {l.batch}</span>}
                    {!!l.batches?.length && <span className="block text-xs text-muted-foreground">{l.batches.map((b) => `Batch ${b.number}${b.expiry ? ` · exp ${formatDate(b.expiry)}` : ""}${l.batches!.length > 1 ? ` (${qty(b.quantity)})` : ""}`).join(", ")}</span>}
                    {!!l.serials?.length && <span className="block text-xs text-muted-foreground">S/N: {l.serials.join(", ")}</span>}
                  </td>
                  {count ? (
                    <>
                      <td className="py-2 pr-3 text-right tabular-nums">{qty(l.system ?? 0)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{qty(l.counted ?? 0)}</td>
                      <td className={"py-2 text-right font-medium tabular-nums" + ((l.difference ?? 0) < 0 ? " text-destructive" : "")}>{(l.difference ?? 0) > 0 ? "+" : ""}{qty(l.difference ?? 0)}</td>
                    </>
                  ) : (
                    <>
                      <td className="py-2 pr-3 text-right tabular-nums">{qty(l.quantity ?? 0)} {l.unit ?? ""}{l.baseQuantity !== undefined && l.baseQuantity !== l.quantity && <span className="block text-xs text-muted-foreground">{qty(l.baseQuantity)} in base unit</span>}</td>
                      {showValue && costed && <td className="py-2 text-right tabular-nums">{l.ratePaise != null ? formatPaise(l.ratePaise) : "—"}</td>}
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  )
}
