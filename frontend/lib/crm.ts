"use client"

import { useSharedApi } from "@/lib/use-api"

// CRM shared types and helpers: pipelines with lead and deal stages, the business's lists
// (sources, labels, lost reasons), leads and deals as the lists return them.

export interface Stage { id: string; pipelineId: string; kind: "lead" | "deal"; name: string; color: string; position: number; probability: number | null }
export interface Pipeline { id: string; name: string; isDefault: boolean; leadStages: Stage[]; dealStages: Stage[] }
export interface CrmOption { id: string; kind: "source" | "label" | "lost_reason"; name: string; color: string | null }
export interface CrmSetup { pipelines: Pipeline[]; sources: CrmOption[]; labels: CrmOption[]; lostReasons: CrmOption[] }

export interface Lead {
  id: string
  type: "lead" | "customer"
  name: string
  companyName: string | null
  phone: string | null
  email: string | null
  subject: string | null
  leadStatus: "new" | "contacted" | "qualified" | "lost" | "converted" | null
  leadSource: string | null
  lostReason: string | null
  pipelineId: string | null
  stageId: string | null
  stage: Stage | null
  followUpOn: string | null
  valuePaise: number | null
  labels: string[]
  ownerId: string | null
  owner: { id: string; name: string } | null
  tasks: { done: number; total: number }
  notes: string | null
  custom?: Record<string, unknown>
  createdAt: string
  updatedAt: string
  version: number
}

export interface Deal {
  id: string
  title: string
  contactId: string
  contact: { id: string; name: string; companyName: string | null; phone: string | null; type: string } | null
  leadId: string | null
  pipelineId: string
  stageId: string
  stage: Stage | null
  valuePaise: number
  status: "open" | "won" | "lost"
  lostReason: string | null
  expectedCloseOn: string | null
  source: string | null
  labels: string[]
  notes: string | null
  ownerId: string | null
  owner: { id: string; name: string } | null
  tasks: { done: number; total: number }
  closedAt: string | null
  createdAt: string
  version: number
}

export interface CrmProduct { id: string; itemId: string; name: string; unit: string; gstRateBp: number; quantity: number; pricePaise: number }

export interface Activity {
  id: string
  type: "note" | "call" | "meeting" | "follow_up" | "task" | "email"
  title: string | null
  body: string | null
  dueAt: string | null
  completedAt: string | null
  createdAt: string
  dealId: string | null
  createdByName: string | null
  assigneeName: string | null
}

export function useCrmSetup() {
  return useSharedApi<CrmSetup>("/crm/setup")
}

/** Full class strings so Tailwind keeps them */
export const STAGE_TONE: Record<string, { pill: string; dot: string; bar: string; soft: string }> = {
  slate: { pill: "bg-slate-100 text-slate-700 dark:bg-slate-500/15 dark:text-slate-300", dot: "bg-slate-400", bar: "bg-slate-400", soft: "bg-slate-50 dark:bg-slate-500/5" },
  blue: { pill: "bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300", dot: "bg-blue-500", bar: "bg-blue-500", soft: "bg-blue-50/60 dark:bg-blue-500/5" },
  violet: { pill: "bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-300", dot: "bg-violet-500", bar: "bg-violet-500", soft: "bg-violet-50/60 dark:bg-violet-500/5" },
  amber: { pill: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300", dot: "bg-amber-500", bar: "bg-amber-500", soft: "bg-amber-50/60 dark:bg-amber-500/5" },
  orange: { pill: "bg-orange-100 text-orange-800 dark:bg-orange-500/15 dark:text-orange-300", dot: "bg-orange-500", bar: "bg-orange-500", soft: "bg-orange-50/60 dark:bg-orange-500/5" },
  emerald: { pill: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300", dot: "bg-emerald-500", bar: "bg-emerald-500", soft: "bg-emerald-50/60 dark:bg-emerald-500/5" },
  rose: { pill: "bg-rose-100 text-rose-800 dark:bg-rose-500/15 dark:text-rose-300", dot: "bg-rose-500", bar: "bg-rose-500", soft: "bg-rose-50/60 dark:bg-rose-500/5" },
  cyan: { pill: "bg-cyan-100 text-cyan-800 dark:bg-cyan-500/15 dark:text-cyan-300", dot: "bg-cyan-500", bar: "bg-cyan-500", soft: "bg-cyan-50/60 dark:bg-cyan-500/5" },
}
export const STAGE_COLORS = Object.keys(STAGE_TONE)
export const tone = (color: string | null | undefined) => STAGE_TONE[color ?? "slate"] ?? STAGE_TONE.slate

export const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?"

/** wa.me needs the country code; Indian mobiles are stored as 10 digits or +91… */
export const waLink = (phone: string, text = "") => {
  const d = phone.replace(/\D/g, "")
  return `https://wa.me/${d.length === 10 ? `91${d}` : d}${text ? `?text=${encodeURIComponent(text)}` : ""}`
}

export const LEAD_STATUS: Record<string, { label: string; tone: string }> = {
  lost: { label: "Lost", tone: "rose" },
  converted: { label: "Converted", tone: "emerald" },
}

/** "Today", "Tomorrow", "3 days late" for a follow-up date */
export function dueLabel(date: string | null, today: string) {
  if (!date) return null
  const d = date.slice(0, 10)
  const days = Math.round((Date.parse(`${d}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000)
  if (days === 0) return { text: "Today", late: false, soon: true }
  if (days === 1) return { text: "Tomorrow", late: false, soon: true }
  if (days < 0) return { text: `${-days} day${days === -1 ? "" : "s"} late`, late: true, soon: false }
  return { text: `In ${days} days`, late: false, soon: false }
}
