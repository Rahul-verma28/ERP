"use client"

import * as React from "react"
import { toast } from "sonner"
import { TEAM_EVENTS } from "@contracts/account"
import { Switch } from "@/components/ui/switch"
import { api, errorMessage } from "@/lib/api"
import type { AccountOverview } from "@/lib/account"

// My account › Notifications: mute team alerts per channel. Security emails (password,
// email change, two-step reset) can't be muted, and customer messages aren't personal.

export function NotificationsSection({ data, reload }: { data: AccountOverview; reload: () => Promise<void> }) {
  const [saving, setSaving] = React.useState(false)

  const toggle = async (channel: "inApp" | "email", key: string, on: boolean) => {
    const muted = data.preferences.mutedAlerts
    const list = on ? muted[channel].filter((k) => k !== key) : [...muted[channel], key]
    setSaving(true)
    try {
      await api.put("/account/preferences", { ...data.preferences, mutedAlerts: { ...muted, [channel]: list } })
      await reload()
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  return (
        <section className="ui-surface px-[18px] py-3.5">
          <h2 className="text-[15px] font-bold">Notifications</h2>
          <p className="mb-2 text-[13px] text-muted-foreground">Alerts sent to you. Your business decides which alerts exist; you can mute the ones you don&apos;t need.</p>
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="py-2 font-semibold">Alert</th>
                <th className="w-20 py-2 text-center font-semibold">In-app</th>
                <th className="w-20 py-2 text-center font-semibold">Email</th>
              </tr>
            </thead>
            <tbody>
              {TEAM_EVENTS.map((e) => (
                <tr key={e.key} className="border-b border-border/60 last:border-0">
                  <td className="py-2.5">{e.label}</td>
                  {(["inApp", "email"] as const).map((ch) => (
                    <td key={ch} className="py-2.5 text-center">
                      <Switch aria-label={`${e.label} · ${ch === "inApp" ? "in-app" : "email"}`} checked={!data.preferences.mutedAlerts[ch].includes(e.key)} disabled={saving} onCheckedChange={(on) => toggle(ch, e.key, on)} />
                    </td>
                  ))}
                </tr>
              ))}
              <tr>
                <td className="py-2.5 text-muted-foreground">Security emails (password, email change, two-step reset)</td>
                <td className="py-2.5 text-center text-xs text-muted-foreground">—</td>
                <td className="py-2.5 text-center text-xs text-muted-foreground">Always on</td>
              </tr>
            </tbody>
          </table>
        </section>
  )
}
