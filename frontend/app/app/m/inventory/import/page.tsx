"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { toast } from "sonner"
import { ArrowLeft, Download, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { PageHeader } from "@/components/app-shell"
import { Spinner } from "@/components/common"
import { Field, FormError, NativeSelect } from "@/components/form"
import { parseSerials } from "@/components/stock-line"
import { api, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useApi } from "@/lib/use-api"
import { downloadCsv, parseCsv } from "@/lib/csv"
import { qty, type BatchRow, type StockEntry, type StockLocation } from "@/lib/inventory"
import { todayInIndia } from "@contracts/validation"

// Opening stock or a stock count from a spreadsheet saved as CSV. Items are matched by SKU,
// barcode or exact name; every row is checked and shown before anything is posted.

type Kind = "opening" | "count"
const TEMPLATE: Record<Kind, (string | number)[][]> = {
  opening: [["Item", "Quantity", "Cost per unit", "Batch", "Expiry", "Serial numbers"], ["Ceiling fan", 20, 1450, "", "", ""], ["Cough syrup 100ml", 50, 62.5, "B2311", "2027-03-31", ""], ["Phone X1", 2, 9800, "", "", "IMEI001 IMEI002"]],
  count: [["Item", "Batch", "Counted"], ["Ceiling fan", "", 18], ["Cough syrup 100ml", "B2311", 47]],
}
const MAX_ROWS = 2000

interface Item { id: string; name: string; unit: string; tracking: "none" | "batch" | "serial" }
interface Row { n: number; ref: string; item: Item | null; quantity: number; ratePaise: number | null; batch: string; expiry: string | null; serials: string[]; batchId?: string; problem: string | null }

/** 31-03-2027, 31/03/2027 or 2027-03-31 to 2027-03-31; anything else is null */
function isoDate(v: string) {
  const s = v.trim()
  if (!s) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/)
  return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : "bad"
}

