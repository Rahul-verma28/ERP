"use client"

import { useSharedApi } from "@/lib/use-api"

// HR shared types, labels and data hooks.

export type EmploymentType = "full_time" | "part_time" | "contract" | "intern" | "temporary"
export const EMPLOYMENT_LABEL: Record<EmploymentType, string> = { full_time: "Full time", part_time: "Part time", contract: "Contract", intern: "Intern", temporary: "Temporary" }
export const EMP_STATUS: Record<string, { label: string; color: string }> = { active: { label: "Active", color: "emerald" }, on_notice: { label: "On notice", color: "amber" }, exited: { label: "Left", color: "slate" } }

export interface Employee {
  createdAt?: string
  updatedAt?: string
  id: string
  code: string
  name: string
  email: string | null
  phone: string | null
  gender: string | null
  dob: string | null
  photoUrl: string | null
  memberId: string | null
  branchId: string | null
  departmentId: string | null
  designationId: string | null
  managerId: string | null
  shiftId: string | null
  employmentType: EmploymentType
  joinedOn: string
  probationEndsOn: string | null
  status: "active" | "on_notice" | "exited"
  exitOn: string | null
  exitReason: string | null
  address: { line1?: string | null; line2?: string | null; country?: string | null; city?: string | null; state?: string | null; pincode?: string | null } | null
  emergency: { name?: string | null; relation?: string | null; phone?: string | null } | null
  bank: { holder?: string | null; bankName?: string | null; branch?: string | null; accountNo?: string | null; ifsc?: string | null } | null
  pan: string | null
  aadhaarLast4: string | null
  uan: string | null
  esiNo: string | null
  basicPaise: number
  payType: "monthly" | "daily"
  pf: boolean
  esi: boolean
  pt: boolean
  notes: string | null
  version: number
  department: string | null
  designation: string | null
  branch: string | null
  manager: string | null
  shift: string | null
  member?: { id: string; name: string; email: string | null; mobile: string | null } | null
  salaryItems?: SalaryItem[]
}
export interface SalaryItem { id?: string; kind: "allowance" | "deduction"; name: string; calc: "fixed" | "percent"; amount: number }

export interface Department { id: string; name: string; branchId: string | null; headId: string | null; isActive: boolean; employees: number }
export interface Designation { id: string; name: string; departmentId: string | null; isActive: boolean; employees: number }
export interface Shift { id: string; name: string; startsAt: string; endsAt: string; breakMinutes: number; graceMinutes: number; isNight: boolean; isDefault: boolean; isActive: boolean; version: number; workingMinutes: number; employees: number }
export interface LeaveType { id: string; name: string; description?: string | null; code: string; daysPerYear: number; paid: boolean; carryForward: boolean; color: string; isActive: boolean }
export interface HrConfig {
  workingDays: number[]
  employeePrefix: string
  leaveYearStart: number
  pf: { enabled: boolean; employeeBp: number; employerBp: number; capped: boolean; wageCapPaise: number }
  esi: { enabled: boolean; employeeBp: number; employerBp: number; grossLimitPaise: number }
  pt: { enabled: boolean; state: string; slabs: { abovePaise: number; amountPaise: number }[] }
  lists: Record<ListKey, string[]>
  cycles: Cycle[]
  listNotes: Record<string, string>
  documentTypes: DocumentType[]
  indicators: Indicator[]
  offerTemplate: string
}
export interface DocumentType { id: string; name: string; description?: string | null; required: boolean }
export interface Cycle { id: string; name: string; frequency: "monthly" | "quarterly" | "half_yearly" | "yearly" | "one_time"; description?: string | null; active: boolean }
export interface Indicator { id: string; name: string; category?: string | null; unit: "rating" | "percent" | "number" | "amount"; target?: string | null; description?: string | null; active: boolean }
export const FREQUENCY: Record<Cycle["frequency"], string> = { monthly: "Every month", quarterly: "Every 3 months", half_yearly: "Every 6 months", yearly: "Every year", one_time: "One time (e.g. probation)" }
export const UNIT: Record<Indicator["unit"], string> = { rating: "Rating out of 5", percent: "Percent", number: "Number", amount: "Amount (₹)" }
export type ListKey = "awardTypes" | "warningTypes" | "complaintTypes" | "terminationTypes" | "documentCategories" | "announcementCategories" | "eventTypes" | "goalTypes" | "reviewCycles" | "reviewIndicators" | "indicatorCategories" | "jobLocations" | "jobCategories" | "assessmentTypes" | "onboardingCategories" | "holidayTypes" | "loanTypes" | "allowanceTypes" | "deductionTypes" | "candidateSources"
export const LIST_LABEL: Record<ListKey, string> = {
  allowanceTypes: "Allowance names", deductionTypes: "Deduction names", awardTypes: "Award types", warningTypes: "Warning types", complaintTypes: "Complaint types", terminationTypes: "Termination types",
  announcementCategories: "Announcement categories", eventTypes: "Event types", documentCategories: "Document categories", goalTypes: "Goal types", reviewCycles: "Review cycles", reviewIndicators: "What reviews rate",
  candidateSources: "Candidate sources", indicatorCategories: "Indicator categories", jobLocations: "Job locations", jobCategories: "Job categories", assessmentTypes: "Assessment types", onboardingCategories: "Onboarding task categories", holidayTypes: "Holiday types", loanTypes: "Loan types",
}

