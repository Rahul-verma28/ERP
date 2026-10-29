"use client"

import * as React from "react"
import { toast } from "sonner"
import { Copy, MessageCircle, Send } from "lucide-react"
import { Button, buttonVariants } from "@/components/ui/button"
import { api, errorMessage } from "@/lib/api"
import { cn } from "@/lib/utils"

// Console v3: the one-time login link a client owner or Console user receives. Shown after
// adding someone, with Copy and Send on WhatsApp, so it can be shared on the spot.

export interface LoginLink {
  url: string
  expiresAt: string
}

const whatsappHref = (mobile: string, text: string) => `https://wa.me/${mobile.replace(/\D/g, "")}?text=${encodeURIComponent(text)}`

export function LoginLinkBox({ link, mobile, message, className }: { link: LoginLink; mobile?: string; message?: string; className?: string }) {
  async function copy() {
    try {
      await navigator.clipboard.writeText(link.url)
      toast.success("Link copied")
    } catch {
      toast.error("Couldn't copy — select the link and copy it yourself")
    }
  }
  return (
    <div className={cn("grid gap-2", className)}>
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-primary/60 bg-accent/40 p-2.5">
        <code className="min-w-0 flex-1 truncate px-1 text-[13px] text-primary select-all">{link.url}</code>
        <Button type="button" size="sm" variant="outline" onClick={copy}>
          <Copy className="size-3.5" /> Copy
        </Button>
        {mobile && (
          <a href={whatsappHref(mobile, `${message ?? "Set up your AHEAD login here:"} ${link.url}`)} target="_blank" rel="noreferrer" className={buttonVariants({ size: "sm" })}>
            <MessageCircle className="size-3.5" /> Send on WhatsApp
          </a>
        )}
      </div>
      <p className="text-xs text-muted-foreground">Works until {new Date(link.expiresAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}. They verify their mobile and choose their own password.</p>
    </div>
  )
}

/** "Send new link": the old link stops working; shows the new one to copy. */
export function SendNewLink({ path, mobile, label = "Send new link", onSent }: { path: string; mobile?: string; label?: string; onSent?: () => void }) {
  const [busy, setBusy] = React.useState(false)
  const [link, setLink] = React.useState<LoginLink | null>(null)
  async function send() {
    setBusy(true)
    try {
      const l = await api.post<LoginLink>(path)
      setLink(l)
      toast.success("New login link sent by SMS and email")
      onSent?.()
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  if (link) return <LoginLinkBox link={link} mobile={mobile} />
  return (
    <Button type="button" size="sm" variant="outline" onClick={send} disabled={busy}>
      <Send className="size-3.5" /> {busy ? "Sending…" : label}
    </Button>
  )
}
