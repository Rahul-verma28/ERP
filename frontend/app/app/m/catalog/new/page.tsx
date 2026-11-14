"use client"

import * as React from "react"
import { useSearchParams } from "next/navigation"
import { ItemForm } from "@/components/item-form"

function Keyed() {
  const params = useSearchParams()
  const edit = params.get("edit")
  const copy = params.get("copy")
  return <ItemForm key={edit ?? copy ?? "new"} editId={edit} copyId={copy} />
}

export default function ItemFormPage() {
  return (
    <React.Suspense>
      <Keyed />
    </React.Suspense>
  )
}
