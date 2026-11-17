"use client"

import { PageHeader } from "@/components/app-shell"
import { HrTabs, TABS } from "@/components/hr/pickers"
import { LeaveTypes } from "@/components/hr/leave-types"
import { useAuth } from "@/lib/auth"

export default function LeaveTypesPage() {
  const { can } = useAuth()
  if (!can("hr.leave.view")) return <PageHeader title="Leave types" description="You don't have access to leave. Ask your admin." />
  return (
    <>
      <HrTabs tabs={TABS.leave} active="types" />
      <LeaveTypes />
    </>
  )
}
