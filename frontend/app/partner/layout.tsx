"use client"

import { ConsoleGate } from "@/components/console-gate"

// Console v3: the partner portal — its own address and look, the same sign-in and pages.
export default function PartnerLayout({ children }: { children: React.ReactNode }) {
  return <ConsoleGate portal="partner">{children}</ConsoleGate>
}
