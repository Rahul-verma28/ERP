"use client"

import Link from "next/link"
import { CalendarClock, ClipboardList, FileText } from "lucide-react"
import { NumberStepper } from "@/components/number-stepper"
import { Switch } from "@/components/ui/switch"
import { ModuleSettingsPage, changed, daysError, daysText, daysValue } from "@/components/module-settings-page"
import { Segmented, SettingRow, SettingsCard } from "@/components/settings-parts"
import { api } from "@/lib/api"
import { useAuth } from "@/lib/auth"

// Settings › Module settings › Purchase: whether purchases start with an order, and the dates new
// orders and supplier bills start with. Used by the purchase forms and by the server.

type Draft = { purchaseOrders: boolean; poExpected: "none" | "days"; poExpectedDays: string; billDue: "none" | "days"; billDueDays: string }

export default function PurchaseSettingsPage() {
  const { reload } = useAuth()
  return (
    <ModuleSettingsPage<Draft>
      title="Purchase"
      description="How buying works here: with or without purchase orders, and when supplier bills are due."
      read={(w) => {
        const p = w.preferences.purchase
        return { purchaseOrders: w.preferences.inventory.purchaseOrders, poExpected: p.poExpectedDays == null ? "none" : "days", poExpectedDays: daysText(p.poExpectedDays), billDue: p.billDueDays == null ? "none" : "days", billDueDays: daysText(p.billDueDays) }
      }}
      check={(d) => {
        const e: Record<string, string> = {}
        const po = d.poExpected === "days" ? daysError(d.poExpectedDays, 0, 365, true) : null
        if (po) e.poExpectedDays = po
        const bill = d.billDue === "days" ? daysError(d.billDueDays, 0, 365, true) : null
        if (bill) e.billDueDays = bill
        return e
      }}
      save={async (d, s) => {
        const toPrefs = (x: Draft) => ({ poExpectedDays: x.poExpected === "days" ? daysValue(x.poExpectedDays) : null, billDueDays: x.billDue === "days" ? daysValue(x.billDueDays) : null })
        const diff = changed(toPrefs(d), toPrefs(s))
        if (Object.keys(diff).length) await api.put("/tenant/preferences/purchase", diff)
        if (d.purchaseOrders !== s.purchaseOrders) {
          await api.put("/tenant/preferences/inventory", { purchaseOrders: d.purchaseOrders })
          // The menu shows or hides Purchase Orders and Goods Receipts
          await reload()
        }
      }}
    >
      {({ draft, set, errors, editable }) => (
        <>
          <SettingsCard id="orders" icon={ClipboardList} title="Purchase orders" description="Small shops buy straight from the supplier's bill; larger ones send an order first.">
            <SettingRow
              title="Use purchase orders"
              description={draft.purchaseOrders ? "Purchase Orders and Goods Receipts show in the menu. A bill can be made from an order or a receipt." : "Purchases start at the supplier's bill. Turn on to send orders and receive goods against them."}
            >
              <Switch aria-label="Use purchase orders" checked={draft.purchaseOrders} disabled={!editable} onCheckedChange={(c) => set({ purchaseOrders: c })} />
            </SettingRow>
            {draft.purchaseOrders && (
              <SettingRow title="Orders are expected in" description="Sets “Expected by” on a new purchase order, so late deliveries show up." error={errors.poExpectedDays}>
                <Segmented
                  label="Expected date on new orders"
                  value={draft.poExpected}
                  onChange={(v) => set({ poExpected: v, poExpectedDays: v === "days" && !draft.poExpectedDays ? "7" : draft.poExpectedDays })}
                  options={[
                    ["none", "Leave empty"],
                    ["days", "After some days"],
                  ]}
                  disabled={!editable}
                />
                {draft.poExpected === "days" && <NumberStepper value={draft.poExpectedDays} onChange={(v) => set({ poExpectedDays: v })} min={0} max={365} suffix="days" disabled={!editable} aria-label="Expected days" className="w-32" />}
              </SettingRow>
            )}
          </SettingsCard>

          <SettingsCard id="bills" icon={CalendarClock} title="Supplier bills" description="When a bill has no due date of its own.">
            <SettingRow
              title="Bills are due"
              description={
                <>
                  Counted from the supplier&apos;s bill date, for suppliers with no payment days of their own.{" "}
                  <Link href="/app/m/purchase/suppliers" className="font-semibold text-primary hover:underline">
                    Set them on a supplier
                  </Link>{" "}
                  to override this. Due bills show in Payables.
                </>
              }
              error={errors.billDueDays}
            >
              <Segmented
                label="When supplier bills are due"
                value={draft.billDue}
                onChange={(v) => set({ billDue: v, billDueDays: v === "days" && !draft.billDueDays ? "30" : draft.billDueDays })}
                options={[
                  ["none", "No due date"],
                  ["days", "After some days"],
                ]}
                disabled={!editable}
              />
              {draft.billDue === "days" && <NumberStepper value={draft.billDueDays} onChange={(v) => set({ billDueDays: v })} min={0} max={365} suffix="days" disabled={!editable} aria-label="Bill due days" className="w-32" />}
            </SettingRow>
          </SettingsCard>

          <SettingsCard icon={FileText} title="More for purchase" description="Set elsewhere, used on purchase documents.">
            <ul className="grid gap-2 sm:grid-cols-2">
              {[
                ["/app/settings/documents#series", "Order, receipt and bill numbers"],
                ["/app/settings/inventory", "Stock rules and approvals"],
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
