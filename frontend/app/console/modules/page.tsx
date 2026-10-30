"use client"

import Link from "next/link"
import { Check } from "lucide-react"
import { Chip, Failed, Loading, Page, Panel } from "@/components/console/kit"
import { useApi } from "@/lib/use-api"
import { formatDate } from "@/lib/format"
import type { ModulesOverview } from "@/lib/console"

// Modules & features (blueprint Phase D): every module, which plans include it, how many
// businesses use it today, what it depends on, and the modules switched on or off for single
// businesses (from a business page › Plan & billing).

export default function ModulesPage() {
  const { data, error, reload } = useApi<ModulesOverview>("/console/modules")
  if (error) return <Failed error={error} onRetry={reload} />
  return (
    <Page eyebrow="Product" title="Modules & features" subtitle="What each plan includes and how much each module is used. Change a plan's modules in Plans & pricing." wide>
      <Panel padded={false}>
        {!data ? (
          <Loading rows={8} className="p-5" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs whitespace-nowrap text-muted-foreground">
                  <th className="px-5 py-3 font-medium">Module</th>
                  {data.plans.map((p) => (
                    <th key={p.key} className="px-3 py-3 text-center font-medium">
                      <Link href={`/console/settings/plans/${p.key}`} className="hover:underline">{p.name}</Link>
                    </th>
                  ))}
                  <th className="px-3 py-3 text-right font-medium">Businesses using</th>
                  <th className="px-5 py-3 font-medium">Needs</th>
                </tr>
              </thead>
              <tbody>
                {data.modules.map((m) => (
                  <tr key={m.key} className="border-b last:border-0">
                    <td className="px-5 py-2.5">
                      <div className="flex items-center gap-2 font-medium">{m.name}{m.freeTier && <Chip tone="grey">Free</Chip>}</div>
                      <div className="text-xs text-muted-foreground">{m.description}</div>
                    </td>
                    {data.plans.map((p) => (
                      <td key={p.key} className="px-3 py-2.5 text-center">{m.plans.includes(p.key) ? <Check className="mx-auto size-4 text-emerald-600" aria-label="Included" /> : <span className="text-muted-foreground/50">—</span>}</td>
                    ))}
                    <td className="px-3 py-2.5 text-right tabular-nums">{m.businesses}</td>
                    <td className="px-5 py-2.5 text-xs text-muted-foreground">{m.dependsOn.length ? m.dependsOn.map((d) => data.modules.find((x) => x.key === d)?.name ?? d).join(", ") : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="Switched for single businesses" description="A module turned on beyond the plan (a demo, a special deal) or turned off. Set from a business's Plan & billing tab." padded={false}>
        {!data ? (
          <Loading rows={2} className="p-5" />
        ) : !data.overrides.length ? (
          <p className="px-5 pb-5 text-sm text-muted-foreground">None right now.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs whitespace-nowrap text-muted-foreground">
                  <th className="px-5 py-2.5 font-medium">Business</th>
                  <th className="px-3 py-2.5 font-medium">Module</th>
                  <th className="px-3 py-2.5 font-medium">Switch</th>
                  <th className="px-3 py-2.5 font-medium">Until</th>
                  <th className="px-5 py-2.5 font-medium">Why</th>
                </tr>
              </thead>
              <tbody>
                {data.overrides.map((o) => (
                  <tr key={`${o.tenantId}-${o.moduleKey}`} className="border-b last:border-0">
                    <td className="px-5 py-2.5"><Link href={`/console/clients/${o.tenantId}?tab=plan`} className="font-medium hover:underline">{o.business}</Link></td>
                    <td className="px-3 py-2.5">{data.modules.find((m) => m.key === o.moduleKey)?.name ?? o.moduleKey}</td>
                    <td className="px-3 py-2.5">{o.state === "on" ? <Chip tone="green">On</Chip> : <Chip tone="red">Off</Chip>}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-muted-foreground">{o.until ? formatDate(o.until) : "No end"}</td>
                    <td className="px-5 py-2.5 text-muted-foreground">{o.reason}{o.by ? ` · ${o.by}` : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </Page>
  )
}
