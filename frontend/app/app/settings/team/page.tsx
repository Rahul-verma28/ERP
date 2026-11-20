import { redirect } from "next/navigation"

// Users moved out of Settings to their own place
export default function Page() {
  redirect("/app/users")
}
