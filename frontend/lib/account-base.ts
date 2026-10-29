"use client"

import { usePathname } from "next/navigation"

/** My account lives under the ERP (/app/account), the Console (/console/account) and the partner portal (/partner/account) — same pages. */
export function useAccountBase() {
  const pathname = usePathname()
  if (pathname.startsWith("/partner")) return { account: "/partner/account", home: "/partner" }
  return pathname.startsWith("/console") ? { account: "/console/account", home: "/console" } : { account: "/app/account", home: "/app" }
}
