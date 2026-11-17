"use client"

import { PageHeader } from "@/components/app-shell"
import { EmployeeForm } from "@/components/hr/employee-form"
import { useAuth } from "@/lib/auth"

export default function NewEmployeePage() {
  const { can } = useAuth()
  if (!can("hr.employee.create")) return <PageHeader title="Add employee" description="You don't have access to add employees. Ask your admin." />
  return <EmployeeForm />
}
