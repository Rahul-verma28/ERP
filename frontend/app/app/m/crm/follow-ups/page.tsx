"use client"

import { PageHeader } from "@/components/app-shell"
import { FollowUps } from "@/components/contact-import"
import { useAuth } from "@/lib/auth"

// Calls and visits promised to leads and customers, oldest first.

export default function FollowUpsPage() {
  const { can } = useAuth()
  if (!can("crm.activity.view")) return <PageHeader title="Follow-ups" description="You don't have access to follow-ups. Ask your admin." />
  return (
    <>
      <PageHeader title="Follow-ups" description="Calls and visits you promised to make. Add one from a lead's or customer's timeline." />
      <div className="ui-surface overflow-hidden"><FollowUps /></div>
    </>
  )
}
