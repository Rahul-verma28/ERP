"use client"

import * as React from "react"
import { Input } from "@/components/ui/input"
import { NativeSelect } from "@/components/form"
import { useAuth } from "@/lib/auth"
import { useApi } from "@/lib/use-api"
import { formatDate } from "@/lib/format"
import type { DocLine } from "@/lib/sales"

// The stock side of one bill line: its unit (base or the second unit, like box), the batch it sells
// from, and the serial numbers of the pieces. Shown only for items Inventory tracks.

interface ItemMeta {
  id: string
  unit: string
  trackStock?: boolean
  tracking?: "none" | "batch" | "serial"
  altUnit?: string | null
  altFactor?: number | null
}
interface Batch { id: string; number: string; expiryDate: string | null; quantity: number; expired: boolean }

export const parseSerials = (text: string) => [...new Set(text.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean))]

export function LineStockFields({ line, onChange, sale = true }: { line: DocLine; onChange: (patch: Partial<DocLine>) => void; sale?: boolean }) {
  const { can } = useAuth()
  const item = useApi<ItemMeta>(line.itemId ? `/items/${line.itemId}` : null).data
  const tracked = !!item?.trackStock && can("inventory.stock.view")
  const batches = useApi<{ data: Batch[] }>(tracked && item?.tracking === "batch" && sale ? `/stock/items/${item.id}/batches` : null).data?.data
  const serialsInStock = useApi<{ data: string[] }>(tracked && item?.tracking === "serial" && sale ? `/stock/items/${item.id}/serials` : null).data?.data
  const [serialText, setSerialText] = React.useState((line.serials ?? []).join(", "))
  const listId = React.useId()

  const unitControl =
    item?.altUnit && item.altFactor ? (
      <div className="w-28">
        <NativeSelect
          value={line.unit === item.altUnit ? "alt" : "base"}
          onChange={(e) => {
            const toAlt = e.target.value === "alt"
            if (toAlt === (line.unit === item.altUnit)) return
            // A box costs as many pieces as it holds
            const rate = toAlt ? Math.round(line.unitPricePaise * item.altFactor!) : Math.round(line.unitPricePaise / item.altFactor!)
            onChange({ unit: toAlt ? item.altUnit! : item.unit, unitPricePaise: rate })
          }}
          aria-label="Unit"
        >
          <option value="base">{item.unit}</option>
          <option value="alt">{item.altUnit} ({item.altFactor} {item.unit})</option>
        </NativeSelect>
      </div>
    ) : (
      <Input value={line.unit} onChange={(e) => onChange({ unit: e.target.value })} className="h-8 w-20 text-xs" aria-label="Unit" />
    )

  return (
    <>
      {unitControl}
      {tracked && item?.tracking === "batch" && sale && (
        <div className="w-48">
          <NativeSelect value={line.batchId ?? ""} onChange={(e) => onChange({ batchId: e.target.value || null })} aria-label="Batch">
            <option value="">Batch: earliest expiry</option>
            {(batches ?? []).map((b) => (
              <option key={b.id} value={b.id}>{b.number}{b.expiryDate ? ` · exp ${formatDate(b.expiryDate)}` : ""} · {b.quantity}</option>
            ))}
          </NativeSelect>
        </div>
      )}
      {tracked && item?.tracking === "serial" && (
        <>
          <Input
            value={serialText}
            list={listId}
            onChange={(e) => {
              setSerialText(e.target.value)
              onChange({ serials: parseSerials(e.target.value) })
            }}
            placeholder="Serial / IMEI numbers, comma separated"
            className="h-8 min-w-56 flex-1 text-xs"
            aria-label="Serial numbers"
          />
          <datalist id={listId}>{(serialsInStock ?? []).map((s) => <option key={s} value={s} />)}</datalist>
        </>
      )}
    </>
  )
}
