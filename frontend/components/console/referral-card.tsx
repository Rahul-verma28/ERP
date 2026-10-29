"use client"

import { toast } from "sonner"
import { Copy, Link2 } from "lucide-react"
import { buttonVariants } from "@/components/ui/button"
import { Panel } from "@/components/console/kit"

// A vendor's or salesperson's referral link and code: signups with either are credited to them.

export function ReferralCard({ code, link }: { code: string; link: string }) {
  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success(`${what} copied`)
    } catch {
      toast.error("Couldn't copy — select it and copy instead")
    }
  }
  return (
    <Panel title="Your referral link" description="Anyone who signs up with this link or code is added to your clients automatically.">
      <div className="grid min-w-0 gap-3">
        <div className="flex min-w-0 items-center gap-2 rounded-xl border bg-muted/40 px-3 py-2.5">
          <Link2 className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate font-mono text-[13px]">{link}</span>
          <button type="button" onClick={() => copy(link, "Link")} className={buttonVariants({ size: "sm", variant: "outline" })}>
            <Copy /> Copy link
          </button>
        </div>
        <div className="flex min-w-0 items-center justify-between gap-2 rounded-xl border bg-muted/40 px-3 py-2.5">
          <span className="text-[13px] text-muted-foreground">
            Code <span className="ml-1 font-mono text-[15px] font-semibold tracking-wider text-foreground">{code}</span>
          </span>
          <button type="button" onClick={() => copy(code, "Code")} className={buttonVariants({ size: "sm", variant: "ghost" })}>
            <Copy /> Copy
          </button>
        </div>
      </div>
    </Panel>
  )
}
