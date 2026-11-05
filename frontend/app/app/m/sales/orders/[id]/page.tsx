"use client"

import * as React from "react"
import { SalesDocDetail } from "@/components/sales-doc-pages"

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = React.use(params)
  return <SalesDocDetail kind="sales_order" id={id} />
}
