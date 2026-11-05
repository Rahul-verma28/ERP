"use client"

import * as React from "react"
import { toast } from "sonner"
import { IndianRupee, Undo2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { ConfirmDialog, MoneyInput } from "@/components/common"
import { Field, FormError, NativeSelect } from "@/components/form"
import { todayInIndia } from "@contracts/validation"
import { api, ApiError, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useApi } from "@/lib/use-api"
import { formatDate, formatPaise } from "@/lib/format"
import { PAYMENT_METHODS } from "@/lib/money"
import type { SalesDoc } from "@/lib/sales"

// Money a customer pays before there is an invoice: taken on the customer page, used on an invoice.

export interface Advance {
  id: string
  number: string
  amountPaise: number
  method: string
  reference: string | null
  paidOn: string
  reversed: boolean
  usedPaise: number
  balancePaise: number
}
export interface Credit {
  id: string
  number: string
  balancePaise: number
}
export interface AdvanceList {
  data: Advance[]
  credits: Credit[]
  balancePaise: number
  creditPaise: number
}

function ReceiveAdvanceDialog({ contactId, onClose, onSaved }: { contactId: string; onClose: () => void; onSaved: () => void }) {
  const [amount, setAmount] = React.useState<number | null>(null)
  const [method, setMethod] = React.useState("cash")
  const [reference, setReference] = React.useState("")
  const [paidOn, setPaidOn] = React.useState(todayInIndia())
  const [error, setError] = React.useState<string | null>(null)
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [busy, setBusy] = React.useState(false)
  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!amount) return setErrors({ amountPaise: "Enter an amount" })
    setBusy(true)
    setError(null)
    try {
      await api.post("/advances", { contactId, amountPaise: amount, method, reference: reference || null, paidOn })
      toast.success("Advance recorded")
      onSaved()
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fields)
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Receive advance</DialogTitle>
          <DialogDescription>Money received before an invoice. You can use it on this customer&apos;s invoices later.</DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Amount" error={errors.amountPaise}><MoneyInput value={amount} onChange={setAmount} autoFocus /></Field>
            <Field label="Date"><Input type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} /></Field>
            <Field label="Method">
              <NativeSelect value={method} onChange={(e) => setMethod(e.target.value)}>
                {PAYMENT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </NativeSelect>
            </Field>
            <Field label="Reference" hint="UPI ref, cheque no., etc."><Input value={reference} onChange={(e) => setReference(e.target.value)} /></Field>
          </div>
          <FormError message={error} />
          <DialogFooter><Button type="submit" disabled={busy}>{busy ? "Saving…" : "Record advance"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Customer page: the advances taken from this customer and what is left of them. */
export function AdvancesCard({ contactId }: { contactId: string }) {
  const { can } = useAuth()
  const { data, reload } = useApi<AdvanceList>(`/advances?contactId=${contactId}`)
  const [receiving, setReceiving] = React.useState(false)
  const [reversing, setReversing] = React.useState<Advance | null>(null)
  const advances = data?.data ?? []
  return (
    <Card>
      <CardHeader><CardTitle>Advances</CardTitle></CardHeader>
      <CardContent className="grid gap-3">
        {advances.length === 0 ? <p className="text-sm text-muted-foreground">No advance from this customer.</p> : (
          <>
            <p className="text-sm text-muted-foreground">Left to use: <span className="font-semibold text-foreground tabular-nums">{formatPaise(data!.balancePaise)}</span></p>
            <ul className="grid gap-3 text-sm">
              {advances.map((a) => (
                <li key={a.id}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium tabular-nums">{formatPaise(a.amountPaise)}</span>
                    {a.reversed ? <Badge variant="outline">Reversed</Badge> : a.usedPaise === 0 && can("billing.payment.approve") && (
                      <Button variant="ghost" size="icon-xs" aria-label={`Reverse ${a.number}`} onClick={() => setReversing(a)}><Undo2 /></Button>
                    )}
                  </div>
                  <p className="font-mono text-xs break-all">{a.number}</p>
                  <p className="text-xs text-muted-foreground">{formatDate(a.paidOn)} · {PAYMENT_METHODS.find((m) => m.value === a.method)?.label}{a.reference ? ` · ${a.reference}` : ""}</p>
                  {!a.reversed && a.usedPaise > 0 && <p className="text-xs text-muted-foreground">{formatPaise(a.usedPaise)} used · {formatPaise(a.balancePaise)} left</p>}
                </li>
              ))}
            </ul>
          </>
        )}
        {can("billing.payment.create") && <Button variant="outline" size="sm" className="w-full" onClick={() => setReceiving(true)}><IndianRupee /> Receive advance</Button>}
      </CardContent>
      {receiving && <ReceiveAdvanceDialog contactId={contactId} onClose={() => setReceiving(false)} onSaved={() => { setReceiving(false); void reload() }} />}
      <ConfirmDialog
        open={!!reversing}
        onOpenChange={(o) => !o && setReversing(null)}
        destructive
        title={`Reverse ${reversing?.number}?`}
        description={`An opposite entry of ${formatPaise(reversing?.amountPaise ?? 0)} is added. The original stays on record.`}
        confirmLabel="Reverse advance"
        onConfirm={async () => {
          try {
            await api.post(`/payments/${reversing!.id}/reverse`)
            toast.success("Advance reversed")
            await reload()
          } catch (e) {
            toast.error(errorMessage(e))
          }
        }}
      />
    </Card>
  )
}

/** Invoice page: put a customer's advance or credit note against this invoice. Opens only when some is left. */
export function UseAdvanceDialog({ doc, list, onClose, onSaved }: { doc: SalesDoc; list: AdvanceList; onClose: () => void; onSaved: (d: SalesDoc) => void }) {
  const usable = [
    ...list.data.filter((a) => a.balancePaise > 0).map((a) => ({ id: a.id, key: "paymentId", number: a.number, balancePaise: a.balancePaise })),
    ...list.credits.map((c) => ({ id: c.id, key: "creditNoteId", number: c.number, balancePaise: c.balancePaise })),
  ]
  const due = doc.totalPaise - doc.paidPaise
  const [sourceId, setSourceId] = React.useState(usable[0]?.id ?? "")
  const source = usable.find((a) => a.id === sourceId)
  const left = source?.balancePaise ?? 0
  const [amount, setAmount] = React.useState<number | null>(Math.min(left, due))
  const [error, setError] = React.useState<string | null>(null)
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [busy, setBusy] = React.useState(false)
  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!amount) return setErrors({ amountPaise: "Enter an amount" })
    setBusy(true)
    setError(null)
    try {
      const d = await api.post<SalesDoc>(`/invoices/${doc.id}/advances`, { [source!.key]: sourceId, amountPaise: amount })
      toast.success("Used on this invoice")
      onSaved(d)
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fields)
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Use advance or credit</DialogTitle>
          <DialogDescription>Balance due on {doc.number}: {formatPaise(due)}</DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="grid gap-4">
          <div className="grid gap-4">
            <Field label="From" error={errors.paymentId}>
              <NativeSelect value={sourceId} onChange={(e) => { const id = e.target.value; setSourceId(id); setAmount(Math.min(usable.find((a) => a.id === id)?.balancePaise ?? 0, due)) }}>
                {usable.map((a) => <option key={a.id} value={a.id}>{a.number} · {formatPaise(a.balancePaise)} left</option>)}
              </NativeSelect>
            </Field>
            <Field label="Amount" error={errors.amountPaise}><MoneyInput value={amount} onChange={setAmount} autoFocus /></Field>
          </div>
          <FormError message={error} />
          <DialogFooter><Button type="submit" disabled={busy}>{busy ? "Saving…" : "Use on this invoice"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
