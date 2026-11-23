"use client"

import { EmployeeForm } from "@/components/hr/employee-form"
import { useAuth } from "@/lib/auth"
import { NoAccessPage } from "@/components/page-states"

export default function NewEmployeePage() {
  const { can } = useAuth()
  if (!can("hr.employee.create")) return <NoAccessPage title="Add employee" permission="hr.employee.create" />
  return <EmployeeForm />
}
