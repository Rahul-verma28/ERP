"use client"

import * as React from "react"
import { createPortal } from "react-dom"
import { usePathname } from "next/navigation"
import { CircleHelp, X } from "lucide-react"
import { Button } from "@/components/ui/button"

// Help panel (blueprint Phase G): the "?" in the top bar opens a short guide for the page you
// are on: what it is for, how to do the usual things, and what to know. Plain words, no links
// out; the same for the AHEAD Console and the partner portal.

interface Help {
  title: string
  about: string
  steps: string[]
  notes?: string[]
}

const HELP: [RegExp, Help][] = [
  [/^\/?$/, { title: "Overview", about: "What changed, what needs you, and how things are going today.", steps: ["Start with “Needs attention”: overdue payments, owners who have not signed in, discounts waiting for approval.", "Click any number to open the list behind it.", "Press Ctrl K to jump to a business or a page."] }],
  [/^\/clients\/new/, { title: "Onboard a business", about: "Add a business and its owner. The owner gets a login link and sets their own password.", steps: ["Fill in the business and owner details.", "Pick a free trial, or a paid plan with its price.", "Send the login link by SMS, email or WhatsApp."], notes: ["“Onboarded by” is set to you automatically and cannot be changed later."] }],
  [/^\/clients\/[^/]+/, { title: "A business", about: "Everything about one business: plan, modules, users, payments, handover and history.", steps: ["Use the tabs to move between plan, users, billing and activity.", "Send a new login link if the owner lost theirs; the old one stops working.", "Change plan or add days from the buttons at the top."], notes: ["You see account facts only, never the business's own customers or invoices."] }],
  [/^\/clients/, { title: "Businesses", about: "One table with every business you can see.", steps: ["Use the status tabs and filters; save a set you use often with “Save this view”.", "Tick rows to send login links, add days or export several businesses at once.", "Click a row to open the business."] }],
  [/^\/onboarding\/[^/]+/, { title: "Set up a business", about: "Branding, configuration, data import and handover, step by step. Each step saves as you go.", steps: ["Skip any step and come back later.", "Import customers and products from a spreadsheet and match the columns.", "Hand over: the owner gets the link and accepts in their ERP."] }],
  [/^\/onboarding/, { title: "Onboarding", about: "Businesses being set up, and how far each one is.", steps: ["Open a business to continue its set-up.", "A business leaves this list once the owner has accepted the handover."] }],
  [/^\/payments|^\/invoices/, { title: "Billing", about: "Orders, payments AHEAD received, AHEAD's invoices and upcoming renewals.", steps: ["Record an offline payment from the order.", "Send a payment link for online payment.", "Renewals shows who renews in the next 30 days."], notes: ["Orders with a discount above the person's limit wait for an Admin's approval."] }],
  [/^\/billing/, { title: "Monthly bill", about: "What AHEAD bills you this month for your businesses, after your partner discount.", steps: ["Each business is listed with its plan and price.", "Plan changes you make apply from the next bill."] }],
  [/^\/partners/, { title: "Partners", about: "Resellers, their businesses, their discount and their monthly bill.", steps: ["Add a partner, or approve one from Applications.", "Open a partner to change its discount or pause it."] }],
  [/^\/settings\/plans/, { title: "Plans & pricing", about: "What each plan includes and costs.", steps: ["Open a plan and edit it as a draft.", "Check the impact panel: who is on the plan and who would lose a module.", "Publish when ready. Prices apply to new orders and renewals."] }],
  [/^\/settings/, { title: "Settings", about: "How AHEAD works for every business.", steps: ["Pick a section on the left, change what you need and press Save changes.", "Appearance is the look every new business starts with."], notes: ["Changes reach everyone within a minute and are kept in the audit trail."] }],
  [/^\/modules/, { title: "Modules & features", about: "Every module, which plans include it and how many businesses use it.", steps: ["Change a plan's modules in Plans & pricing.", "Turn a module on or off for one business from that business's Plan tab."] }],
  [/^\/team/, { title: "Team", about: "People who use the Console, and their role.", steps: ["Add a person: they get a login link and set their own password.", "Change a role or turn someone off; their sessions end at once."] }],
  [/^\/roles/, { title: "Roles & permissions", about: "What each Console role can see and do.", steps: ["Open a role to see its permissions.", "Copy a built-in role to make your own, then change it."], notes: ["Permissions marked risky (prices, people, roles) are best kept to Admins."] }],
  [/^\/security/, { title: "Security & audit", about: "Who changed what and when, sign-ins and open sessions.", steps: ["Filter the audit trail by area or person.", "Open an entry to see the before and after values.", "End a session you do not recognise."] }],
  [/^\/applications/, { title: "Applications", about: "People who applied on the website to become a vendor or a partner.", steps: ["Read the application and check the details.", "Approve: the vendor or partner is created and gets a login link.", "Turn down: add a note for the record if you like."] }],
  [/^\/analytics/, { title: "Analytics", about: "How AHEAD is doing over the last 3, 6 or 12 months, within the businesses you can see.", steps: ["Switch the period at the top.", "Click a card to open the businesses behind it.", "Open “How these numbers are counted” at the bottom for each definition."] }],
  [/^\/health/, { title: "System health", about: "The work AHEAD does in the background.", steps: ["Scheduled jobs run every hour; Run now runs one at once.", "Retry failed background work once the cause is fixed, or dismiss it.", "Payment notices that did not match an order: sort it out in Billing, then mark it handled."] }],
  [/^\/referral/, { title: "My link & code", about: "Your own link and code. Businesses that sign up with them are yours.", steps: ["Share the link, or give the code to type at signup.", "They appear under My businesses with you as “Onboarded by”."] }],
  [/^\/account/, { title: "My account", about: "Your name, password, two-step sign-in and sessions." , steps: ["Turn on two-step sign-in for extra safety.", "Sign out of devices you no longer use."] }],
]

