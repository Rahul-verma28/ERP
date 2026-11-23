"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { toast } from "sonner"
import { Download, Loader2, Lock, RotateCcw, Store } from "lucide-react"
import { Button, buttonVariants } from "@/components/ui/button"
import { api, errorMessage } from "@/lib/api"
import { LockedPage, ModuleLocked } from "@/components/page-states"
import { useAuth } from "@/lib/auth"
import { formatDate } from "@/lib/format"
import { MODULE_NAV } from "@/lib/nav"
import type { ModuleKey } from "@/lib/types"

// What every page in the app checks before it shows anything, so the reason is always the real
// one and always looks the same:
//   1. the business is closed → one screen everywhere (owner: reopen or download; team: ask the owner)
//   2. the page's module isn't in the plan → the module's locked page
// Pages then do their own role checks (NoAccessPage).

/** Pages that stay open while a business is closed: reopening, exporting, and one's own account */
const OPEN_WHEN_CLOSED = [/^\/app\/billing/, /^\/app\/settings\/data/, /^\/app\/account/]

/** Address segment after /app/m/ → the module it belongs to */
const SEGMENT_MODULE: Record<string, ModuleKey> = { purchase: "inventory", pos: "billing" }

function moduleOf(pathname: string): ModuleKey | null {
  const seg = /^\/app\/m\/([a-z]+)/.exec(pathname)?.[1]
  if (!seg) return null
  if (SEGMENT_MODULE[seg]) return SEGMENT_MODULE[seg]
  return MODULE_NAV.some((m) => m.key === seg) ? (seg as ModuleKey) : null
}

export function WorkspaceGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { me, can, term } = useAuth()
  if (!me?.tenant) return <>{children}</>

  if (me.subscription?.status === "closed" && !OPEN_WHEN_CLOSED.some((r) => r.test(pathname))) return <BusinessClosed />

  const key = moduleOf(pathname)
  if (key && me.modules?.[key]?.status === "inactive") {
    const nav = MODULE_NAV.find((m) => m.key === key)!
    const name = nav.termKey ? term(nav.termKey, nav.label) : nav.label
    return <ModuleLocked name={name} description={nav.description} canUpgrade={can("tenant.billing.view")} />
  }
  return <>{children}</>
}

function BusinessClosed() {
  const { me, can, reload } = useAuth()
  const owner = can("tenant.account.delete")
  const router = useRouter()
  const [busy, setBusy] = React.useState(false)
  const reopen = async () => {
    setBusy(true)
    try {
      await api.post("/tenant/reopen")
      await reload()
      toast.success("Your business is open again on the Free plan. Choose a plan to unlock more.")
      router.push("/app/billing")
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  const since = me?.tenant?.closedAt ? ` on ${formatDate(me.tenant.closedAt)}` : ""
  return (
    <LockedPage
      title={me?.tenant?.name ?? "Your business"}
      icon={<Store className="size-5" />}
      heading="This business is closed"
      action={
        owner ? (
          <>
            <Button onClick={() => void reopen()} disabled={busy}>
              {busy ? <Loader2 className="animate-spin" /> : <RotateCcw />} {busy ? "Reopening…" : "Reopen the business"}
            </Button>
            <Link href="/app/settings/data" className={buttonVariants({ variant: "outline" })}>
              <Download /> Download your data
            </Link>
          </>
        ) : undefined
      }
    >
      <p>
        It was closed{since}. Nothing was deleted: every record and file is kept safe.
      </p>
      <p className="mt-1">
        {owner ? (
          "Reopen it on the Free plan and choose a plan after, or download everything first."
        ) : (
          <>
            <Lock className="mr-1 inline size-3.5 align-[-2px]" aria-hidden />
            Ask the business owner to reopen it. You can still change your own account.
          </>
        )}
      </p>
    </LockedPage>
  )
}
