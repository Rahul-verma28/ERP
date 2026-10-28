"use client"

import * as React from "react"
import Link from "next/link"
import { toast } from "sonner"
import { ArrowLeft, Check, FileText, IndianRupee, Link2, X } from "lucide-react"
import { Button, buttonVariants } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { PageHeader } from "@/components/app-shell"
import { Field, FormError, NativeSelect } from "@/components/form"
import { OrderBadge } from "@/components/order-badge"
import { api, ApiError, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useApi } from "@/lib/use-api"
import { formatDate, formatDateTime, formatPaise } from "@/lib/format"
import { paiseToRupees, rupeesToPaise } from "@/lib/money"
import type { OrderDetail } from "@/lib/console"

const METHODS = [
  { value: "bank_transfer", label: "Bank transfer (NEFT/RTGS/IMPS)" },
  { value: "upi", label: "UPI" },
  { value: "cheque", label: "Cheque" },
  { value: "cash", label: "Cash" },
]
const today = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10)

function PaymentDialog({ order, open, onOpenChange, onDone }: { order: OrderDetail; open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const [form, setForm] = React.useState({ method: "bank_transfer", amount: paiseToRupees(order.totalPaise), reference: "", receivedOn: today() })
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [busy, setBusy] = React.useState(false)
  async function save(e: React.FormEvent) {
    e.preventDefault()
    const amountPaise = rupeesToPaise(form.amount)
    if (amountPaise === null) return setErrors({ amountPaise: "Enter the amount in rupees" })
    setBusy(true)
    setErrors({})
    try {
      const r = await api.post<{ invoiceNumber: string }>(`/console/orders/${order.id}/payments`, { method: form.method, amountPaise, reference: form.reference, receivedOn: form.receivedOn })
      toast.success(`Payment recorded — invoice ${r.invoiceNumber} issued, modules are open`)
      onOpenChange(false)
      onDone()
    } catch (err) {
      setErrors(err instanceof ApiError ? { ...err.fields, form: errorMessage(err) } : { form: errorMessage(err) })
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={save} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Record a payment</DialogTitle>
            <DialogDescription>Only the full amount is accepted. Recording it issues AHEAD&apos;s GST invoice and opens the client&apos;s modules.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Method">
              <NativeSelect value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}>
                {METHODS.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Amount (₹)" error={errors.amountPaise}>
              <Input inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required />
            </Field>
            <Field label="Reference" hint="UTR, UPI ref, cheque or receipt number" error={errors.reference}>
              <Input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} required />
            </Field>
            <Field label="Received on" error={errors.receivedOn}>
              <Input type="date" value={form.receivedOn} max={today()} onChange={(e) => setForm({ ...form, receivedOn: e.target.value })} required />
            </Field>
          </div>
          <FormError message={errors.form} />
          <DialogFooter>
            <Button type="submit" disabled={busy}>{busy ? "Recording…" : "Record payment"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function CancelDialog({ order, open, onOpenChange, onDone }: { order: OrderDetail; open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const [reason, setReason] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          className="grid gap-4"
          onSubmit={async (e) => {
            e.preventDefault()
            setBusy(true)
            try {
              await api.post(`/console/orders/${order.id}/cancel`, { reason })
              toast.success("Order cancelled")
              onOpenChange(false)
              onDone()
            } catch (err) {
              setError(errorMessage(err))
            } finally {
              setBusy(false)
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>Cancel this order</DialogTitle>
            <DialogDescription>The client&apos;s workspace stays, with modules closed, until a new order is paid.</DialogDescription>
          </DialogHeader>
          <Field label="Reason">
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} required minLength={5} />
          </Field>
          <FormError message={error} />
          <DialogFooter>
            <Button type="submit" variant="destructive" disabled={busy}>{busy ? "Cancelling…" : "Cancel order"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export default function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = React.use(params)
  const { me, canConsole } = useAuth()
  const { data: o, error, reload } = useApi<OrderDetail>(`/console/orders/${id}`)
  const [payOpen, setPayOpen] = React.useState(false)
  const [cancelOpen, setCancelOpen] = React.useState(false)
  const [approving, setApproving] = React.useState(false)
  const [sendingLink, setSendingLink] = React.useState(false)

  if (error) return <p className="text-sm text-destructive">{error.message}</p>
  if (!o) return <Skeleton className="h-96 rounded-4xl" />
  const open = o.status === "pending_approval" || o.status === "awaiting_payment"
  const canApprove = o.status === "pending_approval" && canConsole("platform.discount.approve") && o.createdBy !== me?.user.id

  return (
    <div className="mx-auto w-full max-w-6xl">
      <Link href="/console/payments" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Payments
      </Link>
      <PageHeader
        title={o.client?.name ?? "Order"}
        description={`${o.kind === "renewal" ? "Renewal · " : ""}Created ${formatDateTime(o.createdAt)} by ${o.createdByName ?? "System"} · ${o.cycle}`}
        actions={
          <>
            {canApprove && (
              <Button
                disabled={approving}
                onClick={async () => {
                  setApproving(true)
                  try {
                    await api.post(`/console/orders/${o.id}/approve`)
                    toast.success("Discount approved — the client can pay now")
                    await reload()
                  } catch (e) {
                    toast.error(errorMessage(e))
                  } finally {
                    setApproving(false)
                  }
                }}
              >
                <Check /> Approve discount
              </Button>
            )}
            {o.status === "awaiting_payment" && (
              <Button
                variant={o.paymentLinkUrl ? "outline" : "default"}
                disabled={sendingLink}
                onClick={async () => {
                  setSendingLink(true)
                  try {
                    const r = await api.post<{ url: string; sent: boolean }>(`/console/orders/${o.id}/payment-link`, { resend: !!o.paymentLinkUrl })
                    await navigator.clipboard?.writeText(r.url).catch(() => undefined)
                    toast.success(o.paymentLinkUrl ? "Link sent again (and copied)" : "Payment link sent to the owner (and copied)")
                    await reload()
                  } catch (e) {
                    toast.error(errorMessage(e))
                  } finally {
                    setSendingLink(false)
                  }
                }}
              >
                <Link2 /> {o.paymentLinkUrl ? "Resend link" : "Send payment link"}
              </Button>
            )}
            {o.status === "awaiting_payment" && canConsole("platform.payment.create") && (
              <Button onClick={() => setPayOpen(true)}>
                <IndianRupee /> Record payment
              </Button>
            )}
            {open && canConsole("platform.payment.approve") && (
              <Button variant="outline" onClick={() => setCancelOpen(true)}>
                <X /> Cancel
              </Button>
            )}
            {o.invoice && (
              <Link href={`/console/invoices/${o.invoice.id}`} className={buttonVariants({ variant: "outline" })}>
                <FileText /> Invoice {o.invoice.number}
              </Link>
            )}
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Order <OrderBadge status={o.status} />
            </CardTitle>
            <CardDescription>
              {o.status === "pending_approval" && `Discount of ${o.discountBp / 100}% is above the creator's limit.`}
              {o.status === "awaiting_payment" && `Lapses on ${formatDate(o.expiresAt)} if unpaid.`}
              {o.status === "paid" && o.paidAt && `Paid on ${formatDate(o.paidAt)}.`}
              {o.status === "cancelled" && `Cancelled: ${o.cancelledReason ?? ""}`}
            </CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-6">Item</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                  <TableHead className="text-right">Discount</TableHead>
                  <TableHead className="text-right">Taxable</TableHead>
                  <TableHead className="pr-6 text-right">GST</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {o.items.map((i) => (
                  <TableRow key={`${i.itemType}-${i.itemRef}`}>
                    <TableCell className="pl-6">{i.description}{i.quantity > 1 ? ` × ${i.quantity}` : ""}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatPaise(i.amountPaise)}</TableCell>
                    <TableCell className="text-right tabular-nums">{i.discountPaise ? `−${formatPaise(i.discountPaise)}` : "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatPaise(i.taxablePaise)}</TableCell>
                    <TableCell className="pr-6 text-right tabular-nums">{formatPaise(i.cgstPaise + i.sgstPaise + i.igstPaise)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <div className="grid gap-4 self-start">
          <Card>
            <CardHeader>
              <CardTitle>Total</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-1 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">List price</span><span className="tabular-nums">{formatPaise(o.listPaise)}</span></div>
              {o.discountPaise > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Discount{o.couponCode ? ` (incl. ${o.couponCode})` : ""}</span><span className="tabular-nums">−{formatPaise(o.discountPaise)}</span></div>}
              <div className="flex justify-between"><span className="text-muted-foreground">Taxable</span><span className="tabular-nums">{formatPaise(o.taxablePaise)}</span></div>
              {o.igstPaise > 0 ? (
                <div className="flex justify-between"><span className="text-muted-foreground">IGST</span><span className="tabular-nums">{formatPaise(o.igstPaise)}</span></div>
              ) : (
                <div className="flex justify-between"><span className="text-muted-foreground">CGST + SGST</span><span className="tabular-nums">{formatPaise(o.cgstPaise + o.sgstPaise)}</span></div>
              )}
              <div className="mt-1 flex justify-between border-t pt-2 font-semibold"><span>Total</span><span className="tabular-nums">{formatPaise(o.totalPaise)}</span></div>
              {o.paymentLinkUrl && o.status === "awaiting_payment" && (
                <a href={o.paymentLinkUrl} target="_blank" rel="noreferrer" className="mt-2 truncate text-xs underline underline-offset-4">{o.paymentLinkUrl}</a>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Bill to</CardTitle>
            </CardHeader>
            <CardContent className="text-sm">
              <p className="font-medium">{o.billTo.name}</p>
              {o.billTo.gstin && <p>GSTIN {o.billTo.gstin}</p>}
              <p className="text-muted-foreground">State code {o.billTo.stateCode}</p>
              {o.billTo.address && <p className="text-muted-foreground">{o.billTo.address}</p>}
              <Link href={`/console/clients/${o.tenantId}`} className="mt-2 inline-block text-sm underline underline-offset-4">Open client</Link>
            </CardContent>
          </Card>
          {o.payments.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Payments</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-2 text-sm">
                {o.payments.map((p) => (
                  <p key={p.id}>
                    {formatPaise(p.amountPaise)} · {p.method.replace("_", " ")} · {p.reference}
                    <br />
                    <span className="text-xs text-muted-foreground">received {formatDate(p.receivedAt)}, recorded by {p.recordedBy ?? "—"}</span>
                  </p>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <PaymentDialog order={o} open={payOpen} onOpenChange={setPayOpen} onDone={reload} />
      <CancelDialog order={o} open={cancelOpen} onOpenChange={setCancelOpen} onDone={reload} />
    </div>
  )
}
