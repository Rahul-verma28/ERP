"use client"

import * as React from "react"
import { toast } from "sonner"
import { Download, FileCheck, Truck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Field, FormError, NativeSelect } from "@/components/form"
import { api, ApiError, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useApi } from "@/lib/use-api"
import { formatPaise } from "@/lib/format"
import { todayInIndia } from "@contracts/validation"

// E-way bill and e-invoice without a GST provider account: download the portal's JSON here,
// upload it on the government portal, then type back the number the portal gives.

/** The document fields this needs; SalesDoc and the note types all have them */
export interface GstDoc {
  id: string
  kind: string
  number: string | null
  version: number
  totalPaise: number
  issueDate: string
  ewayBillNo?: string | null
  ewayBillDate?: string | null
  irn?: string | null
  irnAckNo?: string | null
  irnAckDate?: string | null
}

export function downloadJson(name: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }))
  const a = document.createElement("a")
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const fileName = (what: string, label: string) => `${what}-${label.replace(/[^\w-]+/g, "-")}-${todayInIndia()}.json`

type Problem = { id: string; number: string | null; problems: string[] }

/** Each bill that is not ready, with what to fix */
function Problems({ error }: { error: unknown }) {
  if (!error) return null
  const docs = error instanceof ApiError ? (error.details?.documents as Problem[] | undefined) : undefined
  if (!docs?.length) return <FormError message={errorMessage(error)} />
  return (
    <div role="alert" className="rounded-2xl bg-destructive/10 p-3 text-sm">
      <p className="font-medium text-destructive">Fix these first, then download again:</p>
      <ul className="mt-1 grid gap-1">
        {docs.map((d) => <li key={d.id}><span className="font-mono text-xs">{d.number ?? "Draft"}</span>: {d.problems.join("; ")}</li>)}
      </ul>
    </div>
  )
}

const MODES = [
  { value: "1", label: "Road" },
  { value: "2", label: "Rail" },
  { value: "3", label: "Air" },
  { value: "4", label: "Ship" },
]
const CHALLAN_REASONS = [
  { value: "8", label: "Others (goods against an order)" },
  { value: "4", label: "Job work" },
  { value: "10", label: "Line sales" },
  { value: "11", label: "Recipient not known" },
  { value: "12", label: "Exhibition or fair" },
  { value: "5", label: "For own use" },
]

