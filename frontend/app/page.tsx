import type { Metadata } from "next"
import Link from "next/link"
import { Inter_Tight } from "next/font/google"
import {
  ArrowRight,
  Building2,
  CalendarCheck,
  ChevronDown,
  ChevronRight,
  FileClock,
  Fingerprint,
  Menu,
  Rocket,
  ShieldCheck,
  Sparkles,
  UserCog,
} from "lucide-react"

import { FAQS, MODULES } from "@/components/marketing/content"
import { IndustryTabs } from "@/components/marketing/industry-tabs"
import {
  AssistantMock,
  BillingMock,
  BookingsMock,
  DashboardMock,
  FirstInvoiceMock,
  ImportMock,
  IndustryPickMock,
  PipelineMock,
  StockMock,
} from "@/components/marketing/mockups"
import { SITE, absoluteUrl } from "@/lib/site"
import { cn } from "@/lib/utils"

const display = Inter_Tight({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-inter-tight", display: "swap" })

export const metadata: Metadata = {
  title: { absolute: SITE.title },
  alternates: { canonical: "/" },
}

/* ---------------- Small building blocks ---------------- */

function CtaLink({ href = "/signup", children, className }: { href?: string; children: React.ReactNode; className?: string }) {
  return (
    <Link
      href={href}
      className={cn("mk-cta inline-flex items-center gap-1.5 rounded-full py-3 pr-5 pl-6 text-[15px] font-medium text-white", className)}
    >
      {children}
      <ChevronRight className="size-4" aria-hidden />
    </Link>
  )
}

function Eyebrow({ icon: Icon, children }: { icon?: React.ComponentType<{ className?: string }>; children: React.ReactNode }) {
  return (
    <span className="mk-glow inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-white px-3 py-1 text-[13px] font-medium text-mk-ink shadow-[0_0_0_4px_rgb(219_234_254/0.6)]">
      {Icon && <Icon className="size-3.5 text-mk-blue" />}
      {children}
    </span>
  )
}

function SplitHeading({ id, dark, muted, text, badge }: { id: string; dark: string; muted: string; text: string; badge?: string }) {
  return (
    <div className="grid gap-6 md:grid-cols-[1.2fr_1fr] md:items-end">
      <div>
        {badge && (
          <span className="mb-4 inline-flex rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-amber-200">{badge}</span>
        )}
        <h3 id={id} className="mk-display text-[34px] sm:text-[44px]">
          {dark}
          <span className="block text-mk-muted">{muted}</span>
        </h3>
      </div>
      <p className="max-w-md text-[17px] leading-relaxed text-mk-muted md:justify-self-end">{text}</p>
    </div>
  )
}

/* ---------------- Structured data ---------------- */

function JsonLd() {
  const data = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": absoluteUrl("/#organization"),
        name: SITE.name,
        url: SITE.url,
        logo: absoluteUrl("/icon.svg"),
      },
      {
        "@type": "WebSite",
        "@id": absoluteUrl("/#website"),
        url: SITE.url,
        name: SITE.name,
        description: SITE.description,
        inLanguage: "en-IN",
        publisher: { "@id": absoluteUrl("/#organization") },
      },
      {
        "@type": "SoftwareApplication",
        "@id": absoluteUrl("/#software"),
        name: SITE.name,
        url: SITE.url,
        description: SITE.description,
        applicationCategory: "BusinessApplication",
        applicationSubCategory: "ERP",
        operatingSystem: "Web browser",
        image: absoluteUrl("/opengraph-image"),
        publisher: { "@id": absoluteUrl("/#organization") },
        featureList: MODULES.filter((m) => m.status === "live").map((m) => m.name),
        offers: { "@type": "Offer", name: "Free plan", price: "0", priceCurrency: "INR", url: absoluteUrl("/signup") },
      },
      {
        "@type": "FAQPage",
        "@id": absoluteUrl("/#faq"),
        mainEntity: FAQS.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
      },
    ],
  }
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }} />
}

