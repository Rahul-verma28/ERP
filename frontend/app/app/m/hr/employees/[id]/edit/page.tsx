"use client"

import { useParams } from "next/navigation"
import { PageError, PageLoading, NoAccessPage } from "@/components/page-states"
import { EmployeeForm } from "@/components/hr/employee-form"
import { useAuth } from "@/lib/auth"
import { useApi } from "@/lib/use-api"
import type { Employee } from "@/lib/hr"

export default function EditEmployeePage() {
  const { id } = useParams<{ id: string }>()
  const { can } = useAuth()
  const { data, error, reload } = useApi<Employee>(`/hr/employees/${id}`)
  if (!can("hr.employee.edit")) return <NoAccessPage title="Edit employee" permission="hr.employee.edit" />
  if (error) return <PageError error={error} onRetry={() => void reload()} />
  if (!data) return <PageLoading />
  return <EmployeeForm key={data.version} employee={data} />
}
