"use client"

import { useParams } from "next/navigation"
import { PageHeader } from "@/components/app-shell"
import { PageError, PageLoading } from "@/components/page-states"
import { EmployeeForm } from "@/components/hr/employee-form"
import { useAuth } from "@/lib/auth"
import { useApi } from "@/lib/use-api"
import type { Employee } from "@/lib/hr"

export default function EditEmployeePage() {
  const { id } = useParams<{ id: string }>()
  const { can } = useAuth()
  const { data, error, reload } = useApi<Employee>(`/hr/employees/${id}`)
  if (!can("hr.employee.edit")) return <PageHeader title="Edit employee" description="You don't have access to change employees. Ask your admin." />
  if (error) return <PageError error={error} onRetry={() => void reload()} />
  if (!data) return <PageLoading />
  return <EmployeeForm key={data.version} employee={data} />
}
