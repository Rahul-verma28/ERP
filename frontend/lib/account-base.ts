"use client"

import { usePathname } from "next/navigation"

/** My account lives under the ERP (/app/account) and the Console (/console/account) — same pages. */
export function useAccountBase() {
  const pathname = usePathname()
  return pathname.startsWith("/console") ? { account: "/console/account", home: "/console" } : { account: "/app/account", home: "/app" }
}
