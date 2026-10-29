"use client"

import { ConsoleGate } from "@/components/console-gate"

export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  return <ConsoleGate portal="console">{children}</ConsoleGate>
}
