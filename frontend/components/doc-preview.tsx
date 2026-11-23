"use client"

import * as React from "react"
import { previewNumber, type WorkspacePreferences } from "@contracts/workspace"
import { SalesDocView, type ViewDoc } from "@/components/sales-doc-view"
import { ThermalReceipt } from "@/components/thermal-receipt"
import { currentFy } from "@/components/setup/documents-step"
import type { SetupTenant, Workspace } from "@/components/setup/wizard"
import { useFileLink } from "@/lib/files"
import type { DocLine, Seller } from "@/lib/sales"
import { cn } from "@/lib/utils"

/**
 * Settings › Documents: the real invoice (the same view that prints and goes on share links),
 * filled with your details and a sample customer, redrawn as the settings change. A4 is shown
 * as a scaled sheet; 80 mm / 58 mm as a till receipt.
 */

const A4_PX = 794 // 210 mm at 96 dpi

type Docs = WorkspacePreferences["documents"]
type Pay = WorkspacePreferences["payments"]

const SAMPLE = [
  { description: "Cotton shirt", hsnSac: "6205", unit: "pcs", quantity: 2, unitPricePaise: 79_900, discountPaise: 0, gstRateBp: 500 },
  { description: "Alteration & stitching", hsnSac: "998821", unit: "job", quantity: 1, unitPricePaise: 45_000, discountPaise: 0, gstRateBp: 1800 },
  { description: "Gift box", hsnSac: "4819", unit: "pcs", quantity: 1, unitPricePaise: 12_000, discountPaise: 2_000, gstRateBp: 1200 },
]

function sampleDoc({ kind, tenant, workspace, docs, seller }: { kind: "invoice" | "quotation"; tenant: SetupTenant; workspace: Workspace; docs: Docs; seller: Seller }): ViewDoc {
  const taxed = !!seller.gstin && !seller.billOfSupply
  const half = (n: number) => Math.round(n / 2)
  const lines: DocLine[] = SAMPLE.map((l, i) => {
    const taxable = l.quantity * l.unitPricePaise - l.discountPaise
    const rate = taxed ? l.gstRateBp : 0
    const tax = Math.round((taxable * rate) / 10_000)
    return { ...l, id: String(i), itemId: null, gstRateBp: rate, taxablePaise: taxable, cgstPaise: half(tax), sgstPaise: tax - half(tax), igstPaise: 0, totalPaise: taxable + tax }
  })
  const sum = (k: "taxablePaise" | "cgstPaise" | "sgstPaise" | "totalPaise") => lines.reduce((a, l) => a + (l[k] ?? 0), 0)
  const exact = sum("totalPaise")
  const roundOff = workspace.preferences.taxes.roundOff ? Math.round(exact / 100) * 100 - exact : 0
  const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10)
  const due = new Date(Date.now() + 330 * 60_000 + 15 * 86_400_000).toISOString().slice(0, 10)
  const fy = currentFy(tenant.fyStartMonth)
  return {
    kind,
    number: previewNumber(kind === "invoice" ? docs.invoicePrefix : docs.quotationPrefix, fy, 1),
    status: kind === "invoice" ? "issued" : "sent",
    issueDate: today,
    dueDate: due,
    buyer: { name: "Sharma Traders", gstin: taxed ? `${seller.stateCode ?? "27"}AAKFS1234L1Z5` : null, phone: "98200 11223", address: { line1: "Shop 4, Station Road", city: "Pune", pincode: "411001" }, stateCode: seller.stateCode ?? null },
    seller,
    placeOfSupply: seller.stateCode ?? null,
    subtotalPaise: sum("taxablePaise"),
    discountPaise: 0,
    taxablePaise: sum("taxablePaise"),
    cgstPaise: sum("cgstPaise"),
    sgstPaise: sum("sgstPaise"),
    igstPaise: 0,
    roundOffPaise: roundOff,
    totalPaise: exact + roundOff,
    paidPaise: 0,
    notes: null,
    terms: (kind === "invoice" ? docs.terms : docs.quotationTerms) || null,
    lines,
  }
}

