"use client"

import Link from "next/link"
import { CalendarClock, FileText, ShieldAlert } from "lucide-react"
import { NumberStepper } from "@/components/number-stepper"
import { Switch } from "@/components/ui/switch"
import { ModuleSettingsPage, changed, daysError, daysText, daysValue } from "@/components/module-settings-page"
import { Segmented, SettingRow, SettingsCard } from "@/components/settings-parts"
import { api } from "@/lib/api"

// Settings › Module settings › Sales: the dates new quotations, orders and invoices start with,
// and what happens when a bill goes over a customer's credit limit. Used by the bill forms and
// by the server when no date is given.

type Draft = { quotationValidDays: string; deliveryDays: string; invoiceDue: "bill_date" | "days"; invoiceDueDays: string; creditLimit: "block" | "allow" }

export default function SalesSettingsPage() {
  return (
    <ModuleSettingsPage<Draft>
      title="Sales"
      description="What new quotations, orders and invoices start with. Each bill can still be changed."
      read={(w) => {
        const s = w.preferences.sales
        return { quotationValidDays: String(s.quotationValidDays), deliveryDays: String(s.deliveryDays), invoiceDue: s.invoiceDueDays == null ? "bill_date" : "days", invoiceDueDays: daysText(s.invoiceDueDays), creditLimit: s.creditLimit }
      }}
      check={(d) => {
        const e: Record<string, string> = {}
        const q = daysError(d.quotationValidDays, 1, 365, true)
        if (q) e.quotationValidDays = q
        const o = daysError(d.deliveryDays, 0, 365, true)
        if (o) e.deliveryDays = o
        const i = d.invoiceDue === "days" ? daysError(d.invoiceDueDays, 1, 365, true) : null
        if (i) e.invoiceDueDays = i
        return e
      }}
      save={async (d, s) => {
        const toPrefs = (x: Draft) => ({ quotationValidDays: Number(x.quotationValidDays), deliveryDays: Number(x.deliveryDays), invoiceDueDays: x.invoiceDue === "days" ? daysValue(x.invoiceDueDays) : null, creditLimit: x.creditLimit })
        await api.put("/tenant/preferences/sales", changed(toPrefs(d), toPrefs(s)))
      }}
    >
      {({ draft, set, errors, editable }) => (
        <>
          <SettingsCard id="dates" icon={CalendarClock} title="Dates on new documents" description="Filled in for you when a document is made; change it on any one document.">
            <SettingRow title="Quotations hold for" description="Sets “Valid until” on a new quotation." error={errors.quotationValidDays}>
              <NumberStepper value={draft.quotationValidDays} onChange={(v) => set({ quotationValidDays: v })} min={1} max={365} suffix="days" disabled={!editable} aria-label="Quotation validity in days" className="w-36" />
            </SettingRow>
            <SettingRow title="Orders and challans deliver within" description="Sets “Deliver by” on a new sales order or delivery challan. 0 = the same day." error={errors.deliveryDays}>
              <NumberStepper value={draft.deliveryDays} onChange={(v) => set({ deliveryDays: v })} min={0} max={365} suffix="days" disabled={!editable} aria-label="Delivery days" className="w-36" />
            </SettingRow>
            <SettingRow
              title="Invoices are due"
              description={
                <>
                  For customers with no payment days of their own.{" "}
                  <Link href="/app/m/sales/customers" className="font-semibold text-primary hover:underline">
                    Set them on a customer
                  </Link>{" "}
                  to override this.
                </>
              }
              error={errors.invoiceDueDays}
            >
              <Segmented
                label="When invoices are due"
                value={draft.invoiceDue}
                onChange={(v) => set({ invoiceDue: v, invoiceDueDays: v === "days" && !draft.invoiceDueDays ? "15" : draft.invoiceDueDays })}
                options={[
                  ["bill_date", "On the bill date"],
                  ["days", "After some days"],
                ]}
                disabled={!editable}
              />
              {draft.invoiceDue === "days" && <NumberStepper value={draft.invoiceDueDays} onChange={(v) => set({ invoiceDueDays: v })} min={1} max={365} suffix="days" disabled={!editable} aria-label="Invoice due days" className="w-32" />}
            </SettingRow>
          </SettingsCard>

          <SettingsCard id="credit-limit" icon={ShieldAlert} title="Credit limits" description="A limit is set on each customer. This decides what happens when a bill goes over it.">
            <SettingRow
              title="Stop bills over the limit"
              description={
                draft.creditLimit === "block"
                  ? "The invoice isn't issued. Someone who can approve invoices may still issue it, and that is written to the audit log."
                  : "Bills are issued even over the limit; the limit only shows on the customer."
              }
            >
              <Switch aria-label="Stop bills over the credit limit" checked={draft.creditLimit === "block"} disabled={!editable} onCheckedChange={(c) => set({ creditLimit: c ? "block" : "allow" })} />
            </SettingRow>
          </SettingsCard>

          <SettingsCard icon={FileText} title="More for sales" description="Set elsewhere, used on every sales document.">
            <ul className="grid gap-2 sm:grid-cols-2">
              {[
                ["/app/settings/documents#terms", "Terms on invoices and quotations"],
                ["/app/settings/documents#series", "Invoice and quotation numbers"],
                ["/app/settings/payments", "Bank and UPI on invoices"],
                ["/app/m/catalog/price-lists", "Price lists"],
              ].map(([href, label]) => (
                <li key={href}>
                  <Link href={href} className="flex items-center gap-2 rounded-lg border px-3 py-2 font-medium hover:bg-muted">
                    {label}
                    <span className="ml-auto text-muted-foreground" aria-hidden>
                      ›
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </SettingsCard>
        </>
      )}
    </ModuleSettingsPage>
  )
}
