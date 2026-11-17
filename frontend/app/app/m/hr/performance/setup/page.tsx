"use client"

import { PageHeader } from "@/components/app-shell"
import { HrTabs, TABS } from "@/components/hr/pickers"
import { ListEditor } from "@/components/hr/list-editor"
import { useAuth } from "@/lib/auth"

// Performance setup: indicator categories and goal types.

export default function PerformanceSetupPage() {
  const { can } = useAuth()
  if (!can("hr.setup.view")) return <PageHeader title="Performance setup" description="You don't have access to setup. Ask your admin." />
  return (
    <>
      <HrTabs tabs={TABS.performance} active="setup" />
      <div className="grid gap-5">
        <PageHeader title="Performance setup" description="The groups indicators sit in, and the kinds of goals you set." />
        <div className="grid gap-5 lg:grid-cols-2">
          <ListEditor list="indicatorCategories" description="Groups for performance indicators" />
          <ListEditor list="goalTypes" description="Kinds of goals, e.g. Sales target, Learning" />
        </div>
      </div>
    </>
  )
}
