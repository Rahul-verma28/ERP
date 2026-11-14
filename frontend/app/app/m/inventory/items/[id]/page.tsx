"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { PageLoading } from "@/components/page-states"

// An item's stock now lives on its page, under Stock. Old links land there.
export default function ItemStockRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = React.use(params)
  const router = useRouter()
  React.useEffect(() => router.replace(`/app/m/catalog/${id}?tab=stock`), [id, router])
  return <PageLoading />
}
