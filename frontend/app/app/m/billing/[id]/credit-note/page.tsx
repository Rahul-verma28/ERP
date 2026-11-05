"use client"

import * as React from "react"
import { CreditNoteNew } from "@/components/credit-notes"

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = React.use(params)
  return <CreditNoteNew invoiceId={id} />
}