/** Download the e-way bill JSON for one or many bills; for one, also save the number it gets. */
export function EwayBillDialog({ ids, label, doc, hasChallan, onClose, onSaved }: { ids: string[]; label: string; doc?: GstDoc; hasChallan?: boolean; onClose: () => void; onSaved?: (d: GstDoc) => void }) {
  const [mode, setMode] = React.useState("1")
  const [distance, setDistance] = React.useState("")
  const [vehicleNo, setVehicleNo] = React.useState("")
  const [odc, setOdc] = React.useState(false)
  const [transporterId, setTransporterId] = React.useState("")
  const [transporterName, setTransporterName] = React.useState("")
  const [transDocNo, setTransDocNo] = React.useState("")
  const [transDocDate, setTransDocDate] = React.useState(todayInIndia())
  const [reason, setReason] = React.useState("8")
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [error, setError] = React.useState<unknown>(null)
  const [busy, setBusy] = React.useState<null | "file" | "number">(null)
  const [ewayNo, setEwayNo] = React.useState(doc?.ewayBillNo ?? "")
  const [ewayDate, setEwayDate] = React.useState(doc?.ewayBillDate?.slice(0, 10) ?? todayInIndia())
  const road = mode === "1"

  async function download(e: React.FormEvent) {
    e.preventDefault()
    const errs: Record<string, string> = {}
    if (distance === "" || Number(distance) < 0 || Number(distance) > 4000) errs.distanceKm = "Enter 0 to 4,000 km"
    if (road && !vehicleNo.trim() && !transporterId.trim()) errs.vehicleNo = "Enter the vehicle number, or a transporter ID to add it later"
    if (!road && !transDocNo.trim()) errs.transDocNo = "Enter the receipt or bill of lading number"
    setErrors(errs)
    if (Object.keys(errs).length) return
    setBusy("file")
    setError(null)
    try {
      const file = await api.post<unknown>("/gst/eway-bill-json", {
        ids, transMode: mode, distanceKm: Number(distance), vehicleType: odc ? "O" : "R", challanReason: Number(reason),
        vehicleNo: road && vehicleNo.trim() ? vehicleNo.replace(/\s/g, "") : null, transporterId: transporterId.trim() || null, transporterName: transporterName.trim() || null,
        transDocNo: road ? null : transDocNo.trim(), transDocDate: road ? null : transDocDate,
      })
      downloadJson(fileName("e-way-bill", label), file)
      toast.success("File downloaded. Upload it on the e-way bill portal.")
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fields)
      setError(err)
    } finally {
      setBusy(null)
    }
  }

  async function saveNumber() {
    if (!doc) return
    setBusy("number")
    setError(null)
    try {
      const saved = await api.patch<GstDoc>(`/sales-documents/${doc.id}/gst-refs`, { ewayBillNo: ewayNo.replace(/\s/g, "") || null, ewayBillDate: ewayNo ? ewayDate : null, version: doc.version })
      toast.success(ewayNo ? "E-way bill number saved" : "E-way bill number removed")
      onSaved?.(saved)
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fields)
      setError(err)
    } finally {
      setBusy(null)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>E-way bill {ids.length > 1 ? `for ${ids.length} bills` : doc?.number ?? ""}</DialogTitle>
          <DialogDescription>Download the file, upload it on ewaybillgst.gov.in › E-waybill › Generate Bulk, then type the number you get here.</DialogDescription>
        </DialogHeader>
        {doc && doc.kind === "invoice" && doc.totalPaise < 5_000_000 && (
          <p className="rounded-2xl bg-muted p-3 text-sm text-muted-foreground">This bill is under {formatPaise(5_000_000)}, so most states don&apos;t need an e-way bill for it.</p>
        )}
        <form onSubmit={download} className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Mode">
              <NativeSelect value={mode} onChange={(e) => setMode(e.target.value)} aria-label="Mode">
                {MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </NativeSelect>
            </Field>
            <Field label="Distance (km)" required error={errors.distanceKm} hint="0 lets the portal work it out from the PIN codes">
              <Input inputMode="numeric" value={distance} onChange={(e) => setDistance(e.target.value.replace(/\D/g, "").slice(0, 4))} />
            </Field>
            {road ? (
              <Field label="Vehicle number" error={errors.vehicleNo}>
                <Input value={vehicleNo} onChange={(e) => setVehicleNo(e.target.value.toUpperCase())} placeholder="MH12AB1234" maxLength={15} />
              </Field>
            ) : (
              <>
                <Field label={mode === "2" ? "Railway receipt no." : mode === "3" ? "Airway bill no." : "Bill of lading no."} required error={errors.transDocNo}>
                  <Input value={transDocNo} onChange={(e) => setTransDocNo(e.target.value)} maxLength={15} />
                </Field>
                <Field label="Its date"><Input type="date" value={transDocDate} onChange={(e) => setTransDocDate(e.target.value)} /></Field>
              </>
            )}
            <Field label="Transporter ID" hint="Their GSTIN or TRANSIN, if a transporter carries it" error={errors.transporterId}>
              <Input value={transporterId} onChange={(e) => setTransporterId(e.target.value.toUpperCase())} maxLength={15} />
            </Field>
            <Field label="Transporter name"><Input value={transporterName} onChange={(e) => setTransporterName(e.target.value)} maxLength={100} /></Field>
            {hasChallan && (
              <Field label="Reason for the challan">
                <NativeSelect value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Reason for the challan">
                  {CHALLAN_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                </NativeSelect>
              </Field>
            )}
          </div>
          {road && <label className="flex items-center gap-2 text-sm text-muted-foreground"><input type="checkbox" checked={odc} onChange={(e) => setOdc(e.target.checked)} /> Over-dimensional cargo</label>}
          <Problems error={error} />
          <DialogFooter><Button type="submit" disabled={!!busy}><Download /> {busy === "file" ? "Making the file…" : "Download JSON"}</Button></DialogFooter>
        </form>
        {doc && (
          <div className="grid gap-3 border-t pt-4">
            <p className="text-sm font-medium">Got the e-way bill number?</p>
            <div className="grid gap-3 sm:grid-cols-[1fr_10rem_auto] sm:items-end">
              <Field label="E-way bill no." error={errors.ewayBillNo}><Input inputMode="numeric" value={ewayNo} onChange={(e) => setEwayNo(e.target.value.replace(/\D/g, "").slice(0, 12))} placeholder="12 digits" /></Field>
              <Field label="Date" error={errors.ewayBillDate}><Input type="date" value={ewayDate} min={doc.issueDate.slice(0, 10)} onChange={(e) => setEwayDate(e.target.value)} /></Field>
              <Button variant="outline" disabled={!!busy || (!ewayNo && !doc.ewayBillNo)} onClick={saveNumber}>{busy === "number" ? "Saving…" : ewayNo || !doc.ewayBillNo ? "Save" : "Remove"}</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

/** Download the e-invoice JSON for the IRP; for one bill, also save the IRN it gets. */
export function EInvoiceDialog({ ids, label, doc, onClose, onSaved }: { ids: string[]; label: string; doc?: GstDoc; onClose: () => void; onSaved?: (d: GstDoc) => void }) {
  const [error, setError] = React.useState<unknown>(null)
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [busy, setBusy] = React.useState<null | "file" | "number">(null)
  const [irn, setIrn] = React.useState(doc?.irn ?? "")
  const [ackNo, setAckNo] = React.useState(doc?.irnAckNo ?? "")
  const [ackDate, setAckDate] = React.useState(doc?.irnAckDate?.slice(0, 10) ?? todayInIndia())

  async function download() {
    setBusy("file")
    setError(null)
    try {
      downloadJson(fileName("e-invoice", label), await api.post<unknown>("/gst/einvoice-json", { ids }))
      toast.success("File downloaded. Upload it on the e-invoice portal.")
    } catch (err) {
      setError(err)
    } finally {
      setBusy(null)
    }
  }

  async function saveNumber() {
    if (!doc) return
    setBusy("number")
    setError(null)
    try {
      const body = irn ? { irn: irn.trim(), irnAckNo: ackNo.trim(), irnAckDate: ackDate, version: doc.version } : { irn: null, version: doc.version }
      const saved = await api.patch<GstDoc>(`/sales-documents/${doc.id}/gst-refs`, body)
      toast.success(irn ? "IRN saved" : "IRN removed")
      onSaved?.(saved)
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fields)
      setError(err)
    } finally {
      setBusy(null)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>E-invoice {ids.length > 1 ? `for ${ids.length} bills` : doc?.number ?? ""}</DialogTitle>
          <DialogDescription>Download the file, upload it on einvoice1.gst.gov.in › e-Invoice › Bulk Upload, then type the IRN and acknowledgement you get here.</DialogDescription>
        </DialogHeader>
        <Problems error={error} />
        <DialogFooter><Button disabled={!!busy} onClick={download}><Download /> {busy === "file" ? "Making the file…" : "Download JSON"}</Button></DialogFooter>
        {doc && (
          <div className="grid gap-3 border-t pt-4">
            <p className="text-sm font-medium">Got the IRN?</p>
            <Field label="IRN" error={errors.irn}><Input value={irn} onChange={(e) => setIrn(e.target.value.trim().toLowerCase().slice(0, 64))} placeholder="64 letters and digits" className="font-mono text-xs" /></Field>
            <div className="grid gap-3 sm:grid-cols-[1fr_10rem_auto] sm:items-end">
              <Field label="Ack no." error={errors.irnAckNo}><Input inputMode="numeric" value={ackNo} onChange={(e) => setAckNo(e.target.value.replace(/\D/g, "").slice(0, 20))} /></Field>
              <Field label="Ack date" error={errors.irnAckDate}><Input type="date" value={ackDate} min={doc.issueDate.slice(0, 10)} onChange={(e) => setAckDate(e.target.value)} /></Field>
              <Button variant="outline" disabled={!!busy || (!irn && !doc.irn)} onClick={saveNumber}>{busy === "number" ? "Saving…" : irn || !doc.irn ? "Save" : "Remove"}</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

/** E-invoicing is on in Settings › Taxes (turnover above the e-invoice limit) */
export function useEInvoicing() {
  const { can } = useAuth()
  const w = useApi<{ preferences: { taxes: { eInvoicing?: boolean } } }>(can("tenant.settings.view") ? "/tenant/workspace" : null)
  return !!w.data?.preferences.taxes.eInvoicing
}

type ButtonDoc = GstDoc & { status: string; buyer: { gstin?: string | null } }

/** E-way bill button for an issued invoice or challan of a GST registered business */
export function EwayBillButton({ doc, onSaved }: { doc: ButtonDoc; onSaved: (d: GstDoc) => void }) {
  const { can, me } = useAuth()
  const [open, setOpen] = React.useState(false)
  const ready = doc.kind === "invoice" ? ["issued", "partially_paid", "paid"].includes(doc.status) : doc.kind === "delivery_challan" && ["issued", "converted"].includes(doc.status)
  if (!ready || !me?.tenant?.gstin || !can("billing.invoice.view")) return null
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}><Truck /> {doc.ewayBillNo ? "E-way bill ✓" : "E-way bill"}</Button>
      {open && <EwayBillDialog ids={[doc.id]} label={doc.number ?? "bill"} doc={doc} hasChallan={doc.kind === "delivery_challan"} onClose={() => setOpen(false)} onSaved={(d) => { setOpen(false); onSaved(d) }} />}
    </>
  )
}

/** E-invoice button for an issued B2B invoice, credit note or debit note, when e-invoicing is on */
export function EInvoiceButton({ doc, onSaved }: { doc: ButtonDoc; onSaved: (d: GstDoc) => void }) {
  const on = useEInvoicing()
  const [open, setOpen] = React.useState(false)
  if (!on || !doc.buyer.gstin || ["draft", "cancelled"].includes(doc.status)) return null
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}><FileCheck /> {doc.irn ? "E-invoice ✓" : "E-invoice"}</Button>
      {open && <EInvoiceDialog ids={[doc.id]} label={doc.number ?? "bill"} doc={doc} onClose={() => setOpen(false)} onSaved={(d) => { setOpen(false); onSaved(d) }} />}
    </>
  )
}