/* ---------------- Header & footer ---------------- */

const NAV = [
  { href: "#product", label: "Product" },
  { href: "#industries", label: "Industries" },
  { href: "#modules", label: "Modules" },
  { href: "#faq", label: "FAQ" },
]

function Logo() {
  return (
    <Link href="/" className="inline-flex items-center gap-2 text-[17px] font-semibold tracking-tight" aria-label="AHEAD ERP home">
      <span className="grid size-8 place-items-center rounded-[10px] bg-linear-to-b from-blue-500 to-mk-deep text-sm font-bold text-white shadow-[0_6px_16px_-6px_rgb(29_43_216/0.7)]">
        A
      </span>
      AHEAD
      <span className="font-normal text-mk-soft">ERP</span>
    </Link>
  )
}

function SiteHeader() {
  return (
    <header className="sticky top-0 z-50 border-b border-transparent bg-mk-bg/80 backdrop-blur-xl supports-[backdrop-filter]:bg-mk-bg/65">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <div className="flex items-center gap-8">
          <Logo />
          <nav aria-label="Main" className="hidden items-center gap-6 text-[14px] text-mk-muted md:flex">
            {NAV.map((n) => (
              <a key={n.href} href={n.href} className="transition hover:text-mk-ink">
                {n.label}
              </a>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/login" className="hidden rounded-full border border-mk-line bg-white px-4 py-1.5 text-[14px] font-medium transition hover:border-slate-300 sm:inline-flex">
            Sign in
          </Link>
          <Link href="/signup" className="rounded-full bg-mk-ink px-4 py-1.5 text-[14px] font-medium text-white transition hover:bg-slate-800">
            Start free
          </Link>
          <details className="group relative md:hidden">
            <summary className="grid size-9 cursor-pointer list-none place-items-center rounded-full border border-mk-line bg-white [&::-webkit-details-marker]:hidden" aria-label="Open menu">
              <Menu className="size-4" />
            </summary>
            <div className="mk-card absolute right-0 mt-2 w-48 rounded-2xl p-2">
              {NAV.map((n) => (
                <a key={n.href} href={n.href} className="block rounded-xl px-3 py-2 text-sm hover:bg-mk-bg">
                  {n.label}
                </a>
              ))}
              <Link href="/login" className="block rounded-xl px-3 py-2 text-sm hover:bg-mk-bg">
                Sign in
              </Link>
            </div>
          </details>
        </div>
      </div>
    </header>
  )
}

function SiteFooter() {
  const year = new Date().getFullYear()
  const cols = [
    { title: "Product", links: [["Features", "#product"], ["Modules", "#modules"], ["Industries", "#industries"], ["FAQ", "#faq"]] },
    { title: "Get started", links: [["Start free trial", "/signup"], ["Sign in", "/login"], ["Become a partner", "/apply?type=partner"], ["Become a vendor", "/apply"]] },
    {
      title: "Built for",
      links: [["Salons & spas", "#industries"], ["Retail shops", "#industries"], ["Pharmacies", "#industries"], ["Gyms & studios", "#industries"], ["Coaching & schools", "#industries"], ["Service companies", "#industries"]],
    },
  ]
  return (
    <footer className="border-t border-mk-line">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-[1.4fr_repeat(3,1fr)]">
        <div>
          <Logo />
          <p className="mt-4 max-w-xs text-sm leading-relaxed text-mk-muted">
            Billing, customers, stock, staff and money for Indian businesses — in one app, set up for your industry.
          </p>
        </div>
        {cols.map((c) => (
          <nav key={c.title} aria-label={c.title}>
            <p className="text-sm font-medium">{c.title}</p>
            <ul className="mt-4 space-y-2.5 text-sm text-mk-muted">
              {c.links.map(([label, href]) => (
                <li key={label}>
                  <Link href={href} className="transition hover:text-mk-ink">
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 border-t border-mk-line px-4 py-6 text-xs text-mk-soft sm:px-6">
        <span>© {year} AHEAD ERP. All rights reserved.</span>
        <span>Made in India 🇮🇳 for Indian businesses</span>
      </div>
    </footer>
  )
}

/* ---------------- Page ---------------- */

const INDUSTRY_CHIPS = ["Salons & spas", "Retail shops", "Pharmacies", "Gyms & studios", "Coaching & schools", "Service companies"]

const STEPS = [
  {
    mock: <IndustryPickMock />,
    title: "Pick your industry",
    text: "Choose salon, retail, pharmacy, gym, coaching or services. AHEAD sets up the right fields, terms and sample items for you.",
  },
  {
    mock: <ImportMock />,
    title: "Bring your customers",
    text: "Upload your customer list from a CSV file. Names, mobiles and GSTINs land in the right place, ready to bill.",
  },
  {
    mock: <FirstInvoiceMock />,
    title: "Send your first GST invoice",
    text: "Pick a customer, add items and save. CGST, SGST or IGST is worked out for you, with proper financial-year numbering.",
  },
]

const TRUST = [
  { icon: Fingerprint, title: "Your own isolated workspace", text: "Every business is walled off inside the database itself, so no other company can ever read your records." },
  { icon: UserCog, title: "28 ready-made roles", text: "Owner, manager, accountant, cashier, front desk and more. Each person sees only the screens and actions they need." },
  { icon: FileClock, title: "Audit log built in", text: "Who changed a price, deleted a bill or added a user — every important change is recorded with time and name." },
  { icon: Building2, title: "Branches & teams", text: "Add branches as you grow and invite staff by mobile or email. One login, one view of the whole business." },
]

export default function Home() {
  return (
    <div className={cn("mk min-h-svh overflow-x-clip font-sans antialiased", display.variable)}>
      <JsonLd />
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[60] focus:rounded-full focus:bg-white focus:px-4 focus:py-2 focus:shadow">
        Skip to content
      </a>
      <SiteHeader />

      <main id="main">
        {/* Hero */}
        <section aria-labelledby="hero-title" className="relative">
          <div aria-hidden className="mk-grid-bg pointer-events-none absolute inset-x-0 top-0 h-[560px]" />
          <div aria-hidden className="pointer-events-none absolute top-[-180px] left-1/2 h-[480px] w-[900px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgb(147_197_253/0.45),transparent)]" />
          <div className="relative mx-auto max-w-4xl px-4 pt-16 text-center sm:px-6 sm:pt-24">
            <Link href="/signup" className="inline-block">
              <Eyebrow>
                Free plan forever · {SITE.trialDays}-day full trial <ArrowRight className="size-3.5" aria-hidden />
              </Eyebrow>
            </Link>
            <h1 id="hero-title" className="mk-display mx-auto mt-8 max-w-3xl text-[44px] text-balance sm:text-[68px] lg:text-[80px]">
              The ERP that runs your whole business.
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-[17px] leading-relaxed text-pretty text-mk-muted sm:text-lg">
              GST billing, customers, bookings, staff and expenses in one simple app — built for Indian shops, clinics, salons, gyms,
              institutes and service firms. Know what you sold, who owes you and what to do next.
            </p>
            <div className="mt-9 flex flex-col items-center gap-3">
              <CtaLink>Start your free trial</CtaLink>
              <p className="text-[13px] text-mk-soft">No card needed · Set up in 5 minutes · Cancel anytime</p>
            </div>
          </div>

          <div id="product" className="relative mx-auto mt-16 max-w-6xl scroll-mt-24 px-4 sm:mt-20 sm:px-6">
            <a href="#how-it-works" className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-mk-ink">
              <Rocket className="size-4 text-mk-blue" aria-hidden /> See how it works <ChevronRight className="size-4" aria-hidden />
            </a>
            <DashboardMock />
          </div>

          <div className="mx-auto mt-14 max-w-5xl px-4 text-center sm:px-6">
            <p className="text-sm text-mk-soft">Ready-made setups for</p>
            <ul className="mt-4 flex flex-wrap justify-center gap-x-8 gap-y-3 text-[15px] font-medium text-mk-muted">
              {INDUSTRY_CHIPS.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </div>
        </section>

        {/* Getting started */}
        <section id="how-it-works" aria-labelledby="start-title" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-24 sm:px-6 sm:py-32">
          <div className="mk-reveal text-center">
            <Eyebrow icon={Rocket}>Getting started</Eyebrow>
            <h2 id="start-title" className="mk-display mx-auto mt-6 max-w-2xl text-[40px] text-balance sm:text-[60px]">
              Up and running before your chai gets cold.
            </h2>
            <p className="mx-auto mt-5 max-w-lg text-[17px] text-mk-muted">
              No consultants, no month-long rollout. Three steps and your business is live.
            </p>
          </div>
          <ol className="mt-14 grid gap-5 md:grid-cols-3">
            {STEPS.map((s, i) => (
              <li key={s.title} className="mk-card mk-reveal flex flex-col overflow-hidden rounded-[28px]">
                <div className="flex h-52 items-center bg-linear-to-b from-mk-tint to-white">{s.mock}</div>
                <div className="flex-1 px-6 pt-2 pb-7 text-center">
                  <span className="text-xs font-medium text-mk-blue">Step {i + 1}</span>
                  <h3 className="mk-display mt-2 text-2xl">{s.title}</h3>
                  <p className="mt-3 text-[15px] leading-relaxed text-mk-muted">{s.text}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        {/* Platform */}
        <section aria-labelledby="platform-title" className="border-t border-mk-line bg-linear-to-b from-white to-mk-bg">
          <div className="mx-auto max-w-6xl px-4 py-24 sm:px-6 sm:py-32">
            <div className="mk-reveal text-center">
              <Eyebrow icon={Sparkles}>One business platform</Eyebrow>
              <h2 id="platform-title" className="mk-display mx-auto mt-6 max-w-3xl text-[40px] text-balance sm:text-[64px]">
                From first enquiry to money in the bank.
              </h2>
              <p className="mx-auto mt-5 max-w-xl text-[17px] text-mk-muted">
                Leads, quotations, invoices, bookings and expenses share one record of every customer — so nothing gets typed twice and
                nothing falls through the cracks.
              </p>
              <div className="mt-8">
                <CtaLink>Start free trial</CtaLink>
              </div>
            </div>

            <div className="mt-24 space-y-28 sm:mt-32 sm:space-y-36">
              <article aria-labelledby="f-crm" className="mk-reveal">
                <SplitHeading
                  id="f-crm"
                  dark="Every enquiry, followed up."
                  muted="No lead goes cold again."
                  text="Capture walk-ins, calls and referrals in seconds. See every conversation, quote and next step on the customer's timeline, and know exactly who to call today."
                />
                <div className="mt-10">
                  <PipelineMock />
                </div>
              </article>

              <article aria-labelledby="f-billing" className="mk-reveal">
                <SplitHeading
                  id="f-billing"
                  dark="GST invoices in seconds."
                  muted="Payments you can actually track."
                  text="HSN codes, CGST/SGST or IGST and invoice numbering handled for you. Record cash, UPI or bank payments against each bill and always know what's still due."
                />
                <div className="mt-10">
                  <BillingMock />
                </div>
              </article>

              <article aria-labelledby="f-bookings" className="mk-reveal">
                <SplitHeading
                  id="f-bookings"
                  dark="Bookings without clashes."
                  muted="Staff who know their day."
                  text="One calendar for every stylist, trainer or consultant. Double bookings are blocked automatically and every appointment turns into a bill in one click."
                />
                <div className="mt-10">
                  <BookingsMock />
                </div>
              </article>

              <article aria-labelledby="f-stock" className="mk-reveal">
                <SplitHeading
                  id="f-stock"
                  badge="Coming soon"
                  dark="Stock you can trust."
                  muted="Reorder before you run out."
                  text="Stock across branches, batches and expiry dates, purchase orders and supplier bills — linked to every sale so the numbers always add up."
                />
                <div className="mt-10">
                  <StockMock />
                </div>
              </article>
            </div>
          </div>
        </section>

        {/* AI assistant */}
        <section aria-labelledby="ai-title" className="mx-auto max-w-6xl px-4 py-24 sm:px-6 sm:py-32">
          <div className="mk-card mk-reveal grid items-center gap-14 overflow-hidden rounded-[36px] bg-[radial-gradient(circle_at_100%_0%,#dbeafe,transparent_55%)] p-8 sm:p-14 lg:grid-cols-2">
            <div>
              <span className="inline-flex rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-amber-200">Coming soon</span>
              <h2 id="ai-title" className="mk-display mt-5 text-[38px] sm:text-[48px]">
                Ask your business anything.
                <span className="block text-mk-muted">Get answers, not reports.</span>
              </h2>
              <p className="mt-6 max-w-md text-[17px] leading-relaxed text-mk-muted">
                “Who hasn’t paid this month?” “Which service earns the most on weekends?” The AHEAD assistant reads your own sales, bookings
                and stock and tells you what needs attention — in plain words.
              </p>
              <div className="mt-8">
                <CtaLink>Try AHEAD free</CtaLink>
              </div>
            </div>
            <div className="pb-8">
              <AssistantMock />
            </div>
          </div>
        </section>

        {/* Before / after by industry */}
        <section id="industries" aria-labelledby="industries-title" className="scroll-mt-20 border-y border-mk-line bg-white">
          <div className="mx-auto max-w-5xl px-4 py-24 sm:px-6 sm:py-32">
            <div className="mk-reveal text-center">
              <Eyebrow>Before &amp; after</Eyebrow>
              <h2 id="industries-title" className="mk-display mx-auto mt-6 max-w-2xl text-[40px] text-balance sm:text-[60px]">
                Fewer registers. Clearer numbers.
              </h2>
              <p className="mx-auto mt-5 max-w-lg text-[17px] text-mk-muted">
                When billing, customers and staff live in one place, you finally see what is working — and what isn’t.
              </p>
            </div>
            <div className="mt-12">
              <IndustryTabs />
            </div>
          </div>
        </section>

        {/* Trust */}
        <section aria-labelledby="trust-title" className="mx-auto max-w-6xl px-4 py-24 sm:px-6 sm:py-32">
          <div className="mk-reveal grid gap-6 md:grid-cols-[1fr_1.4fr] md:items-end">
            <div>
              <Eyebrow icon={ShieldCheck}>Safe by design</Eyebrow>
              <h2 id="trust-title" className="mk-display mt-6 text-[38px] sm:text-[52px]">
                Your data stays yours.
                <span className="block text-mk-muted">Your team sees only what it should.</span>
              </h2>
            </div>
            <p className="max-w-md text-[17px] leading-relaxed text-mk-muted md:justify-self-end">
              Security isn’t an add-on for bigger plans. Isolation, roles and audit history are part of every AHEAD workspace, including the
              free one.
            </p>
          </div>
          <ul className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {TRUST.map((t) => (
              <li key={t.title} className="mk-card mk-reveal rounded-3xl p-6">
                <span className="grid size-10 place-items-center rounded-2xl bg-mk-tint text-mk-blue">
                  <t.icon className="size-5" aria-hidden />
                </span>
                <h3 className="mt-5 text-[17px] font-medium tracking-tight">{t.title}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-mk-muted">{t.text}</p>
              </li>
            ))}
          </ul>
        </section>

        {/* Big CTA */}
        <section aria-labelledby="cta-title" className="px-4 sm:px-6">
          <div className="mk-reveal relative mx-auto max-w-6xl overflow-hidden rounded-[40px] bg-mk-ink px-6 py-20 text-center text-white sm:py-28">
            <div aria-hidden className="pointer-events-none absolute -top-40 left-1/2 h-96 w-[800px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgb(59_130_246/0.55),transparent)]" />
            <div aria-hidden className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,rgb(255_255_255/0.05)_1px,transparent_1px),linear-gradient(to_bottom,rgb(255_255_255/0.05)_1px,transparent_1px)] [mask-image:radial-gradient(ellipse_at_50%_0%,black,transparent_70%)] bg-[size:44px_44px]" />
            <div className="relative">
              <CalendarCheck className="mx-auto size-8 text-sky-300" aria-hidden />
              <h2 id="cta-title" className="mk-display mx-auto mt-6 max-w-3xl text-[40px] text-balance sm:text-[64px]">
                Stop juggling apps. Start running AHEAD.
              </h2>
              <p className="mx-auto mt-5 max-w-xl text-[17px] text-slate-300">
                Sales, dues, bookings and expenses, connected from day one. Try every module free for {SITE.trialDays} days — then stay on the
                Free plan or upgrade when you’re ready.
              </p>
              <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
                <CtaLink>Start your free trial</CtaLink>
                <Link href="/login" className="rounded-full border border-white/20 px-6 py-3 text-[15px] font-medium text-white transition hover:bg-white/10">
                  Sign in
                </Link>
              </div>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" aria-labelledby="faq-title" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-24 sm:px-6 sm:py-32">
          <div className="grid gap-12 lg:grid-cols-[1fr_1.6fr]">
            <div className="mk-reveal">
              <Eyebrow>FAQs</Eyebrow>
              <h2 id="faq-title" className="mk-display mt-6 text-[40px] sm:text-[52px]">
                Questions owners ask.
                <span className="block text-mk-muted">Straight answers.</span>
              </h2>
              <p className="mt-5 max-w-sm text-[17px] text-mk-muted">Everything owners ask before they switch. The quickest answer to the rest: start a free trial and look around.</p>
            </div>
            <div className="divide-y divide-mk-line border-y border-mk-line">
              {FAQS.map((f, i) => (
                <details key={f.q} className="group py-1" open={i === 0}>
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-4 text-left text-[17px] font-medium [&::-webkit-details-marker]:hidden">
                    <h3>{f.q}</h3>
                    <ChevronDown className="size-5 shrink-0 text-mk-soft transition group-open:rotate-180" aria-hidden />
                  </summary>
                  <p className="pr-10 pb-5 text-[15px] leading-relaxed text-mk-muted">{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* Modules */}
        <section id="modules" aria-labelledby="modules-title" className="scroll-mt-20 border-t border-mk-line bg-white">
          <div className="mx-auto max-w-6xl px-4 py-24 sm:px-6 sm:py-32">
            <div className="mk-reveal text-center">
              <h2 id="modules-title" className="mk-display mx-auto max-w-3xl text-[40px] text-balance sm:text-[56px]">
                Everything you need. Nothing you don’t.
              </h2>
              <p className="mx-auto mt-5 max-w-lg text-[17px] text-mk-muted">Everything AHEAD does today — and what’s landing next.</p>
            </div>
            <ul className="mt-14 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {MODULES.map((m) => (
                <li
                  key={m.name}
                  className={cn(
                    "flex items-center justify-between gap-3 rounded-2xl border px-4 py-3.5 text-[15px]",
                    m.status === "live" ? "border-mk-line bg-mk-bg" : "border-dashed border-mk-line text-mk-muted"
                  )}
                >
                  {m.name}
                  {m.status === "soon" && (
                    <span className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">Soon</span>
                  )}
                </li>
              ))}
            </ul>
            <div className="mt-12 text-center">
              <CtaLink>Start free trial</CtaLink>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  )
}