export function DocPreview({ tenant, workspace, docs, pay, brand, className }: { tenant: SetupTenant; workspace: Workspace; docs: Docs; pay: Pay; brand: string; className?: string }) {
  const [kind, setKind] = React.useState<"invoice" | "quotation">("invoice")
  const logo = useFileLink(tenant.logoUrl).link?.url ?? null
  const signature = useFileLink(docs.signatureUrl).link?.url ?? null
  const taxes = workspace.preferences.taxes
  const seller: Seller = {
    name: tenant.name,
    legalName: tenant.legalName,
    gstin: tenant.gstin,
    stateCode: tenant.billingStateCode,
    address: tenant.address as Record<string, string> | null,
    logoUrl: logo,
    phone: workspace.profile.phone ?? null,
    email: workspace.profile.email ?? null,
    brandColor: brand,
    bank: pay.bankAccount ? { holder: pay.bankHolder, account: pay.bankAccount, ifsc: pay.ifsc } : null,
    upiId: pay.upiId || null,
    showUpiQr: pay.showUpiQr && !!pay.upiId,
    showHsnSummary: docs.showHsnSummary,
    showSignatory: docs.showSignatory,
    paper: docs.paper,
    template: docs.template,
    signatureUrl: docs.signatureUrl ? signature : null,
    billOfSupply: !!tenant.gstin && taxes.composition,
    composition: taxes.composition,
    unregistered: !tenant.gstin,
  }
  const doc = sampleDoc({ kind, tenant, workspace, docs, seller })
  const thermal = docs.paper !== "a4"

  return (
    <aside className={cn("grid gap-3 rounded-2xl border bg-muted/50 p-3", className)} aria-label="Live document preview">
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <div>
          <p className="text-sm font-semibold">Live preview</p>
          <p className="text-xs text-muted-foreground">{thermal ? `${docs.paper} receipt` : "A4 sheet"} · sample customer · changes as you edit</p>
        </div>
        <div className="inline-flex rounded-full bg-background p-0.5 text-xs shadow-xs" role="radiogroup" aria-label="Document to preview">
          {(["invoice", "quotation"] as const).map((k) => (
            <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => setKind(k)} className={cn("rounded-full px-3 py-1 font-medium capitalize transition-colors", kind === k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
              {k}
            </button>
          ))}
        </div>
      </div>
      {thermal ? (
        <div className="grid max-h-[calc(100svh-12rem)] place-items-start justify-center overflow-auto rounded-xl bg-neutral-200/70 py-5">
          <ThermalReceipt doc={doc} width={docs.paper as "80mm" | "58mm"} className="shadow-md" />
        </div>
      ) : (
        <A4Sheet>
          <SalesDocView doc={doc} />
        </A4Sheet>
      )}
    </aside>
  )
}

/** A full-size A4 page shrunk to the width it is given, keeping its proportions */
function A4Sheet({ children }: { children: React.ReactNode }) {
  const outer = React.useRef<HTMLDivElement>(null)
  const inner = React.useRef<HTMLDivElement>(null)
  const [size, setSize] = React.useState({ scale: 0.5, height: 560 })
  React.useLayoutEffect(() => {
    const measure = () => {
      if (!outer.current || !inner.current) return
      const scale = Math.min(1, outer.current.clientWidth / A4_PX)
      // At least an A4 page tall (297 / 210 of the width), longer when the bill runs on
      const height = Math.max(inner.current.offsetHeight, A4_PX * (297 / 210)) * scale
      setSize((s) => (Math.abs(s.scale - scale) < 0.001 && Math.abs(s.height - height) < 1 ? s : { scale, height }))
    }
    measure()
    const ro = new ResizeObserver(measure)
    if (outer.current) ro.observe(outer.current)
    if (inner.current) ro.observe(inner.current)
    return () => ro.disconnect()
  }, [])
  return (
    <div ref={outer} className="overflow-hidden rounded-md bg-white shadow-md ring-1 ring-black/5" style={{ height: size.height }}>
      <div ref={inner} className="origin-top-left bg-white" style={{ width: A4_PX, minHeight: A4_PX * (297 / 210), transform: `scale(${size.scale})` }}>
        {children}
      </div>
    </div>
  )
}
