// Public site facts shared by the homepage, metadata, robots, sitemap and structured data.
// Set NEXT_PUBLIC_SITE_URL to the production origin (no trailing slash) before deploying:
// canonical URLs, the sitemap and Open Graph images are built from it.

/** The AHEAD Console: the website's "sell AHEAD" links open its public apply page */
export const CONSOLE_WEB_URL = (process.env.NEXT_PUBLIC_CONSOLE_WEB_URL ?? "http://localhost:3001").replace(/\/$/, "")

export const SITE = {
  name: "AHEAD ERP",
  shortName: "AHEAD",
  url: (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, ""),
  title: "AHEAD ERP — GST billing, CRM & business management software for India",
  description:
    "AHEAD ERP runs your whole business from one app: GST invoices and receipts, customers and leads, quotations, bookings, tasks, expenses and reports. Set up for your industry in minutes. 15-day free trial, free plan after.",
  keywords: [
    "ERP software India",
    "cloud ERP for small business",
    "GST billing software",
    "GST invoice software",
    "CRM software India",
    "quotation and invoice software",
    "appointment booking software",
    "salon software",
    "pharmacy billing software",
    "gym management software",
    "coaching institute software",
    "small business software India",
  ],
  locale: "en_IN",
  trialDays: 15,
} as const

export const absoluteUrl = (path = "/") => `${SITE.url}${path.startsWith("/") ? path : `/${path}`}`
