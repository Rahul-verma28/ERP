"use client"

import * as React from "react"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import { X } from "lucide-react"
import { Button } from "@/components/ui/button"

/** A panel that slides in on the right of the screen (notifications, help). */
export function SidePanel({ open, onOpenChange, eyebrow, title, action, children }: { open: boolean; onOpenChange: (open: boolean) => void; eyebrow?: string; title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-black/25 duration-300 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0" />
        <DialogPrimitive.Popup className="fixed inset-y-0 right-0 z-50 flex w-[26rem] max-w-[92vw] flex-col border-l bg-card text-sm text-card-foreground shadow-xl outline-none duration-300 ease-out data-open:animate-in data-open:slide-in-from-right data-closed:animate-out data-closed:slide-out-to-right">
          <div className="flex items-start justify-between gap-3 border-b px-5 py-4">
            <div className="min-w-0">
              {eyebrow && <div className="text-[11px] font-semibold tracking-[0.08em] text-primary uppercase">{eyebrow}</div>}
              <DialogPrimitive.Title className="text-lg font-semibold">{title}</DialogPrimitive.Title>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {action}
              <DialogPrimitive.Close render={<Button variant="ghost" size="icon" aria-label="Close" />}>
                <X className="size-4" />
              </DialogPrimitive.Close>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
