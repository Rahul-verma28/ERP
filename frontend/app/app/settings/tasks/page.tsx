"use client"

import Link from "next/link"
import { BellRing, Flag, Tags } from "lucide-react"
import { LabelInput } from "@/components/tasks/forms"
import { ModuleSettingsPage, changed } from "@/components/module-settings-page"
import { Segmented, SettingRow, SettingsCard } from "@/components/settings-parts"
import { api } from "@/lib/api"
import { useAuth } from "@/lib/auth"

// Settings › Module settings › Tasks: the priority a new task starts with, the labels offered when
// tagging one, and when people are reminded a task is due (the hourly Task reminders job).

type Priority = "low" | "medium" | "high" | "urgent"
type Reminder = "off" | "due_day" | "day_before"
type Draft = { defaultPriority: Priority; labels: string[]; dueReminder: Reminder }

export default function TasksSettingsPage() {
  const { reload } = useAuth()
  return (
    <ModuleSettingsPage<Draft>
      title="Tasks"
      description="How new tasks start, the labels your team uses, and reminders before work is due."
      read={(w) => ({ defaultPriority: w.preferences.tasks.defaultPriority, labels: w.preferences.tasks.labels, dueReminder: w.preferences.tasks.dueReminder })}
      check={(d): Record<string, string> => (d.labels.some((l) => l.length > 30) ? { labels: "Keep each label within 30 characters" } : d.labels.length > 30 ? { labels: "Up to 30 labels" } : {})}
      save={async (d, s) => {
        await api.put("/tenant/preferences/tasks", changed(d, s))
        // Task forms read these from the signed-in details
        await reload()
      }}
    >
      {({ draft, set, errors, editable }) => (
        <>
          <SettingsCard id="new-tasks" icon={Flag} title="New tasks" description="What a task starts with when nobody picks.">
            <SettingRow title="Priority" description="Each task can still be set higher or lower.">
              <Segmented
                label="Default priority"
                value={draft.defaultPriority}
                onChange={(v) => set({ defaultPriority: v })}
                options={[
                  ["low", "Low"],
                  ["medium", "Medium"],
                  ["high", "High"],
                  ["urgent", "Urgent"],
                ]}
                disabled={!editable}
              />
            </SettingRow>
          </SettingsCard>

          <SettingsCard id="labels" icon={Tags} title="Labels" description="Offered first when someone tags a task, so everyone uses the same words. Any other label can still be typed.">
            <div className="grid gap-1.5">
              <LabelInput max={30} value={draft.labels} onChange={(v) => editable && set({ labels: v })} suggestions={["Follow-up", "Site visit", "Call back", "Urgent", "Waiting on customer", "Internal"]} />
              <p className="text-xs text-muted-foreground">
                {draft.labels.length} of 30 · type a label and press Enter, or pick a suggestion
              </p>
              {errors.labels && <p className="text-xs text-destructive">{errors.labels}</p>}
            </div>
          </SettingsCard>

          <SettingsCard id="reminders" icon={BellRing} title="Due reminders" description="Sent to the person a task is given to, in the app, from 9 AM.">
            <SettingRow
              title="Remind people"
              description={
                <>
                  Each person can mute “My task is due” in My account; the whole business in{" "}
                  <Link href="/app/settings/notifications" className="font-semibold text-primary hover:underline">
                    Notifications
                  </Link>
                  .
                </>
              }
            >
              <Segmented
                label="When to remind"
                value={draft.dueReminder}
                onChange={(v) => set({ dueReminder: v })}
                options={[
                  ["day_before", "A day before"],
                  ["due_day", "On the due day"],
                  ["off", "Off"],
                ]}
                disabled={!editable}
              />
            </SettingRow>
          </SettingsCard>
        </>
      )}
    </ModuleSettingsPage>
  )
}
