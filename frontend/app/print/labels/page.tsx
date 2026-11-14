"use client"

import * as React from "react"
import { useSearchParams } from "next/navigation"
import { Printer } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { api } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { formatPaise } from "@/lib/format"
import { code128Path } from "@/lib/code128"
import { PageError } from "@/components/page-states"

// Barcode labels for items: name, price and a Code 128 barcode of the item's barcode (or SKU).
// Printed on A4 sheets of 3 × 8 labels; copies per item is chosen on the page.

interface LabelItem { id: string; name: string; pricePaise: number; barcode: string | null; sku: string | null; unit: string }

function Bars({ text }: { text: string }) {
  const bars = code128Path(text, 1, 34)
  if (!bars) return <p className="text-[9px] text-red-600">Can&apos;t print this code</p>
  return (
    <svg viewBox={`0 0 ${bars.width} ${bars.height}`} className="h-9 w-full" preserveAspectRatio="none" role="img" aria-label={`Barcode ${text}`}>
      <path d={bars.d} fill="#000" />
    </svg>
  )
}

function Labels() {
  const params = useSearchParams()
  const { me } = useAuth()
  const ids = (params.get("ids") ?? "").split(",").filter(Boolean).slice(0, 100)
  const [items, setItems] = React.useState<LabelItem[] | null>(null)
  const [copies, setCopies] = React.useState(params.get("copies") ?? "1")
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    Promise.all(ids.map((id) => api.get<LabelItem>(`/items/${id}`)))
      .then(setItems)
      .catch((e) => setError(e.message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params])

  if (error) return <PageError error={new Error(error)} />
  if (!items) return <p className="p-6 text-sm text-neutral-500">Loading…</p>
  const n = Math.min(Math.max(Number(copies) || 1, 1), 100)
  const labels = items.flatMap((it) => Array.from({ length: n }, () => it))
  const missing = items.filter((it) => !it.barcode && !it.sku)

  return (
    <div className="min-h-svh bg-neutral-100 p-4 text-neutral-900 [color-scheme:light] print:bg-white print:p-0">
      <div className="mx-auto mb-4 flex max-w-[210mm] flex-wrap items-end justify-between gap-3 print:hidden">
        <div>
          <p className="text-sm font-medium">{labels.length} label{labels.length === 1 ? "" : "s"} on A4, 24 a sheet</p>
          {missing.length > 0 && <p className="text-xs text-red-600">No barcode or SKU: {missing.map((m) => m.name).join(", ")}. Add one on the item first.</p>}
        </div>
        <div className="flex items-end gap-2">
          <label className="grid gap-1 text-xs">Copies of each<Input inputMode="numeric" value={copies} onChange={(e) => setCopies(e.target.value.replace(/\D/g, "").slice(0, 3))} className="h-9 w-20 bg-white text-neutral-900" /></label>
          <Button onClick={() => window.print()}><Printer /> Print</Button>
        </div>
      </div>
      <div className="mx-auto grid max-w-[210mm] grid-cols-3 gap-0 bg-white print:max-w-none">
        {labels.map((it, i) => {
          const code = it.barcode || it.sku
          return (
            <div key={i} className="flex h-[37mm] flex-col justify-between overflow-hidden border border-dashed border-neutral-300 p-2 text-black print:break-inside-avoid print:border-neutral-200">
              <p className="truncate text-[10px] text-neutral-600">{me?.tenant?.name}</p>
              <p className="line-clamp-2 text-xs font-semibold leading-tight">{it.name}</p>
              <p className="text-sm font-bold">{formatPaise(it.pricePaise)}<span className="text-[10px] font-normal"> / {it.unit}</span></p>
              {code ? <><Bars text={code} /><p className="text-center font-mono text-[9px] tracking-wider">{code}</p></> : <p className="text-[9px] text-red-600">No barcode</p>}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function LabelsPage() {
  return (
    <React.Suspense>
      <Labels />
    </React.Suspense>
  )
}
