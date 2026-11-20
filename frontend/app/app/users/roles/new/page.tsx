"use client"

import * as React from "react"
import { useSearchParams } from "next/navigation"
import { RoleForm } from "@/components/role-form"

function NewRole() {
  const from = useSearchParams().get("from")
  return <RoleForm key={from ?? "new"} fromId={from} />
}

export default function NewRolePage() {
  return <React.Suspense><NewRole /></React.Suspense>
}
