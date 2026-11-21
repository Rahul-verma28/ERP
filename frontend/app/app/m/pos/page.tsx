"use client"

import { PosCounter } from "@/components/pos/counter"
import { PageHeader } from "@/components/app-shell"
import { useAuth } from "@/lib/auth"

// POS counter: open a shift, bill at the counter, take payment and print the receipt.

export default function PosPage() {
  const { can } = useAuth()
  if (!can("billing.pos.view")) return <PageHeader title="Counter" description="You don't have access to the POS counter. Ask your admin." />
  return <PosCounter />
}