export interface Lookups { config: HrConfig; departments: Department[]; designations: Designation[]; shifts: Shift[]; leaveTypes: LeaveType[] }
export function useHrLookups() {
  return useSharedApi<Lookups>("/hr/lookups")
}
export function useCurrentEmployees() {
  return useSharedApi<{ data: Employee[] }>("/hr/employees?status=current")
}

export const ATT: Record<string, { label: string; short: string; color: string }> = {
  present: { label: "Present", short: "P", color: "emerald" },
  absent: { label: "Absent", short: "A", color: "rose" },
  half_day: { label: "Half day", short: "H", color: "amber" },
  leave: { label: "On leave", short: "L", color: "violet" },
  holiday: { label: "Holiday", short: "HO", color: "blue" },
  week_off: { label: "Weekly off", short: "WO", color: "slate" },
  unmarked: { label: "Not marked", short: "·", color: "slate" },
  future: { label: "", short: "", color: "slate" },
}
export const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

export interface LeaveApp { id: string; employeeId: string; employee: string; employeeCode: string; employeeSub?: string | null; leaveTypeId: string; leaveType: string; leaveCode: string; color: string; paid: boolean; fromDate: string; toDate: string; halfDay: boolean; days: number; reason: string; status: "pending" | "approved" | "rejected" | "cancelled"; comment: string | null; decidedByName?: string | null; decidedAt?: string | null; createdAt: string; version: number }
export const LEAVE_STATUS: Record<string, { label: string; color: string }> = { pending: { label: "Waiting", color: "amber" }, approved: { label: "Approved", color: "emerald" }, rejected: { label: "Rejected", color: "rose" }, cancelled: { label: "Cancelled", color: "slate" } }

