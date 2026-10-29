"use client"

import Link from "next/link"
import { ArrowRight, FileSliders, Tags, type LucideIcon } from "lucide-react"
import { Page } from "@/components/console/kit"
import { useAuth } from "@/lib/auth"

// Settings: three places, in plain words. Everything else lives where it is used.

interface Card {
  href: string
  icon: LucideIcon
  title: string
  text: string
  show: boolean
}

export default function SettingsPage() {
  const { canConsole } = useAuth()
  const cards: Card[] = [
    { href: "/console/settings/plans", icon: Tags, title: "Plans & prices", text: "What each plan includes, its monthly and yearly price, and coupons.", show: canConsole("platform.plan.view") },
    { href: "/console/settings/rules", icon: FileSliders, title: "Company details & rules", text: "AHEAD's invoice details, free trial length, discount limits and the announcement banner.", show: canConsole("platform.setting.view") },
  ]
  return (
    <Page title="Settings" subtitle="How AHEAD is sold. People who use the Console are under People.">
      <div className="grid gap-4 md:grid-cols-2">
        {cards
          .filter((c) => c.show)
          .map((c) => (
            <Link key={c.href} href={c.href} className="group flex flex-col gap-3 rounded-2xl border bg-card p-5 shadow-[0_1px_2px_rgba(16,24,40,0.04)] transition hover:border-primary/40 hover:shadow-sm">
              <span className="grid size-10 place-items-center rounded-xl bg-accent text-accent-foreground">
                <c.icon className="size-5" />
              </span>
              <span className="text-[15px] font-semibold">{c.title}</span>
              <span className="flex-1 text-sm text-muted-foreground">{c.text}</span>
              <span className="inline-flex items-center gap-1 text-[13px] font-medium text-primary">
                Open <ArrowRight className="size-3.5 transition group-hover:translate-x-0.5" />
              </span>
            </Link>
          ))}
      </div>
    </Page>
  )
}
