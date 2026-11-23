"use client"

import * as React from "react"
import Link from "next/link"
import { toast } from "sonner"
import { bankAccount, ifsc as ifscRule, upiId as upiRule, upperNoSpaces } from "@contracts/validation"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { EditableSection, ReadOnlyGrid } from "@/components/editable-section"
import { Field } from "@/components/form"
import { ErrorState, NoAccess } from "@/components/page-states"
import { SettingsPage } from "@/components/settings-shell"
import { UpiQr } from "@/components/upi-qr"
import type { Workspace, SetupTenant } from "@/components/setup/wizard"
import { api } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useForm } from "@/lib/use-form"
import { useWorkspaceData } from "@/lib/use-workspace"
import { Switch } from "@/components/ui/switch"
import { formatPaise } from "@/lib/format"
import { Landmark, QrCode, Receipt } from "lucide-react"

// Settings › Payments: bank account and UPI printed on invoices (all optional).

const mask = (acc: string) => (acc ? `•••• ${acc.slice(-4)}` : "")

export default function PaymentsSettingsPage() {
  const { can } = useAuth()
  const { tenant, workspace, error, refresh } = useWorkspaceData()
  if (!can("tenant.settings.view")) return <NoAccess what="Payments" />
  return (
    <SettingsPage title="Payments" description="How customers pay you. Printed on new invoices; issued invoices keep the details they were issued with.">
      {error && (!tenant || !workspace) ? (
        <ErrorState error={error} onRetry={refresh} />
      ) : !tenant || !workspace ? (
        <Skeleton className="h-72 rounded-xl" />
      ) : (
        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="grid gap-4">
            <BankCard key={`b-${JSON.stringify(workspace.preferences.payments)}`} tenant={tenant} workspace={workspace} refresh={refresh} />
            <UpiCard key={`u-${JSON.stringify(workspace.preferences.payments)}`} tenant={tenant} workspace={workspace} refresh={refresh} />
          </div>
          <OnInvoice tenant={tenant} workspace={workspace} />
        </div>
      )}
    </SettingsPage>
  )
}

type CardProps = { tenant: SetupTenant; workspace: Workspace; refresh: () => Promise<void> }

