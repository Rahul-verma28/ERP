"use client"

import * as React from "react"
import { Lock, Pencil, type LucideIcon } from "lucide-react"
import { changeReason } from "@contracts/validation"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { DiscardChangesDialog, ErrorSummary, Field, FormError } from "@/components/form"
import { Cancelled, type FormApi } from "@/lib/use-form"
import { useUnsavedChanges } from "@/lib/use-unsaved"
import { cn } from "@/lib/utils"

// Phase 0 view-first pattern: a card that reads as plain text, opens for editing on
// request, counts changes, asks before discarding, and for sensitive fields shows
// before → after with a reason before saving.

export interface DiffRow {
  label: string
  before: string
  after: string
}

const shown = (v: string) => (v.trim() === "" ? "—" : v)

/**
 * Confirm dialog with the diff and a required reason. `ask` resolves the reason, or
 * throws Cancelled (which useForm treats as "do nothing").
 */
export function useConfirmChanges() {
  const [req, setReq] = React.useState<{ rows: DiffRow[]; note?: string; resolve: (reason: string) => void; reject: () => void } | null>(null)
  const [reason, setReason] = React.useState("")
  const [touched, setTouched] = React.useState(false)
  const error = touched ? changeReason(reason) : null

  const ask = React.useCallback(
    (rows: DiffRow[], note?: string) =>
      new Promise<string>((resolve, reject) => {
        setReason("")
        setTouched(false)
        setReq({ rows, note, resolve, reject: () => reject(new Cancelled()) })
      }),
    []
  )

  const close = () => {
    req?.reject()
    setReq(null)
  }
  const confirm = () => {
    setTouched(true)
    if (changeReason(reason) || !req) return
    req.resolve(reason.trim())
    setReq(null)
  }

  const dialog = (
    <Dialog open={!!req} onOpenChange={(o) => !o && close()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Confirm changes</DialogTitle>
          <DialogDescription>{req?.note ?? "Please check these changes. The reason is kept in the audit log."}</DialogDescription>
        </DialogHeader>
        <div className="overflow-hidden rounded-2xl border text-sm">
          <div className="grid grid-cols-3 gap-2 bg-muted/60 px-3 py-2 text-xs font-medium text-muted-foreground">
            <span>Field</span>
            <span>Before</span>
            <span>After</span>
          </div>
          {req?.rows.map((r) => (
            <div key={r.label} className="grid grid-cols-3 gap-2 border-t px-3 py-2">
              <span className="font-medium">{r.label}</span>
              <span className="break-words text-muted-foreground line-through">{shown(r.before)}</span>
              <span className="break-words text-emerald-700 dark:text-emerald-400">{shown(r.after)}</span>
            </div>
          ))}
        </div>
        <Field label="Reason for the change" required error={error} count={[reason.trim().length, 500]} hint="10–500 characters">
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} onBlur={() => setTouched(true)} rows={3} autoFocus />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={close}>
            Back
          </Button>
          <Button onClick={confirm}>Confirm &amp; save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )

  return { ask, dialog }
}

/** Read-only label/value pairs for the view mode. */
export function ReadOnlyGrid({ items, className }: { items: { label: string; value: React.ReactNode; wide?: boolean }[]; className?: string }) {
  return (
    <dl className={cn("grid gap-x-6 gap-y-4 sm:grid-cols-2", className)}>
      {items.map((i) => (
        <div key={i.label} className={cn("min-w-0", i.wide && "sm:col-span-2")}>
          <dt className="text-xs font-medium text-muted-foreground">{i.label}</dt>
          <dd className="mt-0.5 break-words text-sm font-medium">{i.value === null || i.value === undefined || i.value === "" ? <span className="font-normal text-muted-foreground">Not added</span> : i.value}</dd>
        </div>
      ))}
    </dl>
  )
}

const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName))

