"use client"

import * as React from "react"
import { usePathname, useRouter } from "next/navigation"
import { CloudOff, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { AppShell } from "@/components/app-shell"
import { WorkspaceBranding } from "@/components/workspace-branding"
import { useAuth } from "@/lib/auth"

function FullScreen({ children }: { children: React.ReactNode }) {
  return <div className="grid min-h-svh place-items-center p-6 text-center text-sm text-muted-foreground">{children}</div>
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const { status, me, retry, switchToConsole } = useAuth()
  const [retrying, setRetrying] = React.useState(false)

  const inConsole = status === "authenticated" && me?.workspace === "console"
  React.useEffect(() => {
    if (status === "anonymous") router.replace("/login")
    if (inConsole) router.replace("/console")
  }, [status, inConsole, router])

  // LLD §11.1: the template is applied asynchronously right after signup — the loading
  // screen (/app/welcome) shows its real progress. Welcome and setup are full-screen.
  const pathname = usePathname()
  // A business requires two-step and the grace period is over: nothing else opens until it's set up (A4-D)
  // Console users go to /console, whose own gate sends them to its two-step page; both redirecting
  // at once left the page spinning
  const mustSetUpMfa = status === "authenticated" && !inConsole && !!me?.security.mustSetUpMfa
  const onTwoStep = pathname.startsWith("/app/account/two-step")
  React.useEffect(() => {
    if (mustSetUpMfa && !onTwoStep) router.replace("/app/account/two-step")
  }, [mustSetUpMfa, onTwoStep, router])
  const fullScreen = pathname.startsWith("/app/welcome") || pathname.startsWith("/app/setup") || (mustSetUpMfa && onTwoStep)
  const settingUp = status === "authenticated" && !!me?.tenant && !me.tenant.configApplied && !pathname.startsWith("/app/welcome")
  React.useEffect(() => {
    if (settingUp) router.replace("/app/welcome")
  }, [settingUp, router])

  if (status === "unavailable") {
    return (
      <FullScreen>
        <div className="flex max-w-sm flex-col items-center gap-3">
          <CloudOff className="size-6" />
          <p className="font-medium text-foreground">Can&apos;t reach AHEAD right now</p>
          <p>The server or database isn&apos;t responding. You&apos;re still signed in — we&apos;ll reconnect automatically.</p>
          <Button
            variant="outline"
            disabled={retrying}
            onClick={async () => {
              setRetrying(true)
              await retry()
              setRetrying(false)
            }}
          >
            {retrying ? "Retrying…" : "Try again"}
          </Button>
        </div>
      </FullScreen>
    )
  }
  if (status !== "authenticated" || !me || inConsole) {
    return (
      <FullScreen>
        <Loader2 className="size-5 animate-spin" aria-label="Loading" />
      </FullScreen>
    )
  }
  if (mustSetUpMfa && !onTwoStep) {
    return (
      <FullScreen>
        <Loader2 className="size-5 animate-spin" aria-label="Loading" />
      </FullScreen>
    )
  }
  if (!me.tenant) {
    return (
      <FullScreen>
        <div className="max-w-sm">
          <p className="font-medium text-foreground">No active business</p>
          <p className="mt-1">You&apos;re not an active member of any business yet. Ask your administrator for an invitation.</p>
          {me.console && (
            <Button className="mt-4" onClick={() => switchToConsole().then(() => router.replace("/console"))}>
              Open the AHEAD Console
            </Button>
          )}
        </div>
      </FullScreen>
    )
  }
  if (settingUp) {
    return (
      <FullScreen>
        <Loader2 className="size-5 animate-spin" aria-label="Loading" />
      </FullScreen>
    )
  }
  return (
    <>
      <WorkspaceBranding />
      {fullScreen ? children : <AppShell>{children}</AppShell>}
    </>
  )
}
