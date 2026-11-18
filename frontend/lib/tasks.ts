"use client"

import { useSharedApi } from "@/lib/use-api"

// Tasks & Projects: types and labels shared by the Tasks, Projects, Timesheet and Approvals pages.

export type TaskStatus = "todo" | "in_progress" | "done" | "cancelled"
export type Priority = "low" | "medium" | "high" | "urgent"

export interface ChecklistStep { id: string; text: string; done: boolean }

export interface Task {
  id: string
  title: string
  description: string | null
  status: TaskStatus
  priority: Priority
  startOn: string | null
  dueAt: string | null
  estimateMin: number | null
  assigneeId: string | null
  assigneeName: string | null
  createdBy: string | null
  createdByName: string | null
  contactId: string | null
  contact: { id: string; name: string; type: string; phone?: string | null } | null
  projectId: string | null
  project: { id: string; name: string; color: string } | null
  parentId: string | null
  labels: string[]
  checklist: ChecklistStep[]
  repeat: "none" | "daily" | "weekly" | "monthly"
  position: number
  completedAt: string | null
  createdAt: string
  version: number
  /** From the list */
  checklistDone?: number
  checklistTotal?: number
  subtaskCount?: number
  subtaskDone?: number
  comments?: number
  loggedMin?: number
  lastActivityAt?: string | null
  overdue?: boolean
  overdueDays?: number
}

export interface TaskEvent { id: string; type: string; body: string | null; data: Record<string, unknown> | null; at: string; actorName: string | null }
export interface TimeLog {
  id: string
  taskId: string | null
  task: { id: string; title: string } | null
  projectId: string | null
  project: { id: string; name: string; color: string } | null
  userId: string
  userName: string
  workDate: string
  minutes: number
  note: string | null
  billable: boolean
  amountPaise?: number
  createdAt: string
}

export interface TaskDetail extends Task {
  parent: { id: string; title: string } | null
  subtasks: Task[]
  events: TaskEvent[]
  times: TimeLog[]
  approvals: { id: string; number: string; title: string; status: string; amountPaise: number | null }[]
}

export interface Project {
  id: string
  name: string
  code: string | null
  description: string | null
  contactId: string | null
  customer: string | null
  ownerId: string | null
  ownerName: string | null
  memberIds: string[]
  members: { id: string; name: string }[]
  status: "planning" | "active" | "on_hold" | "completed" | "cancelled"
  startOn: string | null
  dueOn: string | null
  budgetPaise: number | null
  billable: boolean
  hourlyRatePaise: number | null
  color: string
  taskTotal: number
  taskDone: number
  taskLate: number
  loggedMin: number
  billableMin: number
  progress: number
  late: boolean
  billedPaise: number
  budgetUsedPct: number | null
  lastActivityAt: string | null
  createdAt: string
  version: number
}

export interface Approval {
  id: string
  number: string
  title: string
  kind: "expense" | "purchase" | "discount" | "leave" | "payment" | "other"
  amountPaise: number | null
  details: string | null
  attachmentUrl: string | null
  requestedBy: string
  requestedByName: string
  approverId: string
  approverName: string
  status: "pending" | "approved" | "rejected" | "withdrawn"
  needBy: string | null
  decidedAt: string | null
  decisionNote: string | null
  task: { id: string; title: string } | null
  project: { id: string; name: string } | null
  late: boolean
  waitingDays: number
  mine: boolean
  forMe: boolean
  createdAt: string
  version: number
}

export const STATUS: Record<TaskStatus, { label: string; color: string }> = {
  todo: { label: "To do", color: "slate" },
  in_progress: { label: "In progress", color: "blue" },
  done: { label: "Done", color: "emerald" },
  cancelled: { label: "Cancelled", color: "rose" },
}
export const PRIORITY: Record<Priority, { label: string; color: string }> = {
  low: { label: "Low", color: "slate" },
  medium: { label: "Medium", color: "blue" },
  high: { label: "High", color: "amber" },
  urgent: { label: "Urgent", color: "rose" },
}
export const PROJECT_STATUS: Record<Project["status"], { label: string; color: string }> = {
  planning: { label: "Planning", color: "violet" },
  active: { label: "Active", color: "blue" },
  on_hold: { label: "On hold", color: "amber" },
  completed: { label: "Completed", color: "emerald" },
  cancelled: { label: "Cancelled", color: "slate" },
}
export const APPROVAL_KIND: Record<Approval["kind"], string> = {
  expense: "Expense", purchase: "Purchase", discount: "Discount", leave: "Leave", payment: "Payment", other: "Other",
}
export const APPROVAL_STATUS: Record<Approval["status"], { label: string; color: string }> = {
  pending: { label: "Waiting", color: "amber" },
  approved: { label: "Approved", color: "emerald" },
  rejected: { label: "Rejected", color: "rose" },
  withdrawn: { label: "Withdrawn", color: "slate" },
}
export const REPEAT_LABEL = { none: "Does not repeat", daily: "Every day", weekly: "Every week", monthly: "Every month" } as const
export const COLORS = ["blue", "emerald", "violet", "amber", "rose", "cyan", "slate"] as const

/** 90 → "1h 30m" */
export function fmtMin(m: number | null | undefined) {
  if (!m) return "0m"
  const h = Math.floor(m / 60)
  const r = m % 60
  return h ? `${h}h${r ? ` ${r}m` : ""}` : `${r}m`
}

export interface Person { id: string; name: string; email: string; role: string; canApprove: boolean }
/** Active people of the business, for assignee, owner, member and approver pickers */
export function usePeople() {
  const r = useSharedApi<{ data: Person[]; me: string }>("/tasks/people")
  return { people: r.data?.data ?? [], me: r.data?.me ?? null, loading: !r.data }
}
