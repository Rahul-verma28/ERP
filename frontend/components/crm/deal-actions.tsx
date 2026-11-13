"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { ArrowRightLeft, CheckSquare, Eye, FileText, MoreHorizontal, Pencil, RotateCcw, Trash2, Trophy, XCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { ConfirmDialog } from "@/components/common"
import { ActivityDialog, DealDialog, LostDialog } from "@/components/crm/dialogs"
import { api, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { tone, useCrmSetup, type Deal } from "@/lib/crm"
import { cn } from "@/lib/utils"

// Everything that can be done to a deal, from its row, card or page.

type Action = "edit" | "activity" | "task" | "lost" | "won" | "delete"

export function useDealActions(onChanged: (deal?: Deal | null) => void) {
  const [open, setOpen] = React.useState<{ action: Action; deal: Deal } | null>(null)
  const close = () => setOpen(null)
  const d = open?.deal

  async function moveTo(deal: Deal, stageId: string) {
    try {
      onChanged(await api.post<Deal>(`/deals/${deal.id}/stage`, { stageId }))
    } catch (e) {
      toast.error(errorMessage(e))
      throw e
    }
  }
  async function reopen(deal: Deal) {
    try {
      onChanged(await api.post<Deal>(`/deals/${deal.id}/reopen`))
      toast.success("Deal reopened")
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  const dialogs = (
    <>
      {open?.action === "edit" && <DealDialog deal={d} onClose={close} onSaved={(x) => { close(); onChanged(x) }} />}
      {(open?.action === "activity" || open?.action === "task") && <ActivityDialog contactId={d!.contactId} dealId={d!.id} who={d!.contact?.companyName || d!.contact?.name || d!.title} initialType={open.action === "task" ? "task" : "note"} onClose={close} onSaved={() => { close(); onChanged() }} />}
      {open?.action === "lost" && <LostDialog title={`Mark "${d!.title}" as lost`} onClose={close} onConfirm={async (reason, note) => { const x = await api.post<Deal>(`/deals/${d!.id}/lost`, { reason, note: note || null }); toast.success("Deal marked lost"); close(); onChanged(x) }} />}
      <ConfirmDialog
        open={open?.action === "won"}
        onOpenChange={(o) => !o && close()}
        title={`Mark "${d?.title}" as won?`}
        description={d?.contact?.type === "lead" ? "Next, add them to Customers and make the invoice." : "Next, make the quotation or invoice for it."}
        confirmLabel="Mark won"
        onConfirm={async () => {
          try {
            const x = await api.post<Deal>(`/deals/${d!.id}/won`)
            toast.success("Deal won 🎉")
            close()
            onChanged(x)
          } catch (e) {
            toast.error(errorMessage(e))
          }
        }}
      />
      <ConfirmDialog
        open={open?.action === "delete"}
        onOpenChange={(o) => !o && close()}
        destructive
        title={`Delete "${d?.title}"?`}
        description="The deal and its products are removed. Notes and calls stay on the customer's timeline."
        confirmLabel="Delete deal"
        onConfirm={async () => {
          try {
            await api.delete(`/deals/${d!.id}`)
            toast.success("Deal deleted")
            close()
            onChanged(null)
          } catch (e) {
            toast.error(errorMessage(e))
          }
        }}
      />
    </>
  )
  return { act: (action: Action, deal: Deal) => setOpen({ action, deal }), moveTo, reopen, dialogs }
}

export function DealMenu({ deal, actions, view = true }: { deal: Deal; actions: ReturnType<typeof useDealActions>; view?: boolean }) {
  const router = useRouter()
  const { can } = useAuth()
  const setup = useCrmSetup().data
  const stages = setup?.pipelines.find((p) => p.id === deal.pipelineId)?.dealStages ?? []
  const open = deal.status === "open"
  const edit = can("crm.deal.edit")
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`More actions for ${deal.title}`} onClick={(e) => e.stopPropagation()} />}><MoreHorizontal /></DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56" onClick={(e) => e.stopPropagation()}>
        {view && <DropdownMenuItem onClick={() => router.push(`/app/m/crm/deals/${deal.id}`)}><Eye /> Open</DropdownMenuItem>}
        {edit && <DropdownMenuItem onClick={() => actions.act("edit", deal)}><Pencil /> Edit</DropdownMenuItem>}
        {edit && open && stages.length > 0 && (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger><ArrowRightLeft /> Move to stage</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {stages.map((s) => (
                <DropdownMenuItem key={s.id} disabled={s.id === deal.stageId} onClick={() => void actions.moveTo(deal, s.id).then(() => toast.success(`Moved to ${s.name}`)).catch(() => undefined)}>
                  <span className={cn("size-2 rounded-full", tone(s.color).dot)} /> {s.name}{s.probability != null && <span className="ml-auto text-xs text-muted-foreground">{s.probability}%</span>}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}
        {can("crm.activity.create") && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => actions.act("activity", deal)}><Pencil /> Log note or call</DropdownMenuItem>
            <DropdownMenuItem onClick={() => actions.act("task", deal)}><CheckSquare /> Add task</DropdownMenuItem>
          </>
        )}
        {deal.contact?.type === "customer" && can("sales.quotation.create") && <DropdownMenuItem onClick={() => router.push(`/app/m/sales/new?contact=${deal.contactId}`)}><FileText /> Make quotation</DropdownMenuItem>}
        {edit && open && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => actions.act("won", deal)}><Trophy /> Mark won</DropdownMenuItem>
            <DropdownMenuItem onClick={() => actions.act("lost", deal)}><XCircle /> Mark lost</DropdownMenuItem>
          </>
        )}
        {edit && !open && <DropdownMenuItem onClick={() => void actions.reopen(deal)}><RotateCcw /> Reopen</DropdownMenuItem>}
        {can("crm.deal.delete") && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={() => actions.act("delete", deal)}><Trash2 /> Delete</DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function DealStatus({ deal }: { deal: Pick<Deal, "status" | "lostReason"> }) {
  if (deal.status === "open") return <span className={cn("inline-flex h-[22px] items-center rounded-full px-2 text-xs font-semibold", tone("blue").pill)}>Open</span>
  return <span className={cn("inline-flex h-[22px] items-center rounded-full px-2 text-xs font-semibold", tone(deal.status === "won" ? "emerald" : "rose").pill)}>{deal.status === "won" ? "Won" : "Lost"}</span>
}
