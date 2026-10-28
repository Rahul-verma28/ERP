"use client"

import Link from "next/link"
import { ReceiptText } from "lucide-react"
import { Empty, Panel, money } from "@/components/console/kit"
import type { PartnerBill } from "@/lib/console"

/** This month's bill from AHEAD to a partner: one line per live client, list price minus the discount */
export function PartnerBillPanel({ bill, title = "This month's bill", linkClients }: { bill: PartnerBill; title?: string; linkClients?: boolean }) {
  return (
    <Panel title={title} description={`Every live client at the list price minus ${bill.discountPercent}%, billed monthly. GST ${bill.gstRatePercent}% is added.`} padded={false}>
      {!bill.lines.length ? (
        <Empty icon={ReceiptText} title="Nothing to bill yet" text="Clients appear here as soon as they're live." />
      ) : (
        <div className="overflow-x-auto px-2 pb-3">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="px-3 py-2.5 font-medium">Client</th>
                <th className="px-3 py-2.5 font-medium">Plan</th>
                <th className="px-3 py-2.5 text-right font-medium">List price</th>
                <th className="px-3 py-2.5 text-right font-medium">You pay</th>
              </tr>
            </thead>
            <tbody>
              {bill.lines.map((l) => (
                <tr key={l.tenantId} className="border-b last:border-0">
                  <td className="px-3 py-2.5 font-medium">
                    {linkClients ? (
                      <Link href={`/console/clients/${l.tenantId}`} className="hover:underline">
                        {l.name}
                      </Link>
                    ) : (
                      l.name
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-muted-foreground">{l.plan}</td>
                  <td className="px-3 py-2.5 text-right text-muted-foreground tabular-nums">{money(l.listPaise)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{money(l.chargePaise)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="text-sm">
              <tr>
                <td colSpan={3} className="px-3 pt-3 text-right text-muted-foreground">
                  Subtotal
                </td>
                <td className="px-3 pt-3 text-right tabular-nums">{money(bill.subtotalPaise)}</td>
              </tr>
              <tr>
                <td colSpan={3} className="px-3 py-1 text-right text-muted-foreground">
                  GST {bill.gstRatePercent}%
                </td>
                <td className="px-3 py-1 text-right tabular-nums">{money(bill.gstPaise)}</td>
              </tr>
              <tr className="text-base font-semibold">
                <td colSpan={3} className="px-3 py-1 text-right">
                  Total
                </td>
                <td className="px-3 py-1 text-right tabular-nums">{money(bill.totalPaise)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </Panel>
  )
}
