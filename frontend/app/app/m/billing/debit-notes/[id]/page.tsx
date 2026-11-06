"use client"

import * as React from "react"
import { DebitNoteDetail } from "@/components/credit-notes"

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = React.use(params)
  return <DebitNoteDetail id={id} />
}
