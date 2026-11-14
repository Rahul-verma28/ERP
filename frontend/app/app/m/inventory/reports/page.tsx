"use client"

import * as React from "react"
import Link from "next/link"
import { Boxes, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { EmptyState } from "@/components/common"
import { DataList } from "@/components/data-list"
import { NearExpiryReport } from "@/components/inventory/near-expiry"
import { StockAgeingReport } from "@/components/inventory/stock-ageing"
import { formatPaise } from "@/lib/format"
import { qty, type StockRow } from "@/lib/inventory"
import { useApi } from "@/lib/use-api"
import { cn } from "@/lib/utils"
import { todayInIndia } from "@contracts/validation"

// The less frequent questions about stock, in one place.

const TABS = [["expiry", "Near Expiry"], ["ageing", "Stock Ageing"], ["date", "Stock on a Date"], ["serial", "Find Serial"]] as const
type Tab = (typeof TABS)[number][0]

function StockOnDate() {
  const [date, setDate] = React.useState(todayInIndia())
  return (
    <DataList<StockRow>
      key={date}
      id="stock-on-date"
      path="/stock"
      params={{ date }}
      header={{ title: "Stock on a Date", description: "How much you had on any past day.", actions: <Input type="date" value={date} max={todayInIndia()} onChange={(e) => setDate(e.target.value || todayInIndia())} className="w-44" aria-label="Date" /> }}
      columns={[
        { key: "name", header: "Item", hideable: false, sort: (r) => r.name, csv: (r) => r.name, cell: (r) => <span className="font-medium">{r.name}</span> },
        { key: "qty", header: "In stock", align: "right", sort: (r) => r.quantity, csv: (r) => r.quantity, cell: (r) => `${qty(r.quantity)} ${r.unit}` },
        { key: "value", header: "Value", align: "right", sort: (r) => r.valuePaise, csv: (r) => r.valuePaise / 100, cell: (r) => formatPaise(r.valuePaise) },
      ]}
      searchPlaceholder="Search item or SKU"
      exportName={`stock-${date}`}
      emptyState={<EmptyState icon={Boxes} title="No stock on this date" />}
    />
  )
}

const SERIAL_STATUS: Record<string, string> = { in_stock: "In stock", sold: "Sold", transit: "On the way", gone: "Written off" }

function FindSerial() {
  const [serial, setSerial] = React.useState("")
  const [asked, setAsked] = React.useState("")
  const found = useApi<{ data: { itemId: string; item: string; status: string }[] }>(asked ? `/stock/serials/${encodeURIComponent(asked)}` : null)
  return (
    <section className="ui-surface grid gap-4 p-5">
      <div><h1 className="text-[26px] font-bold tracking-tight">Find Serial</h1><p className="text-sm text-muted-foreground">Where a serial or IMEI number is now.</p></div>
      <form className="flex max-w-md gap-2" onSubmit={(e) => { e.preventDefault(); setAsked(serial.trim()) }}>
        <Input value={serial} onChange={(e) => setSerial(e.target.value)} placeholder="Serial or IMEI number" aria-label="Serial number" />
        <Button type="submit"><Search /> Find</Button>
      </form>
      {asked && found.data && (found.data.data.length ? found.data.data.map((r) => <Link key={r.itemId} href={`/app/m/catalog/${r.itemId}?tab=stock`} className="text-sm hover:underline"><strong>{r.item}</strong>: {SERIAL_STATUS[r.status] ?? r.status}</Link>) : <p className="text-sm text-muted-foreground">Not found.</p>)}
    </section>
  )
}

export default function StockReportsPage() {
  const [tab, setTab] = React.useState<Tab>("expiry")
  return (
    <div className="grid gap-4">
      <div className="flex w-fit flex-wrap gap-1 rounded-xl border p-1 text-sm" role="tablist" aria-label="Reports">
        {TABS.map(([key, label]) => <button key={key} role="tab" aria-selected={tab === key} onClick={() => setTab(key)} className={cn("rounded-lg px-3 py-1.5 font-medium text-muted-foreground", tab === key && "bg-primary text-primary-foreground")}>{label}</button>)}
      </div>
      {tab === "expiry" && <NearExpiryReport />}
      {tab === "ageing" && <StockAgeingReport />}
      {tab === "date" && <StockOnDate />}
      {tab === "serial" && <FindSerial />}
    </div>
  )
}
