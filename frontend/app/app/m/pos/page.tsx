"use client"

import { PosCounter } from "@/components/pos/counter"
import { useAuth } from "@/lib/auth"
import { NoAccessPage } from "@/components/page-states"

// POS counter: open a shift, bill at the counter, take payment and print the receipt.

export default function PosPage() {
  const { can } = useAuth()
  if (!can("billing.pos.view")) return <NoAccessPage title="Counter" permission="billing.pos.view" />
  return <PosCounter />
}