function ImportStock() {
  const router = useRouter()
  const params = useSearchParams()
  const kind: Kind = params.get("kind") === "count" ? "count" : "opening"
  const { can } = useAuth()
  const locations = useApi<{ data: StockLocation[] }>("/stock-locations")
  const warehouses = (locations.data?.data ?? []).filter((l) => l.isActive)
  const [locationId, setLocationId] = React.useState("")
  const at = locationId || warehouses.find((g) => g.isDefault)?.id || warehouses[0]?.id || ""
  const [date, setDate] = React.useState(todayInIndia())
  const [rows, setRows] = React.useState<Row[] | null>(null)
  const [fileError, setFileError] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)

  if (!can(kind === "count" ? "inventory.stock_count.create" : "inventory.receipt.create")) return <PageHeader title="Import stock" description="You don't have access to this. Ask your admin." />
  if (!locations.data) return <div className="grid place-items-center py-24"><Spinner /></div>

  async function read(f: File) {
    setFileError(null)
    setRows(null)
    if (!/\.csv$/i.test(f.name)) return setFileError("Use a .csv file. In Excel: File › Save as › CSV (Comma delimited).")
    const [header, ...body] = parseCsv(await f.text()).filter((r) => r.some((c) => c.trim()))
    if (!header) return setFileError("The file is empty.")
    if (body.length > MAX_ROWS) return setFileError(`This file has ${body.length} rows; import up to ${MAX_ROWS} at a time.`)
    const col = (name: string) => header.findIndex((h) => h.trim().toLowerCase() === name)
    const c = { item: col("item"), qty: col(kind === "count" ? "counted" : "quantity"), cost: col("cost per unit"), batch: col("batch"), expiry: col("expiry"), serials: col("serial numbers") }
    if (c.item < 0 || c.qty < 0 || (kind === "opening" && c.cost < 0)) return setFileError(`Columns needed: ${TEMPLATE[kind][0].join(", ")}. Download the template to start from.`)
    const refs = [...new Set(body.map((r) => (r[c.item] ?? "").trim()).filter(Boolean))]
    const matched = refs.length ? (await api.post<{ data: Record<string, Item | null> }>("/stock/import/resolve", { refs })).data : {}
    const batchCache = new Map<string, BatchRow[]>()
    const out: Row[] = []
    for (const [i, r] of body.entries()) {
      const ref = (r[c.item] ?? "").trim()
      const item = ref ? matched[ref] ?? null : null
      const quantity = Number((r[c.qty] ?? "").replace(/,/g, ""))
      const cost = c.cost >= 0 ? Number((r[c.cost] ?? "").replace(/[₹,\s]/g, "")) : NaN
      const batch = c.batch >= 0 ? (r[c.batch] ?? "").trim() : ""
      const expiry = c.expiry >= 0 ? isoDate(r[c.expiry] ?? "") : null
      const serials = c.serials >= 0 ? parseSerials(r[c.serials] ?? "") : []
      let problem: string | null = null
      let batchId: string | undefined
      if (!ref) problem = "No item"
      else if (!item) problem = "No item with this name, SKU or barcode"
      else if (!(quantity >= 0) || (kind === "opening" && !(quantity > 0))) problem = "Quantity must be a number above 0"
      else if (kind === "opening" && !(cost >= 0)) problem = "Cost must be a number"
      else if (expiry === "bad") problem = "Expiry must be like 2027-03-31 or 31-03-2027"
      else if (item.tracking === "batch" && !batch) problem = "Batch item: give the batch"
      else if (kind === "opening" && item.tracking === "serial" && serials.length !== quantity) problem = `Give ${quantity} serial numbers`
      else if (kind === "count" && item.tracking === "serial") problem = "Serial items are counted by number in an adjustment"
      if (!problem && kind === "count" && item!.tracking === "batch") {
        if (!batchCache.has(item!.id)) batchCache.set(item!.id, (await api.get<{ data: BatchRow[] }>(`/stock/items/${item!.id}/batches?locationId=${at}&expired=true`)).data)
        batchId = batchCache.get(item!.id)!.find((b) => b.number === batch)?.id
        if (!batchId) problem = `No stock in batch ${batch} here`
      }
      out.push({ n: i + 2, ref, item, quantity, ratePaise: cost >= 0 ? Math.round(cost * 100) : null, batch, expiry: expiry === "bad" ? null : expiry, serials, batchId, problem })
    }
    setRows(out)
  }

  const good = (rows ?? []).filter((r) => !r.problem)
  const bad = (rows ?? []).filter((r) => r.problem)

  async function post() {
    setBusy(true)
    setError(null)
    try {
      const entry = kind === "opening"
        ? await api.post<StockEntry>("/stock/entries", {
            kind: "opening", locationId: at, date, note: "Imported from a spreadsheet",
            lines: good.map((r) => ({ itemId: r.item!.id, quantity: r.quantity, ratePaise: r.ratePaise ?? 0, ...(r.item!.tracking === "batch" ? { batchNo: r.batch, expiryDate: r.expiry } : {}), ...(r.item!.tracking === "serial" ? { serials: r.serials } : {}) })),
          })
        : await api.post<StockEntry>("/stock/counts", { locationId: at, note: "Imported from a spreadsheet", lines: good.map((r) => ({ itemId: r.item!.id, ...(r.batchId ? { batchId: r.batchId } : {}), counted: r.quantity })) })
      toast.success(`${good.length} row${good.length === 1 ? "" : "s"} posted`)
      router.push(`/app/m/inventory/entries/${entry.id}`)
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  return (
    <>
      <Link href="/app/m/inventory" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> {kind === "count" ? "Stock count" : "Stock"}</Link>
      <PageHeader title={kind === "count" ? "Import a stock count" : "Import opening stock"} description="Fill the template in Excel, save it as CSV, and upload it. Items match by SKU, barcode or exact name." />
      <Card>
        <CardContent className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-3 sm:items-end">
            {warehouses.length > 1 && (
              <Field label="Warehouse">
                <NativeSelect value={at} onChange={(e) => { setLocationId(e.target.value); setRows(null) }} aria-label="Warehouse">
                  {warehouses.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                </NativeSelect>
              </Field>
            )}
            {kind === "opening" && <Field label="Opening date"><Input type="date" value={date} max={todayInIndia()} onChange={(e) => setDate(e.target.value)} /></Field>}
            <Button variant="outline" onClick={() => downloadCsv(`${kind === "count" ? "stock-count" : "opening-stock"}-template.csv`, TEMPLATE[kind])}><Download /> Template</Button>
          </div>
          <label className="flex cursor-pointer flex-col items-center gap-2 rounded-2xl border border-dashed p-8 text-sm text-muted-foreground hover:bg-muted/50">
            <Upload className="size-5" />
            <span>Choose a .csv file</span>
            <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => e.target.files?.[0] && read(e.target.files[0])} />
          </label>
          <FormError message={fileError} />
          {rows && (
            <>
              <p className="text-sm"><span className="font-medium">{good.length}</span> ready · <span className={bad.length ? "font-medium text-destructive" : ""}>{bad.length} to fix</span></p>
              <div className="max-h-96 overflow-auto rounded-2xl border">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-card">
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="px-3 py-2 font-medium">Row</th>
                      <th className="px-3 py-2 font-medium">Item</th>
                      <th className="px-3 py-2 text-right font-medium">{kind === "count" ? "Counted" : "Quantity"}</th>
                      {kind === "opening" && <th className="px-3 py-2 text-right font-medium">Cost</th>}
                      <th className="px-3 py-2 font-medium">Batch / serials</th>
                      <th className="px-3 py-2 font-medium">Check</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.n} className="border-b border-border/60">
                        <td className="px-3 py-1.5 text-muted-foreground">{r.n}</td>
                        <td className="px-3 py-1.5">{r.item?.name ?? r.ref}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{Number.isFinite(r.quantity) ? qty(r.quantity) : "—"}</td>
                        {kind === "opening" && <td className="px-3 py-1.5 text-right tabular-nums">{r.ratePaise !== null ? (r.ratePaise / 100).toFixed(2) : "—"}</td>}
                        <td className="px-3 py-1.5 text-xs text-muted-foreground">{[r.batch && `Batch ${r.batch}`, r.expiry && `exp ${r.expiry}`, r.serials.length ? `${r.serials.length} serials` : null].filter(Boolean).join(" · ") || "—"}</td>
                        <td className={"px-3 py-1.5 text-xs" + (r.problem ? " text-destructive" : " text-emerald-700 dark:text-emerald-400")}>{r.problem ?? "OK"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {bad.length > 0 && <p className="text-xs text-muted-foreground">Rows to fix are left out. Fix them in the file and import them again.</p>}
              <FormError message={error} />
              <div className="flex justify-end"><Button disabled={busy || !good.length} onClick={post}>{busy ? "Posting…" : `Post ${good.length} row${good.length === 1 ? "" : "s"}`}</Button></div>
            </>
          )}
        </CardContent>
      </Card>
    </>
  )
}

export default function ImportStockPage() {
  return (
    <React.Suspense>
      <ImportStock />
    </React.Suspense>
  )
}
