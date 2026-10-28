"use client"

import * as React from "react"
import { usePathname, useRouter } from "next/navigation"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import { ConsoleShell } from "@/components/console-shell"
import { errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"

function FullScreen({ children }: { children: React.ReactNode }) {
  return <div className="grid min-h-svh place-items-center p-6 text-center text-sm text-muted-foreground">{children}</div>
}

export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const { status, me, switchToConsole } = useAuth()
  const ready = status === "authenticated" && me?.workspace === "console"
  const pathname = usePathname()
  // Two-step is required in the Console once the setup window is over: nothing else opens until it's on
  const mustSetUpMfa = ready && !!me?.security.mustSetUpMfa && !pathname.startsWith("/console/account/two-step")
  React.useEffect(() => {
    if (mustSetUpMfa) router.replace("/console/account/two-step")
  }, [mustSetUpMfa, router])
  // Once the Console has been shown, a tenant session means the user switched away: never switch back
  const wasReady = React.useRef(false)
  const switching = React.useRef(false)

  React.useEffect(() => {
    if (ready) wasReady.current = true
    if (status === "anonymous") router.replace("/login")
    if (status !== "authenticated" || !me || me.workspace === "console") return
    // Opened /console from a business session: AHEAD team members switch (once), everyone else goes back
    if (me.console && !wasReady.current) {
      if (switching.current) return
      switching.current = true
      switchToConsole()
        .catch((e) => {
          toast.error(errorMessage(e))
          router.replace("/app")
        })
        .finally(() => {
          switching.current = false
        })
    } else router.replace("/app")
  }, [ready, status, me, switchToConsole, router])

  if (!ready || mustSetUpMfa) {
    return (
      <FullScreen>
        <Loader2 className="size-5 animate-spin" aria-label="Loading" />
      </FullScreen>
    )
  }
  return <ConsoleShell>{children}</ConsoleShell>
}