function BankCard({ tenant, workspace, refresh }: CardProps) {
  const { can } = useAuth()
  const pay = workspace.preferences.payments
  const form = useForm({
    initial: { bankHolder: pay.bankHolder || (tenant.legalName ?? tenant.name), bankAccount: pay.bankAccount, bankAccountConfirm: pay.bankAccount, ifsc: pay.ifsc },
    labels: { bankHolder: "Account holder", bankAccount: "Account number", bankAccountConfirm: "Re-enter account number", ifsc: "IFSC" },
    clean: { bankHolder: (v) => v.trim(), bankAccount: (v) => v.replace(/\s/g, ""), bankAccountConfirm: (v) => v.replace(/\s/g, ""), ifsc: upperNoSpaces },
    rules: {
      bankHolder: (v, all) => (all.bankAccount && !v.trim() ? "Add the account holder name" : null),
      bankAccount: (v, all) => (v ? bankAccount(v) : all.ifsc ? "Add the account number" : null),
      bankAccountConfirm: (v, all) => (all.bankAccount && v !== all.bankAccount ? "Account numbers don't match" : null),
      ifsc: (v, all) => (v ? ifscRule(v) : all.bankAccount ? "Add the IFSC" : null),
    },
    fromServer: (path) => (["bankHolder", "bankAccount", "ifsc"] as const).find((k) => k === path),
    onSubmit: async (v) => {
      await api.put("/tenant/preferences/payments", { bankHolder: v.bankAccount ? v.bankHolder : "", bankAccount: v.bankAccount, ifsc: v.ifsc })
      await refresh()
      toast.success("Bank details saved")
    },
  })
  const accountOk = form.values.bankAccount && !bankAccount(form.values.bankAccount) && form.values.bankAccountConfirm === form.values.bankAccount
  return (
    <div>
      <EditableSection
        id="bank"
        icon={Landmark}
        title="Bank account"
        description="Shown on invoices for bank transfers (NEFT, RTGS, IMPS)."
        form={form}
        canEdit={can("tenant.settings.edit")}
        view={
          <ReadOnlyGrid
            className="sm:grid-cols-3"
            items={[
              { label: "Account holder", value: pay.bankAccount ? pay.bankHolder : null },
              { label: "Account number", value: pay.bankAccount ? <span className="font-mono">{mask(pay.bankAccount)}</span> : null },
              { label: "IFSC", value: pay.ifsc ? <span className="font-mono">{pay.ifsc}</span> : null },
            ]}
          />
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Account holder" error={form.errors.bankHolder} className="sm:col-span-2" hint="Exactly as on the bank account">
            <Input {...form.field("bankHolder")} placeholder="e.g. Sharma Electronics Pvt Ltd" autoFocus />
          </Field>
          <Field label="Account number" error={form.errors.bankAccount} hint="9 to 18 digits">
            <Input {...form.field("bankAccount")} inputMode="numeric" autoComplete="off" placeholder="e.g. 50100123456789" />
          </Field>
          <Field label="Re-enter account number" error={form.errors.bankAccountConfirm} success={accountOk ? "Matches" : null}>
            <Input {...form.field("bankAccountConfirm")} inputMode="numeric" autoComplete="off" onPaste={(e) => e.preventDefault()} placeholder="Type it again" />
          </Field>
          <Field label="IFSC" error={form.errors.ifsc} hint="11 characters, e.g. HDFC0001234">
            <Input mask="ifsc" {...form.field("ifsc")} maxLength={11} className="font-mono uppercase" placeholder="e.g. HDFC0001234" />
          </Field>
        </div>
      </EditableSection>
    </div>
  )
}

function UpiCard({ tenant, workspace, refresh }: CardProps) {
  const { can } = useAuth()
  const pay = workspace.preferences.payments
  const form = useForm({
    initial: { upiId: pay.upiId, showUpiQr: pay.showUpiQr },
    labels: { upiId: "UPI ID" },
    clean: { upiId: (v) => v.trim() },
    rules: { upiId: (v, all) => (v ? upiRule(v) : all.showUpiQr ? "Add a UPI ID to print the QR code" : null) },
    fromServer: (path) => (path === "upiId" ? "upiId" : undefined),
    onSubmit: async (v) => {
      await api.put("/tenant/preferences/payments", { upiId: v.upiId, showUpiQr: v.showUpiQr && !!v.upiId })
      await refresh()
      toast.success("UPI saved")
    },
  })
  return (
    <div>
      <EditableSection
        id="upi-id"
        icon={QrCode}
        title="UPI"
        description="Customers scan the QR on the invoice and pay the exact amount."
        form={form}
        canEdit={can("tenant.settings.edit")}
        view={
          <div className="flex flex-wrap items-center gap-5">
            {pay.upiId && pay.showUpiQr && <UpiQr upiId={pay.upiId} payee={tenant.legalName || tenant.name} amountPaise={0} size={72} />}
            <ReadOnlyGrid
              className="flex-1 sm:grid-cols-2"
              items={[
                { label: "UPI ID", value: pay.upiId || null },
                {
                  label: "QR on invoices",
                  value: (
                    <>
                      {pay.showUpiQr ? "Printed" : "Not printed"} ·{" "}
                      <Link href="/app/settings/documents#print" className="font-semibold text-primary hover:underline">
                        Print settings
                      </Link>
                    </>
                  ),
                },
              ]}
            />
          </div>
        }
      >
        <div className="flex flex-wrap items-start gap-5">
          <div className="grid min-w-0 flex-1 gap-4">
            <Field label="UPI ID" error={form.errors.upiId} hint="name@bank, from your UPI or bank app">
              <Input mask="noSpaces" {...form.field("upiId")} autoComplete="off" placeholder="e.g. sharmaelectronics@okhdfcbank" autoFocus />
            </Field>
            <label className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-sm">
              <span>
                <span className="block font-medium">Print a UPI QR code on invoices</span>
                <span className="block text-xs text-muted-foreground">For the amount still due, so customers can&apos;t pay the wrong amount</span>
              </span>
              <Switch aria-label="Print a UPI QR code on invoices" checked={form.values.showUpiQr} onCheckedChange={(c) => form.set("showUpiQr", c)} />
            </label>
          </div>
          <div className="grid w-36 justify-items-center gap-1.5 rounded-xl border bg-white p-3 text-center text-[11px] text-neutral-600">
            {form.values.upiId && !upiRule(form.values.upiId.trim()) ? (
              <>
                <UpiQr upiId={form.values.upiId.trim()} payee={tenant.legalName || tenant.name} amountPaise={100} note="Test payment" size={104} />
                Scan with your phone: ₹1 to check it reaches you
              </>
            ) : (
              <>
                <span className="grid size-[104px] place-items-center rounded bg-neutral-100 text-neutral-400">
                  <QrCode className="size-8" aria-hidden />
                </span>
                The QR appears once the UPI ID is valid
              </>
            )}
          </div>
        </div>
      </EditableSection>
    </div>
  )
}

/** What the "How to pay" part of an unpaid invoice shows, from what is saved now */
function OnInvoice({ tenant, workspace }: { tenant: SetupTenant; workspace: Workspace }) {
  const pay = workspace.preferences.payments
  const payee = tenant.legalName || tenant.name
  const sample = 1_18_000
  const nothing = !pay.bankAccount && !pay.upiId
  return (
    <aside className="grid gap-3 rounded-2xl border bg-muted/50 p-3 xl:sticky xl:top-4" aria-label="How payment details look on an invoice">
      <div className="flex items-start gap-2 px-1">
        <Receipt className="mt-0.5 size-4 text-muted-foreground" aria-hidden />
        <div>
          <p className="text-sm font-semibold">On your invoices</p>
          <p className="text-xs text-muted-foreground">The bottom of an unpaid invoice of {formatPaise(sample)}</p>
        </div>
      </div>
      <div className="rounded-lg bg-white p-4 text-xs text-neutral-700 shadow-sm ring-1 ring-black/5">
        <div className="mb-3 flex justify-between border-b border-neutral-200 pb-2 text-sm font-semibold text-neutral-900">
          <span>Balance due</span>
          <span className="tabular-nums">{formatPaise(sample)}</span>
        </div>
        {nothing ? (
          <p className="text-neutral-500">No bank or UPI yet, so invoices show no payment details. Add one here.</p>
        ) : (
          <div className="flex flex-wrap items-center gap-4">
            {pay.showUpiQr && pay.upiId && <UpiQr upiId={pay.upiId} payee={payee} amountPaise={sample} note="INV/26-27/0001" size={88} />}
            <div className="grid min-w-0 gap-1">
              <p className="font-medium text-neutral-900">How to pay</p>
              {pay.upiId && (
                <p>
                  UPI: <span className="font-mono break-all">{pay.upiId}</span>
                </p>
              )}
              {pay.bankAccount && (
                <p>
                  Bank transfer: {pay.bankHolder} · A/c <span className="font-mono">{pay.bankAccount}</span> · IFSC <span className="font-mono">{pay.ifsc}</span>
                </p>
              )}
            </div>
          </div>
        )}
      </div>
      <p className="px-1 text-xs text-muted-foreground">
        Hidden once an invoice is fully paid. Turn the QR on or off in{" "}
        <Link href="/app/settings/documents#print" className="font-semibold text-primary hover:underline">
          Documents
        </Link>
        .
      </p>
    </aside>
  )
}
