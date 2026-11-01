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
        <>
          <BankCard key={`b-${JSON.stringify(workspace.preferences.payments)}`} tenant={tenant} workspace={workspace} refresh={refresh} />
          <UpiCard key={`u-${JSON.stringify(workspace.preferences.payments)}`} tenant={tenant} workspace={workspace} refresh={refresh} />
        </>
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
    <div id="bank">
      <EditableSection
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
          <Field label="Account holder" error={form.errors.bankHolder} className="sm:col-span-2">
            <Input {...form.field("bankHolder")} autoFocus />
          </Field>
          <Field label="Account number" error={form.errors.bankAccount} hint="9 to 18 digits">
            <Input {...form.field("bankAccount")} inputMode="numeric" autoComplete="off" />
          </Field>
          <Field label="Re-enter account number" error={form.errors.bankAccountConfirm} success={accountOk ? "Matches" : null}>
            <Input {...form.field("bankAccountConfirm")} inputMode="numeric" autoComplete="off" onPaste={(e) => e.preventDefault()} />
          </Field>
          <Field label="IFSC" error={form.errors.ifsc} hint="11 characters, e.g. HDFC0001234">
            <Input mask="ifsc" {...form.field("ifsc")} maxLength={11} className="font-mono uppercase" />
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
    <div id="upi-id">
      <EditableSection
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
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="UPI ID" error={form.errors.upiId} hint="name@bank">
            <Input mask="noSpaces" {...form.field("upiId")} autoComplete="off" autoFocus />
          </Field>
          <label className="flex items-center gap-3 self-end pb-2 text-sm">
            <input type="checkbox" className="size-4 accent-primary" checked={form.values.showUpiQr} onChange={(e) => form.set("showUpiQr", e.target.checked)} /> Print a UPI QR code on invoices
          </label>
        </div>
      </EditableSection>
    </div>
  )
}
