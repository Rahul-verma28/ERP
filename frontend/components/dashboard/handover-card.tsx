"use client"

import * as React from "react"
import { CheckCircle2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { api, errorMessage } from "@/lib/api"
import { useApi } from "@/lib/use-api"

// Console handover (blueprint Phase B): when AHEAD or a partner set up this workspace, the owner
// sees what was done and accepts it with one click. Only the owner ever gets this card.

interface Handover {
  sentAt: string
  steps: Partial<Record<"branding" | "config" | "import", "done" | "skipped">>
  imported: { contacts?: number; items?: number }
}

export function HandoverCard() {
  const { data, setData } = useApi<{ handover: Handover | null }>("/tenant/handover")
  const [busy, setBusy] = React.useState(false)
  const h = data?.handover
  if (!h) return null
  const done = [
    "Business, plan and modules",
    h.steps.branding === "done" && "Brand colour and font",
    h.steps.config === "done" && "Financial year and document numbering",
    h.steps.import === "done" && `Imported ${h.imported.contacts ?? 0} customers and ${h.imported.items ?? 0} products`,
  ].filter(Boolean) as string[]
  async function accept() {
    setBusy(true)
    try {
      await api.post("/tenant/handover/accept")
      toast.success("Thanks — your workspace is now yours")
      setData({ handover: null })
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardHeader>
        <CardTitle>Your workspace is ready</CardTitle>
        <CardDescription>It was set up for you on {new Date(h.sentAt).toLocaleDateString("en-IN", { day: "numeric", month: "long" })}. Check it, then accept the handover. Everything stays editable in Settings.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <ul className="grid gap-1.5 text-sm">
          {done.map((d) => (
            <li key={d} className="flex items-center gap-2"><CheckCircle2 className="size-4 text-emerald-600" /> {d}</li>
          ))}
        </ul>
        <div>
          <Button onClick={accept} disabled={busy}>{busy ? "Saving…" : "Accept handover"}</Button>
        </div>
      </CardContent>
    </Card>
  )
}