export interface Line { name: string; amountPaise: number; code?: string; loanId?: string; manual?: boolean }
export interface Payslip {
  id: string; runId: string; employeeId: string; number: string; employee?: string; employeeCode?: string
  daysInMonth: number; payableDays: number; lopDays: number; basicPaise: number
  earnings: Line[]; deductions: Line[]; employer: Line[]
  grossPaise: number; deductionsPaise: number; netPaise: number; employerPaise: number
  status: "unpaid" | "paid"; paidOn: string | null; journalId: string | null
  snapshot: { name: string; code: string; designation: string | null; department: string | null; joinedOn: string; pan: string | null; uan: string | null; esiNo: string | null; bank: Employee["bank"]; payType: string } | null
  run?: { month: string; status: string; payDate: string; number: string }
  company?: { name: string; address: unknown }
  month?: string; runStatus?: string
}
export interface PayrollRun {
  id: string; number: string; month: string; periodFrom: string; periodTo: string; payDate: string
  status: "draft" | "processed" | "paid"; accountId: string | null; account?: string | null; notes: string | null
  employees: number; grossPaise: number; deductionsPaise: number; netPaise: number; employerPaise: number; paidPaise: number; version: number
  payslips?: Payslip[]
}
export const RUN_STATUS: Record<string, { label: string; color: string }> = { draft: { label: "Draft", color: "slate" }, processed: { label: "Processed", color: "blue" }, paid: { label: "Paid", color: "emerald" } }
export const monthLabel = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" })

export type ActionKind = "promotion" | "transfer" | "award" | "warning" | "complaint" | "resignation" | "termination"
export interface HrAction {
  id: string; kind: ActionKind; employeeId: string; employee: string; employeeCode: string; againstId: string | null; against: string | null
  onDate: string; effectiveOn: string | null; typeName: string | null; subject: string | null; description: string | null; severity: string | null
  from: { branch: string | null; department: string | null; designation: string | null }; to: { branch: string | null; department: string | null; designation: string | null }
  toData: { branchId?: string | null; departmentId?: string | null; designationId?: string | null } | null
  status: string; response: string | null; documentUrl: string | null; version: number; createdAt: string; decidedByName?: string | null; decidedAt?: string | null
  createdByName?: string | null; employeeSub?: string | null; againstSub?: string | null
}
export const ACTION_STATUS: Record<string, { label: string; color: string }> = {
  pending: { label: "Waiting", color: "amber" }, approved: { label: "Approved", color: "emerald" }, rejected: { label: "Rejected", color: "rose" }, accepted: { label: "Accepted", color: "emerald" },
  given: { label: "Given", color: "emerald" }, issued: { label: "Issued", color: "orange" }, acknowledged: { label: "Acknowledged", color: "blue" }, withdrawn: { label: "Withdrawn", color: "slate" },
  open: { label: "Open", color: "amber" }, in_review: { label: "In review", color: "blue" }, resolved: { label: "Resolved", color: "emerald" }, dismissed: { label: "Dismissed", color: "slate" },
}

export interface Post { id: string; kind: "announcement" | "event" | "document"; title: string; category: string | null; body: string | null; startsOn: string | null; endsOn: string | null; startsAt: string | null; endsAt: string | null; location: string | null; priority: "low" | "normal" | "high"; departmentIds: string[]; departments: string[]; url: string | null; needsAck: boolean; status: "active" | "draft" | "inactive" | "pending" | "approved" | "rejected"; color: string | null; createdByName: string | null; approvedByName: string | null; approvedAt: string | null; acks: number; employees: number; ackedByMe: boolean | null; createdAt: string }

export const initialsOf = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("")

/** Lists edited on HRM System Setup; the rest live on their own pages */
export const HRM_LISTS: ListKey[] = ["allowanceTypes", "deductionTypes", "awardTypes", "warningTypes", "complaintTypes", "terminationTypes", "announcementCategories", "eventTypes", "documentCategories"]

/** Trainers, assessments, offers, checklists and onboardings share one shape */
export interface HrRecord<T = Record<string, unknown>> {
  id: string; kind: string; status: string; version: number; createdAt: string; refId: string | null; data: T
  candidate: { id: string; name: string; stage: string; employeeId: string | null; phone: string | null; email: string | null; job: string | null } | null
  names: { conductedBy: string | null; buddy: string | null; employee: string | null; department: string | null; designation: string | null }
}
export function useRecords<T>(kind: "trainer" | "assessment" | "offer" | "checklist" | "onboarding") {
  return useSharedApi<{ data: HrRecord<T>[] }>(`/hr/records/${kind}`)
}