const FALLBACK: Help = { title: "Help", about: "Each Console page has a short guide here.", steps: ["Use the menu on the left to move between areas.", "Press Ctrl K to search businesses and pages."] }

function helpFor(path: string) {
  const rest = path.replace(/^\/(console|partner)/, "") || "/"
  return HELP.find(([re]) => re.test(rest))?.[1] ?? FALLBACK
}

export function HelpPanel() {
  const path = usePathname()
  const [open, setOpen] = React.useState(false)
  const help = helpFor(path)
  const closeRef = React.useRef<HTMLButtonElement>(null)

  React.useEffect(() => {
    if (!open) return
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false)
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open])

  return (
    <>
      <Button variant="ghost" size="icon" onClick={() => setOpen(true)} aria-label="Help for this page" title="Help for this page">
        <CircleHelp className="size-5" />
      </Button>
      {/* Portalled: the top bar's backdrop blur would otherwise trap a fixed panel inside it */}
      {open && createPortal(
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-labelledby="help-title">
          <div className="absolute inset-0 bg-black/20" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 right-0 flex w-96 max-w-[92vw] flex-col border-l bg-card shadow-xl">
            <div className="flex items-start justify-between gap-3 border-b px-5 py-4">
              <div>
                <div className="text-[11px] font-semibold tracking-[0.08em] text-primary uppercase">Help</div>
                <h2 id="help-title" className="text-lg font-semibold">{help.title}</h2>
              </div>
              <Button ref={closeRef} variant="ghost" size="icon" onClick={() => setOpen(false)} aria-label="Close help">
                <X className="size-4" />
              </Button>
            </div>
            <div className="grid content-start gap-5 overflow-y-auto px-5 py-5 text-sm">
              <p className="text-muted-foreground">{help.about}</p>
              <section>
                <h3 className="mb-2 font-medium">How to</h3>
                <ol className="grid gap-2">
                  {help.steps.map((s, i) => (
                    <li key={s} className="grid grid-cols-[1.5rem_1fr] gap-2">
                      <span className="grid size-6 place-items-center rounded-full bg-accent text-xs font-semibold text-accent-foreground">{i + 1}</span>
                      <span className="pt-0.5">{s}</span>
                    </li>
                  ))}
                </ol>
              </section>
              {help.notes && (
                <section className="rounded-lg bg-muted/60 p-3">
                  <h3 className="mb-1 font-medium">Good to know</h3>
                  <ul className="grid gap-1 text-muted-foreground">{help.notes.map((n) => <li key={n}>{n}</li>)}</ul>
                </section>
              )}
              <p className="text-xs text-muted-foreground">Press Ctrl K anywhere to search businesses and pages.</p>
            </div>
          </aside>
        </div>,
        document.body,
      )}
    </>
  )
}
