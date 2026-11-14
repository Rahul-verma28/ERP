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

export { TONES as STAGE_TONE, tone } from "@/lib/tones"
import { TONES } from "@/lib/tones"
export const STAGE_COLORS = Object.keys(TONES)

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
