import { redirect } from "next/navigation"

// Console settings moved to /console/settings (one page with sections).
export default function OldSettingsPage() {
  redirect("/console/settings")
}
