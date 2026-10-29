"use client"

import { usePathname } from "next/navigation"

// Console v3: partners use the same pages at their own address (/partner) with their own look.
// Page links go through this base; API paths (/console/...) never change.

export function useConsoleBase() {
  return usePathname().startsWith("/partner") ? "/partner" : "/console"
}

/** A Console link as it should read for this panel (server-sent links start with /console). */
export const atBase = (base: string, href: string) => href.replace(/^\/console(?=\/|$|\?)/, base)
