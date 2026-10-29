import { redirect } from "next/navigation"

// Console v4 shell: Plans & pricing has its own menu item, so Settings opens Console settings.
export default function SettingsPage() {
  redirect("/console/settings/rules")
}
