"use client"

import { HrTabs, TABS } from "@/components/hr/pickers"
import { LeaveTypes } from "@/components/hr/leave-types"
import { useAuth } from "@/lib/auth"
import { NoAccessPage } from "@/components/page-states"

export default function LeaveTypesPage() {
  const { can } = useAuth()
  if (!can("hr.leave.view")) return <NoAccessPage title="Leave types" permission="hr.leave.view" />
  return (
    <>
      <HrTabs tabs={TABS.leave} active="types" />
      <LeaveTypes />
    </>
  )
}
