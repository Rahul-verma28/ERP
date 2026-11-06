"use client"

import * as React from "react"
import { SalesDocEdit } from "@/components/sales-doc-pages"

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = React.use(params)
  return <SalesDocEdit kind="delivery_challan" id={id} />
}
