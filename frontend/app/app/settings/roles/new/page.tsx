"use client"

import { useSearchParams } from "next/navigation"
import { RoleForm } from "@/components/role-form"

export default function NewRolePage() {
  const from = useSearchParams().get("from")
  return <RoleForm key={from ?? "new"} fromId={from} />
}
