"use client"

import * as React from "react"
import Link from "next/link"
import { toast } from "sonner"
import { SearchSelect } from "@/components/search-select"
import { api, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { cn } from "@/lib/utils"
import { useCurrentEmployees, useHrLookups, type ListKey } from "@/lib/hr"

// HR pickers: employee, department, designation, shift, and the short lists from HR setup.
// Department and designation can be added from inside the list.

type Aria = { "aria-label"?: string; "aria-invalid"?: boolean }

export function EmployeeSelect({ value, onChange, exclude, placeholder = "Choose the employee", ...rest }: { value: string; onChange: (id: string) => void; exclude?: string; placeholder?: string } & Aria) {
  const list = useCurrentEmployees()
  const rows = (list.data?.data ?? []).filter((e) => e.id !== exclude)
  return (
    <SearchSelect
      {...rest}
      value={value}
      onChange={onChange}
      options={rows.map((e) => ({ value: e.id, label: `${e.name} · ${e.code}`, keywords: `${e.designation ?? ""} ${e.department ?? ""} ${e.phone ?? ""}` }))}
      placeholder={list.error ? "Couldn't load employees" : placeholder}
      searchPlaceholder="Search name, code or designation…"
      searchable
    />
  )
}

export function DepartmentSelect({ value, onChange, ...rest }: { value: string; onChange: (id: string) => void } & Aria) {
  const { can } = useAuth()
  const look = useHrLookups()
  async function add(name: string) {
    if (name.trim().length < 2) return toast.error("Type the department name in the search box first")
    try {
      const d = await api.post<{ id: string }>("/hr/departments", { name: name.trim() })
      await look.reload()
      onChange(d.id)
      toast.success(`${name.trim()} added`)
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }
  return (
    <SearchSelect {...rest} value={value} onChange={onChange} searchable sort
      options={[{ value: "", label: "No department" }, ...(look.data?.departments ?? []).filter((d) => d.isActive || d.id === value).map((d) => ({ value: d.id, label: d.name }))]}
      placeholder="Choose the department" searchPlaceholder="Search or type a new one…"
      onCreate={can("hr.setup.edit") ? (t) => void add(t) : undefined} createLabel="Add this department" />
  )
}

export function DesignationSelect({ value, onChange, departmentId, ...rest }: { value: string; onChange: (id: string) => void; departmentId?: string } & Aria) {
  const { can } = useAuth()
  const look = useHrLookups()
  async function add(name: string) {
    if (name.trim().length < 2) return toast.error("Type the designation in the search box first")
    try {
      const d = await api.post<{ id: string }>("/hr/designations", { name: name.trim(), departmentId: departmentId || null })
      await look.reload()
      onChange(d.id)
      toast.success(`${name.trim()} added`)
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }
  // Designations of the chosen department first, then the ones with no department
  const rows = (look.data?.designations ?? []).filter((d) => (d.isActive || d.id === value) && (!departmentId || !d.departmentId || d.departmentId === departmentId || d.id === value))
  return (
    <SearchSelect {...rest} value={value} onChange={onChange} searchable sort
      options={[{ value: "", label: "No designation" }, ...rows.map((d) => ({ value: d.id, label: d.name }))]}
      placeholder="Choose the designation" searchPlaceholder="Search or type a new one…"
      onCreate={can("hr.setup.edit") ? (t) => void add(t) : undefined} createLabel="Add this designation" />
  )
}

export function ShiftSelect({ value, onChange, ...rest }: { value: string; onChange: (id: string) => void } & Aria) {
  const look = useHrLookups()
  return (
    <SearchSelect {...rest} value={value} onChange={onChange}
      options={(look.data?.shifts ?? []).filter((s) => s.isActive || s.id === value).map((s) => ({ value: s.id, label: `${s.name} · ${s.startsAt}–${s.endsAt}${s.isDefault ? " (default)" : ""}` }))}
      placeholder="Choose the shift" />
  )
}

/** One of the short lists from HR setup; anything typed can be used as well */
export function ListSelect({ list, value, onChange, placeholder = "Choose…", ...rest }: { list: ListKey; value: string; onChange: (v: string) => void; placeholder?: string } & Aria) {
  const look = useHrLookups()
  const items = look.data?.config.lists[list] ?? []
  const options = [...new Set([...items, ...(value ? [value] : [])])].map((v) => ({ value: v, label: v }))
  return <SearchSelect {...rest} value={value} onChange={onChange} options={options} placeholder={placeholder} searchable searchPlaceholder="Search or type your own…" onCreate={(t) => t.trim() && onChange(t.trim())} createLabel="Use what I typed" />
}

/** Small segmented tabs at the top of the pages under one HR menu item */
export function HrTabs<T extends string>({ tabs, active, badge }: { tabs: [T, string, string][]; active: T; badge?: Partial<Record<T, number>> }) {
  return (
    <nav className="mb-4 flex w-fit max-w-full flex-wrap gap-1 rounded-xl border p-1 text-sm print:hidden" aria-label="Pages">
      {tabs.map(([k, label, href]) => {
        const count = badge?.[k]
        return (
          <Link key={k} href={href} aria-current={k === active ? "page" : undefined} className={cn("flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-medium text-muted-foreground hover:text-foreground", k === active && "bg-primary text-primary-foreground hover:text-primary-foreground")}>
            {label}
            {!!count && <span className={cn("rounded-full px-1.5 text-xs tabular-nums", k === active ? "bg-primary-foreground/20" : "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200")}>{count}</span>}
          </Link>
        )
      })}
    </nav>
  )
}

export const TABS = {
  attendance: [["day", "Daily", "/app/m/hr/attendance"], ["month", "Monthly register", "/app/m/hr/attendance/month"], ["shifts", "Shifts", "/app/m/hr/attendance/shifts"]] as [string, string, string][],
  leave: [["apps", "Applications", "/app/m/hr/leave"], ["balances", "Balances", "/app/m/hr/leave/balances"], ["types", "Leave types", "/app/m/hr/leave/types"], ["holidays", "Holidays", "/app/m/hr/leave/holidays"]] as [string, string, string][],
  payroll: [["runs", "Payroll runs", "/app/m/hr/payroll"], ["payslips", "Payslips", "/app/m/hr/payroll/payslips"], ["salaries", "Salary structure", "/app/m/hr/payroll/salaries"], ["loans", "Loans & advances", "/app/m/hr/payroll/loans"], ["overtime", "Overtime", "/app/m/hr/payroll/overtime"]] as [string, string, string][],
  recognition: [["award", "Awards", "/app/m/hr/career/award"], ["promotion", "Promotions", "/app/m/hr/career/promotion"]] as [string, string, string][],
  issues: [["complaint", "Complaints", "/app/m/hr/career/complaint"], ["warning", "Warnings", "/app/m/hr/career/warning"]] as [string, string, string][],
  changes: [["transfer", "Transfers", "/app/m/hr/career/transfer"], ["resignation", "Resignations", "/app/m/hr/career/resignation"], ["termination", "Terminations", "/app/m/hr/career/termination"]] as [string, string, string][],
  performance: [["reviews", "Reviews", "/app/m/hr/performance"], ["goals", "Goals", "/app/m/hr/performance/goals"], ["cycles", "Review cycles", "/app/m/hr/performance/cycles"], ["indicators", "Indicators", "/app/m/hr/performance/indicators"], ["setup", "Setup", "/app/m/hr/performance/setup"]] as [string, string, string][],
  recruitment: [["jobs", "Jobs", "/app/m/hr/recruitment"], ["candidates", "Candidates", "/app/m/hr/recruitment/candidates"], ["interviews", "Interviews", "/app/m/hr/recruitment/interviews"], ["assessments", "Assessments", "/app/m/hr/recruitment/assessments"], ["offers", "Offers", "/app/m/hr/recruitment/offers"], ["onboarding", "Onboarding", "/app/m/hr/recruitment/onboarding"]] as [string, string, string][],
}