export function EditableSection<T extends Record<string, unknown>>({
  title,
  icon: Icon,
  id,
  description,
  form,
  canEdit,
  lockedReason,
  view,
  children,
  footerNote,
  confirmDialog,
  onEditingChange,
}: {
  title: string
  /** A small icon tile beside the title (settings pages) */
  icon?: LucideIcon
  /** Anchor for links like /app/settings#address */
  id?: string
  description?: string
  form: FormApi<T>
  canEdit: boolean
  /** Shown instead of Edit when the record can't be changed (e.g. FY locked) */
  lockedReason?: string
  view: React.ReactNode
  /** Edit-mode fields */
  children: React.ReactNode
  /** e.g. "Last changed 12 Oct by Asha Rao" */
  footerNote?: React.ReactNode
  /** The dialog from useConfirmChanges, when the section has sensitive fields */
  confirmDialog?: React.ReactNode
  onEditingChange?: (editing: boolean) => void
}) {
  const [editing, setEditingState] = React.useState(false)
  const [discardOpen, setDiscardOpen] = React.useState(false)
  const cardRef = React.useRef<HTMLDivElement>(null)
  const guard = useUnsavedChanges(editing && form.dirty)

  const setEditing = React.useCallback(
    (v: boolean) => {
      setEditingState(v)
      onEditingChange?.(v)
    },
    [onEditingChange]
  )

  const cancel = React.useCallback(() => {
    if (form.dirty) setDiscardOpen(true)
    else {
      form.reset()
      setEditing(false)
    }
  }, [form, setEditing])

  const save = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (await form.submit()) setEditing(false)
  }

  // Keyboard: E opens the card being looked at, Ctrl/Cmd+S saves, Esc cancels
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const inCard = cardRef.current?.contains(document.activeElement) || cardRef.current?.matches(":hover")
      if (!editing && canEdit && !lockedReason && e.key.toLowerCase() === "e" && !e.ctrlKey && !e.metaKey && !isTyping(e.target) && inCard) {
        e.preventDefault()
        setEditing(true)
      } else if (editing && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault()
        cardRef.current?.querySelector("form")?.requestSubmit()
      } else if (editing && e.key === "Escape" && !document.querySelector("[role=dialog]")) {
        cancel()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [editing, canEdit, lockedReason, cancel, setEditing])

  const changes = form.changed.length

  return (
    <Card ref={cardRef} id={id} className={cn("scroll-mt-20", editing && "ring-2 ring-primary/40")}>
      <form {...form.formProps} onSubmit={save} className="flex flex-col gap-(--card-spacing)">
        <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
          <div className="flex min-w-0 items-start gap-3">
            {Icon && (
              <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                <Icon className="size-4" aria-hidden />
              </span>
            )}
            <div className="min-w-0">
              <CardTitle>{title}</CardTitle>
              {description && <CardDescription className="mt-1">{description}</CardDescription>}
            </div>
          </div>
          {editing ? (
            <Badge variant="secondary">Editing</Badge>
          ) : lockedReason ? (
            <Badge variant="outline" className="gap-1" title={lockedReason}>
              <Lock className="size-3" /> Locked
            </Badge>
          ) : canEdit ? (
            <Button type="button" variant="outline" size="sm" onClick={() => setEditing(true)} aria-label={`Edit ${title}`}>
              <Pencil /> Edit
            </Button>
          ) : (
            <Badge variant="outline">View only</Badge>
          )}
        </CardHeader>
        <CardContent className="grid gap-4">
          {editing ? (
            <>
              <ErrorSummary fields={form.summary} show={form.submitted} />
              {children}
              <FormError message={form.formError} />
            </>
          ) : (
            <>
              {view}
              {lockedReason && <p className="text-xs text-muted-foreground">{lockedReason}</p>}
            </>
          )}
        </CardContent>
        {(editing || footerNote) && (
          <CardFooter className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
            {editing ? (
              <>
                <span className="text-xs text-muted-foreground">{changes ? `${changes} unsaved change${changes > 1 ? "s" : ""}` : "No changes yet"}</span>
                <div className="flex gap-2">
                  <Button type="button" variant="outline" onClick={cancel} disabled={form.submitting}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={!changes || form.submitting}>
                    {form.submitting ? "Saving…" : "Save changes"}
                  </Button>
                </div>
              </>
            ) : (
              <span className="text-xs text-muted-foreground">{footerNote}</span>
            )}
          </CardFooter>
        )}
      </form>
      {confirmDialog}
      <DiscardChangesDialog
        open={discardOpen || guard.leaving}
        count={changes}
        onKeep={() => {
          setDiscardOpen(false)
          guard.stay()
        }}
        onDiscard={() => {
          setDiscardOpen(false)
          form.reset()
          setEditing(false)
          if (guard.leaving) guard.leave()
        }}
      />
    </Card>
  )
}
