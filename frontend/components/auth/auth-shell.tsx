import Link from "next/link"
import { ArrowLeft, Boxes, ReceiptText, ShieldCheck } from "lucide-react"
import { cn } from "@/lib/utils"

// The sign-in family's frame: a dark brand panel on the left (what AHEAD is, three short
// points) and the form on the right, centred, with a way back. On phones only the form shows,
// with the logo above it. The panel stays dark in light and dark themes alike.

const POINTS = [
  { icon: ReceiptText, title: "GST billing done right", text: "Invoices, returns and credit notes that follow the rules, numbered the way your CA expects." },
  { icon: Boxes, title: "Everything connected", text: "A sale moves stock, money and reports together. Nothing is typed twice." },
  { icon: ShieldCheck, title: "Your data stays yours", text: "Two-step sign-in, a role for every person and a full record of who changed what." },
]

export function BrandMark({ light = false, className }: { light?: boolean; className?: string }) {
  return (
    <Link href="/" className={cn("inline-flex items-center gap-2.5", className)}>
      <span className={cn("grid size-10 place-items-center rounded-xl text-lg font-extrabold", light ? "bg-white text-[#141a3a]" : "bg-primary text-primary-foreground")}>A</span>
      <span className="leading-tight">
        <span className={cn("block font-bold tracking-wide", light ? "text-white" : "text-foreground")}>AHEAD ERP</span>
        <span className={cn("block text-xs", light ? "text-indigo-200/80" : "text-muted-foreground")}>Business software for India</span>
      </span>
    </Link>
  )
}

/** The dark panel: headline, three points, footer */
export function BrandPanel({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <aside className={cn("relative hidden shrink-0 flex-col overflow-hidden bg-[#0b0f24] text-white lg:flex", className)}>
      {/* Night-sky gradient with a faint grid, as in the reference */}
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_10%_0%,rgba(37,51,146,0.55),transparent_55%),radial-gradient(ellipse_at_90%_100%,rgba(88,56,190,0.45),transparent_55%)]" />
      <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.07] [background-image:linear-gradient(rgba(255,255,255,.6)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.6)_1px,transparent_1px)] [background-size:48px_48px] [mask-image:radial-gradient(ellipse_at_center,black,transparent_75%)]" />
      <div className="relative flex flex-1 flex-col px-10 py-10 xl:px-14">
        <BrandMark light />
        {children ?? (
          <div className="my-auto grid max-w-xl gap-8 py-10">
            <div className="grid gap-4">
              <h2 className="text-[34px] leading-[1.15] font-bold tracking-tight text-balance">
                Run your whole business from <span className="bg-gradient-to-r from-indigo-300 to-violet-300 bg-clip-text text-transparent">one place</span>
              </h2>
              <p className="max-w-md text-[15px] leading-relaxed text-indigo-100/75">GST billing, stock, money, people and customers, built for Indian shops, traders and service businesses.</p>
            </div>
            <ul className="grid gap-5">
              {POINTS.map((p) => (
                <li key={p.title} className="flex gap-3.5">
                  <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/[0.06] text-indigo-200"><p.icon className="size-4" /></span>
                  <span><span className="block text-sm font-semibold">{p.title}</span><span className="text-[13px] leading-relaxed text-indigo-100/65">{p.text}</span></span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <p className="mt-auto text-xs text-indigo-100/50">© {new Date().getFullYear()} AHEAD ERP · Made in India</p>
      </div>
    </aside>
  )
}

/** Brand panel left, the page's form right */
export function AuthShell({ children, back = { href: "/", label: "Back to home" }, wide = false }: { children: React.ReactNode; back?: { href: string; label: string } | null; wide?: boolean }) {
  return (
    <div className="flex min-h-svh bg-background">
      <BrandPanel className="w-[44%] max-w-[720px]" />
      <div className="flex min-w-0 flex-1 flex-col bg-[#f8f9fc] dark:bg-background">
        <div className="flex items-center justify-between px-5 pt-5 sm:px-8">
          {back ? (
            <Link href={back.href} className="inline-flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground">
              <ArrowLeft className="size-3.5" /> {back.label}
            </Link>
          ) : <span />}
          <BrandMark className="lg:hidden" />
        </div>
        <main className="flex flex-1 items-start justify-center px-5 py-10 sm:items-center sm:px-8">
          <div className={cn("w-full has-[[data-auth-wide]]:max-w-xl", wide ? "max-w-xl" : "max-w-[400px]")}>{children}</div>
        </main>
      </div>
    </div>
  )
}

/** Title and line under it, the way every auth page opens */
export function AuthTitle({ title, subtitle, icon }: { title: React.ReactNode; subtitle?: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="mb-7 grid gap-2">
      {icon && <span className="mb-2 grid size-12 place-items-center rounded-2xl bg-primary/10 text-primary">{icon}</span>}
      <h1 className="text-[28px] leading-tight font-bold tracking-tight">{title}</h1>
      {subtitle && <p className="text-sm leading-relaxed text-muted-foreground">{subtitle}</p>}
    </div>
  )
}

/** "or sign in with email" line */
export function OrDivider({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 text-xs text-muted-foreground">
      <span className="h-px flex-1 bg-border" />
      {children}
      <span className="h-px flex-1 bg-border" />
    </div>
  )
}
