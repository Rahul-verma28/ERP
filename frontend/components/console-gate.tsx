"use client"

import * as React from "react"
import { usePathname, useRouter } from "next/navigation"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import { ConsoleShell } from "@/components/console-shell"
import { errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"

// Shared by /console (AHEAD team, sales, vendors) and /partner (partner portal, Console v3):
// one sign-in, but each person only ever sees their own place.

function FullScreen({ children }: { children: React.ReactNode }) {
  return <div className="grid min-h-svh place-items-center p-6 text-center text-sm text-muted-foreground">{children}</div>
}

export function ConsoleGate({ portal, children }: { portal: "console" | "partner"; children: React.ReactNode }) {
  const router = useRouter()
  const { status, me, switchToConsole } = useAuth()
  const pathname = usePathname()
  const base = `/${portal}`
  const isPartner = me?.console?.audience === "partner"
  // Partners belong in /partner and everyone else in /console: same path, other place
  const wrongPlace = status === "authenticated" && me?.workspace === "console" && isPartner !== (portal === "partner")
  const ready = status === "authenticated" && me?.workspace === "console" && !wrongPlace
  // Two-step is required in the Console once the setup window is over: nothing else opens until it's on
  const mustSetUpMfa = ready && !!me?.security.mustSetUpMfa && !pathname.startsWith(`${base}/account/two-step`)
  React.useEffect(() => {
    if (mustSetUpMfa) router.replace(`${base}/account/two-step`)
  }, [mustSetUpMfa, router, base])
  React.useEffect(() => {
    if (!wrongPlace) return
    const other = isPartner ? "/partner" : "/console"
    const rest = pathname.replace(/^\/(console|partner)/, "")
    // Only pages both places share keep their path; anything else opens the other place's home
    const shared = /^(\/clients(\/.*)?|\/team|\/account(\/.*)?)?$/.test(rest)
    router.replace(shared ? `${other}${rest}` : other)
  }, [wrongPlace, isPartner, pathname, router])
  // Once the Console has been shown, a tenant session means the user switched away: never switch back
  const wasReady = React.useRef(false)
  const switching = React.useRef(false)

  React.useEffect(() => {
    if (ready) wasReady.current = true
    if (status === "anonymous") router.replace("/login")
    if (status !== "authenticated" || !me || me.workspace === "console") return
    // Opened the Console from a business session: Console members switch (once), everyone else goes back
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
