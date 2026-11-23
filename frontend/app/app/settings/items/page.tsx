"use client"

import Link from "next/link"
import { Boxes, FileText, Package, Percent } from "lucide-react"
import { NumberStepper } from "@/components/number-stepper"
import { Switch } from "@/components/ui/switch"
import { NativeSelect } from "@/components/form"
import { UnitSelect } from "@/components/creatable-select"
import { ModuleSettingsPage, changed, daysText } from "@/components/module-settings-page"
import { SettingRow, SettingsCard } from "@/components/settings-parts"
import { api } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { GST_RATES } from "@/lib/money"

// Settings › Module settings › Items: what a new item starts with (unit, GST rate, stock tracking,
// low stock level). Used by the item form and by quick-add from a bill.

type Draft = { defaultUnit: string; trackStock: boolean; lowStockLevel: string; gstRateBp: string }

export default function ItemsSettingsPage() {
  const { me, reload } = useAuth()
  const registered = !!me?.tenant?.gstin
  return (
    <ModuleSettingsPage<Draft>
      title="Items"
      description="What a new item starts with. Every item can still have its own unit, rate and stock level."
      read={(w) => ({ defaultUnit: w.preferences.items.defaultUnit, trackStock: w.preferences.items.trackStock, lowStockLevel: daysText(w.preferences.items.lowStockLevel), gstRateBp: String(w.preferences.taxes.defaultGstRateBp) })}
      check={(d) => {
        const e: Record<string, string> = {}
        if (!d.defaultUnit.trim()) e.defaultUnit = "Choose a unit"
        if (d.lowStockLevel !== "" && !(Number(d.lowStockLevel) >= 0)) e.lowStockLevel = "Enter 0 or more"
        return e
      }}
      save={async (d, s) => {
        const toPrefs = (x: Draft) => ({ defaultUnit: x.defaultUnit.trim(), trackStock: x.trackStock, lowStockLevel: x.lowStockLevel === "" ? null : Number(x.lowStockLevel) })
        const diff = changed(toPrefs(d), toPrefs(s))
        if (Object.keys(diff).length) await api.put("/tenant/preferences/items", diff)
        if (d.gstRateBp !== s.gstRateBp) await api.put("/tenant/preferences/taxes", { defaultGstRateBp: Number(d.gstRateBp) })
        // Forms everywhere read these from the signed-in details
        await reload()
      }}
    >
      {({ draft, set, errors, editable }) => (
        <>
          <SettingsCard id="new-items" icon={Package} title="New items start with" description="Filled in on the item form and when an item is added from a bill.">
            <SettingRow title="Unit" description="How most of your items are counted, e.g. pieces, kg, metre." error={errors.defaultUnit}>
              <div className="w-56">
                <UnitSelect value={draft.defaultUnit} onChange={(v) => set({ defaultUnit: v ?? "" })} disabled={!editable} aria-label="Default unit" />
              </div>
            </SettingRow>
            {registered ? (
              <SettingRow
                title="GST rate"
                description={
                  <>
                    Also the rate on a blank bill line. HSN digits and price-with-GST are in{" "}
                    <Link href="/app/settings/taxes" className="font-semibold text-primary hover:underline">
                      Taxes
                    </Link>
                    .
                  </>
                }
              >
                <NativeSelect value={draft.gstRateBp} onChange={(e) => set({ gstRateBp: e.target.value })} disabled={!editable} aria-label="Default GST rate" className="w-28">
                  {GST_RATES.map((r) => (
                    <option key={r.bp} value={String(r.bp)}>
                      {r.label}
                    </option>
                  ))}
                </NativeSelect>
              </SettingRow>
            ) : (
              <SettingRow title="GST rate" description="Not GST registered, so items carry no GST. Add a GSTIN in Organization to set rates.">
                <Percent className="size-4 text-muted-foreground" aria-hidden />
              </SettingRow>
            )}
          </SettingsCard>

          <SettingsCard id="stock" icon={Boxes} title="Stock" description="For products; services never count stock.">
            <SettingRow title="Count stock for new products" description="Purchases add to stock and sales take from it. Turn off if you mostly sell made-to-order goods.">
              <Switch aria-label="Count stock for new products" checked={draft.trackStock} disabled={!editable} onCheckedChange={(c) => set({ trackStock: c })} />
            </SettingRow>
            <SettingRow title="Low stock level" description="New products alert at or below this. Leave empty for none." error={errors.lowStockLevel}>
              <NumberStepper decimals value={draft.lowStockLevel} onChange={(v) => set({ lowStockLevel: v })} min={0} disabled={!editable || !draft.trackStock} placeholder="None" aria-label="Low stock level" className="w-36" />
            </SettingRow>
          </SettingsCard>

          <SettingsCard icon={FileText} title="More for items" description="Kept with the items themselves.">
            <ul className="grid gap-2 sm:grid-cols-2">
              {[
                ["/app/m/catalog", "Items and categories"],
                ["/app/m/catalog/price-lists", "Price lists"],
                ["/app/settings/inventory", "Stock rules, cost method and expiry"],
                ["/app/settings/customization", "Extra fields on items"],
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
