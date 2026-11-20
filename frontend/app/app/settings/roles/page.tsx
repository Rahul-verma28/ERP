import { redirect } from "next/navigation"

// Roles moved out of Settings, next to Users
export default function Page() {
  redirect("/app/users/roles")
}
