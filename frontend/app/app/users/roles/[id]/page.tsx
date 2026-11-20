"use client"

import { useParams } from "next/navigation"
import { RoleForm } from "@/components/role-form"

export default function RolePage() {
  const { id } = useParams<{ id: string }>()
  return <RoleForm key={id} roleId={id} />
}
