"use client"

import * as React from "react"
import { useSearchParams } from "next/navigation"
import { ItemForm } from "@/components/item-form"

function Keyed() {
  const edit = useSearchParams().get("edit")
  return <ItemForm key={edit ?? "new"} editId={edit} />
}

export default function ItemFormPage() {
  return (
    <React.Suspense>
      <Keyed />
    </React.Suspense>
  )
}
