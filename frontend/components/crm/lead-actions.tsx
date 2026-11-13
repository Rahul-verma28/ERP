"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { ArrowRightLeft, CalendarClock, CheckSquare, Eye, Handshake, MessageCircle, MoreHorizontal, Pencil, Phone, RotateCcw, Trash2, UserCheck, UserPlus, XCircle } from "lucide-react"
import { Button, buttonVariants } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { ConfirmDialog } from "@/components/common"
import { ContactDialog, type Contact } from "@/components/contact-dialog"
import { ActivityDialog, AssignDialog, DealDialog, LeadDialog, LostDialog } from "@/components/crm/dialogs"
import { api, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { tone, useCrmSetup, waLink, type Lead } from "@/lib/crm"
import { cn } from "@/lib/utils"

// Everything that can be done to a lead, from its row, its card or its page.

type Action = "edit" | "activity" | "task" | "followup" | "deal" | "customer" | "lost" | "assign" | "delete"

export function useLeadActions(onChanged: (lead?: Lead | null) => void) {
  const router = useRouter()
  const [open, setOpen] = React.useState<{ action: Action; lead: Lead } | null>(null)
  const [customer, setCustomer] = React.useState<Contact | null>(null)
  const close = () => setOpen(null)
  const done = (l?: Lead | null) => { close(); onChanged(l) }

  async function moveTo(lead: Lead, stageId: string) {
    try {
      const l = await api.post<Lead>(`/leads/${lead.id}/stage`, { stageId })
      onChanged(l)
    } catch (e) {
      toast.error(errorMessage(e))
      throw e
    }
  }
  async function reopen(lead: Lead) {
    try {
      onChanged(await api.post<Lead>(`/leads/${lead.id}/reopen`))
      toast.success("Lead reopened")
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  const l = open?.lead
  const dialogs = (
    <>
      {open?.action === "edit" && <LeadDialog lead={l} onClose={close} onSaved={(x) => done(x)} />}
      {(open?.action === "activity" || open?.action === "task" || open?.action === "followup") && <ActivityDialog contactId={l!.id} who={l!.name} initialType={open.action === "task" ? "task" : open.action === "followup" ? "follow_up" : "note"} onClose={close} onSaved={() => done()} />}
      {open?.action === "deal" && <DealDialog fromLead={l} onClose={close} onSaved={(d) => { close(); onChanged(); router.push(`/app/m/crm/deals/${d.id}`) }} />}
      {open?.action === "lost" && <LostDialog title={`Mark ${l!.name} as lost`} onClose={close} onConfirm={async (reason, note) => { const x = await api.post<Lead>(`/leads/${l!.id}/lost`, { reason, note: note || null }); toast.success("Marked lost"); done(x) }} />}
      {open?.action === "assign" && <AssignDialog count={1} current={l!.ownerId} onClose={close} onConfirm={async (ownerId) => { await api.post("/leads/bulk", { ids: [l!.id], action: "assign", ownerId }); toast.success("Assigned"); done() }} />}
      <ConfirmDialog
        open={open?.action === "customer"}
        onOpenChange={(o) => !o && close()}
        title={`Add ${l?.name} to Customers?`}
        description="They move from Leads to Customers with their notes and tasks. Next, fill in their mobile, GST and address so you can bill them."
        confirmLabel="Convert to customer"
        onConfirm={async () => {
          try {
            const c = await api.post<Contact>(`/leads/${l!.id}/convert`)
            toast.success(`${c.name} is now a customer`)
            close()
            onChanged()
            setCustomer(c)
          } catch (e) {
            toast.error(errorMessage(e))
          }
        }}
      />
      <ConfirmDialog
        open={open?.action === "delete"}
        onOpenChange={(o) => !o && close()}
        destructive
        title={`Delete ${l?.name}?`}
        description="The lead, its notes and tasks are removed. A lead with deals or bills is kept and marked inactive."
        confirmLabel="Delete lead"
        onConfirm={async () => {
          try {
            await api.delete(`/contacts/${l!.id}`)
            toast.success("Lead deleted")
            done(null)
          } catch (e) {
            toast.error(errorMessage(e))
          }
        }}
      />
      {customer && <ContactDialog kind="customer" contact={customer} onClose={() => { setCustomer(null); router.push(`/app/m/sales/customers/${customer.id}`) }} onSaved={(c) => { setCustomer(null); router.push(`/app/m/sales/customers/${c.id}`) }} />}
    </>
  )
  return { act: (action: Action, lead: Lead) => setOpen({ action, lead }), moveTo, reopen, dialogs }
}

/** The ⋮ menu with every action; quick icons (call, WhatsApp, log) sit beside it in lists */
export function LeadMenu({ lead, actions, view = true, align = "end" }: { lead: Lead; actions: ReturnType<typeof useLeadActions>; view?: boolean; align?: "start" | "end" }) {
  const router = useRouter()
  const { can } = useAuth()
  const setup = useCrmSetup().data
  const stages = setup?.pipelines.find((p) => p.id === lead.pipelineId)?.leadStages ?? []
  const closed = lead.leadStatus === "lost" || lead.leadStatus === "converted"
  const edit = can("crm.lead.edit")
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`More actions for ${lead.name}`} onClick={(e) => e.stopPropagation()} />}><MoreHorizontal /></DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="w-56" onClick={(e) => e.stopPropagation()}>
        {view && <DropdownMenuItem onClick={() => router.push(`/app/m/crm/${lead.id}`)}><Eye /> Open</DropdownMenuItem>}
        {edit && !closed && <DropdownMenuItem onClick={() => actions.act("edit", lead)}><Pencil /> Edit</DropdownMenuItem>}
        {edit && !closed && stages.length > 0 && (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger><ArrowRightLeft /> Move to stage</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {stages.map((s) => (
                <DropdownMenuItem key={s.id} disabled={s.id === lead.stageId} onClick={() => void actions.moveTo(lead, s.id).then(() => toast.success(`Moved to ${s.name}`)).catch(() => undefined)}>
                  <span className={cn("size-2 rounded-full", tone(s.color).dot)} /> {s.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}
        {edit && !closed && <DropdownMenuItem onClick={() => actions.act("assign", lead)}><UserPlus /> Assign to…</DropdownMenuItem>}
        {can("crm.activity.create") && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => actions.act("activity", lead)}><Pencil /> Log note or call</DropdownMenuItem>
            <DropdownMenuItem onClick={() => actions.act("task", lead)}><CheckSquare /> Add task</DropdownMenuItem>
            <DropdownMenuItem onClick={() => actions.act("followup", lead)}><CalendarClock /> Schedule follow-up</DropdownMenuItem>
          </>
        )}
        {!closed && (
          <>
            <DropdownMenuSeparator />
            {can("crm.deal.create") && <DropdownMenuItem onClick={() => actions.act("deal", lead)}><Handshake /> Convert to deal</DropdownMenuItem>}
            {can("crm.contact.create") && <DropdownMenuItem onClick={() => actions.act("customer", lead)}><UserCheck /> Convert to customer</DropdownMenuItem>}
            {edit && <DropdownMenuItem onClick={() => actions.act("lost", lead)}><XCircle /> Mark lost</DropdownMenuItem>}
          </>
        )}
        {lead.leadStatus === "lost" && edit && <DropdownMenuItem onClick={() => void actions.reopen(lead)}><RotateCcw /> Reopen</DropdownMenuItem>}
        {can("crm.lead.delete") && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={() => actions.act("delete", lead)}><Trash2 /> Delete</DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Call and WhatsApp in one tap, then log what happened */
export function ReachButtons({ lead, actions, size = "icon-sm" }: { lead: Lead; actions: ReturnType<typeof useLeadActions>; size?: "icon-sm" | "icon-xs" }) {
  const { can } = useAuth()
  const icon = buttonVariants({ variant: "ghost", size })
  const off = cn(icon, "pointer-events-none opacity-30")
  return (
    <>
      {lead.phone ? <a href={`tel:${lead.phone}`} className={icon} title={`Call ${lead.phone}`} aria-label={`Call ${lead.name}`} onClick={(e) => { e.stopPropagation(); if (can("crm.activity.create")) setTimeout(() => actions.act("activity", lead), 600) }}><Phone /></a> : <span className={off} aria-hidden><Phone /></span>}
      {lead.phone ? <a href={waLink(lead.phone, `Hello ${lead.name},`)} target="_blank" rel="noreferrer" className={cn(icon, "text-emerald-600 dark:text-emerald-400")} title="WhatsApp" aria-label={`WhatsApp ${lead.name}`} onClick={(e) => e.stopPropagation()}><MessageCircle /></a> : <span className={off} aria-hidden><MessageCircle /></span>}
    </>
  )
}
