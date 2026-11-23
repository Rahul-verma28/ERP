"use client"

import { PageHeader } from "@/components/app-shell"
import { ListEditor } from "@/components/hr/list-editor"
import { useAuth } from "@/lib/auth"
import { NoAccessPage } from "@/components/page-states"

// Recruitment configuration: the short lists job postings and candidates pick from.

export default function RecruitmentConfigurationPage() {
  const { can } = useAuth()
  if (!can("hr.recruitment.view")) return <NoAccessPage title="Recruitment configuration" permission="hr.recruitment.view" />
  return (
    <div className="grid gap-5">
      <PageHeader title="Configuration" description="Lists used when posting jobs, adding candidates and running assessments." />
      <div className="grid gap-5 md:grid-cols-2">
        <ListEditor list="jobLocations" description="Where the job is" />
        <ListEditor list="jobCategories" description="Kinds of jobs you hire for" />
        <ListEditor list="candidateSources" description="How candidates found you" />
        <ListEditor list="assessmentTypes" description="Tests and tasks you give candidates" />
      </div>
    </div>
  )
}
