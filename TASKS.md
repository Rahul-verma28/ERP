# AHEAD SOFTWARE ERP — Development Task Breakdown

Source docs: PRD v1, LLD v1 (Platform Core), Roles & Permissions Design, Onboarding/Trial/Subscription/Payment Flow, Module Catalogue (30 modules), Client Clarifications (web-first).

Status legend: `[x]` done · `[~]` in progress / partial · `[ ]` not started
Priority from PRD: P0 = launch blocker, P1 = should have, P2 = later.

Stack (as per PRD §9 / LLD): Next.js (frontend/) · Express + TypeScript (backend/) · PostgreSQL on Neon with RLS · Prisma ORM · Zod · JWT access + rotating refresh cookie.
Dev-time substitutions (swap before production): OTP/email are logged to the backend console (no SMS/SES provider yet); outbox events are consumed by an in-process poller instead of Redis + BullMQ; permission/entitlement caches are in-memory.

---

## Phase 1 — Foundation + free core (weeks 1–4)
Exit gate: a tenant can sign up, configure, and issue a GST invoice.

### 1.1 Backend kernel
- [x] Config validated with Zod at startup (exit on missing values)
- [x] Prisma setup, UUID v7 ids, money in paise (bigint)
- [x] Request-scoped tenant transaction (`withTenant`) with `SET LOCAL ROLE app_user` + `app.tenant_id` (RLS), `withPlatform` for platform tables
- [x] Standard error format + error codes (LLD §12.2), `X-Request-Id`
- [x] Zod `validate()` middleware → 422 `VALIDATION_FAILED`
- [x] Rate limiting on auth/OTP routes (NFR-07)
- [ ] Idempotency-Key store for money/document POSTs
- [x] Cursor pagination helper (`?limit&cursor`, `nextCursor`)
- [ ] OpenAPI generation from Zod
- [ ] Route-coverage test: every route has `requirePermission` or `public()`

### 1.2 Database & RLS
- [x] Identity/tenancy tables: users, user_sessions, otp_codes, tenants, branches, tenant_members, invitations, trial_registry
- [x] Access tables: permissions, roles, role_permissions, role_field_access, tenant_role_settings
- [x] Config tables: industry_templates, tenant_terms, field_definitions, form_layouts
- [x] Subscription tables: modules, plans, plan_modules, prices, coupons, subscriptions, subscription_items, scheduled_changes, tenant_entitlements, usage_counters, credit_balances
- [x] Events/audit: outbox_events, processed_events, audit_log, notification_log
- [x] RLS migration: `app_user` role, `app_tenant()` helper, ENABLE + FORCE RLS + policy on every tenant table
- [x] Test that fails if any table with `tenant_id` lacks forced RLS
- [ ] Platform billing tables (platform_invoices, lines, credit notes, payments, mandates, webhook_events, dunning_attempts, document_sequences) — Phase 3
- [ ] Vendor/partner tables — Phase 3

### 1.3 Seed data
- [x] Module catalogue (12 v1 modules + catalogue master; dependencies; free-tier flags)
- [x] Plans: Free, Starter, Growth, Business Pro, Enterprise with limits; prices (monthly/yearly)
- [x] Permission catalogue (module.resource.action) from code
- [x] 21 tenant roles (4 core + 17 module roles) with required modules and permission sets; 7 platform/partner/vendor roles
- [x] 6 industry templates: salon, retail, pharmacy, gym, coaching/school, service company (modules, terms, custom fields, dashboard widgets, catalogue seed)

### 1.4 Identity & auth (PLT-03..09)
- [x] `POST /auth/otp/send`, `/auth/otp/verify` (hashed codes, 5-min expiry, 3 attempts, verification token)
- [x] `POST /auth/signup` → one `createTenant` service (user, tenant, default branch, trialing subscription, Owner membership, trial registry, outbox `tenant.created`)
- [x] Duplicate-trial check by mobile/email/GSTIN hash (ONB-03)
- [x] `POST /auth/login` (email or mobile + password, or mobile OTP), lockout after 5 failures for 15 min
- [x] `POST /auth/refresh` (HttpOnly cookie, rotation, family revoke on reuse), `/auth/logout`
- [x] `POST /auth/switch-tenant`, `GET /me` (user, memberships, tenant, role, permissions, entitlements, terms)
- [x] Email verification link (`/auth/email/verify`) — link logged in dev
- [x] Password reset via OTP (`/auth/password/reset`)
- [ ] MFA (OTP) for Owner/Admin (P1)
- [ ] Owner can sign out all sessions of a user (P1)

### 1.5 Access control (ROL-01..07)
- [x] `requirePermission(key)`: entitlement (active / read_only / inactive) → role permission → scope on `req.ctx`
- [x] Visible roles = core + module roles whose required modules are active (LLD §4.4)
- [x] `GET /roles`, `GET /permissions` (filtered to active modules)
- [x] Scope filter helper (`own/team/branch/all`) used by module repos — `team` behaves as `own` until HR reporting lines exist
- [x] Field-level access serializer (salary, cost price, bank details) — used for item cost price; salary/bank arrive with HR
- [ ] Custom roles: clone & edit (paid, P1)

### 1.6 Tenancy admin
- [x] `GET/PATCH /tenant` (profile, GSTIN, state code, time zone, FY start)
- [x] `GET/POST/PATCH /branches` (Free plan = 1 branch limit)
- [x] `GET /members`, `POST /invitations`, `POST /invitations/:token/accept`, `PATCH /members/:id` (user-limit check)
- [x] `GET /audit-log`; audit writes for login, role change, member change
- [ ] Data export job (`POST /exports`) — NFR-19
- [ ] Account closure with 30-day soft delete (`POST /tenant/close`)

### 1.7 Configuration engine (CFG-01..07)
- [x] Apply industry template on `tenant.created` (terms, field definitions, catalogue seed, template version)
- [x] `GET/PUT /config/terms`, `GET/POST/PATCH /config/fields`
- [x] Custom field validator (typed JSONB, unknown keys rejected, required enforced)
- [ ] Form layouts (P1)
- [ ] Template upgrade that never overwrites tenant edits (P1)

### 1.8 Subscription & entitlements (SUB-01..06, TRL-01..05)
- [x] State machine table (trialing/active/past_due/free/closed/purged) with `INVALID_TRANSITION`
- [x] Entitlement resolver (trial = all modules; free = free modules; `everUsed` → read_only)
- [x] `GET /billing/plans`, `GET /billing/subscription`
- [x] Trial-expiry job (hourly) → Free; paid modules read-only (unit-tested; not yet run against an expired tenant)
- [x] Limit enforcement helpers (users, records, invoices/month with atomic usage counter)
- [ ] Trial reminder job (day 0, 2–3, 7/3/1 left, expiry, +3/+7) with notification_log de-dup
- [ ] "Choose active users" screen when over Free user limit

### 1.9 Free-core business modules
- [x] Product & Service Catalogue (CAT-01, CAT-02): items, categories, units, GST rate, HSN/SAC — plus template starter catalogue, archive-on-delete, cost price hidden by role
- [x] CRM basic (CRM-01..04): contacts, leads, convert, timeline notes/calls/follow-ups, CSV import with duplicate detection
- [x] Billing basic (BIL-01..04): GST invoice (CGST/SGST vs IGST), FY number series via `document_sequences`, PDF/print, receipts, paid/partial/unpaid, immutable after issue — numbering via `tenant_sequences`; print/PDF via browser (A4, 80/58 mm); public share link; cancel with reason
- [x] Quotations (SAL-01) → convert to invoice
- [x] Expenses (FIN-01)
- [x] Tasks basic (TSK-01, TSK-02)
- [x] Calendar & appointments basic (BKG-01, BKG-02, BKG-08) with no double-booking — enforced by a Postgres exclusion constraint
- [x] Home dashboard (RPT-01) with widgets per enabled module
- [x] In-app notifications (AUT-01) — assignments, follow-ups, comments, task completion

### 1.10 Frontend foundation
- [x] API client with access token in memory + silent refresh
- [x] Auth pages: signup (6 fields + mobile OTP step), login (password / OTP), forgot password
- [x] App shell: sidebar built from entitlements, terminology applied, trial banner, email-unverified banner
- [x] Onboarding checklist (logo, first customer, first item, first invoice, invite team)
- [x] Settings: business profile, branches, team & invitations, roles view, terminology, custom fields
- [x] Plans page (read-only pricing)
- [x] Placeholder screen per module (locked / coming-soon) until 1.9 lands
- [x] Module screens for 1.9

---

### 1.11 Verified so far
- 30-step API smoke run: OTP, signup, single-use verification token, template application, 21 roles on trial, GSTIN/state validation, invite → accept → staff login, staff 403s, refresh rotation, lockout path, subscription limits
- 15 Vitest tests: RLS enabled+forced on every tenant table, cross-tenant read/write blocked by Postgres, platform tables closed to app_user, state machine, entitlement resolver, role grants
- Browser: signup → OTP → dashboard (gym terminology), roles page, mobile layout

### Fixed 2026-10-22
- [x] Network blocked Postgres port 5432 → API could not reach Neon. Switched to Neon's serverless driver (WebSockets on 443) via `@prisma/adapter-neon`; added `prisma/migrate.ts` so migrations also run over 443
- [x] DB outage returned a vague 500 → now 503 `PROVIDER_UNAVAILABLE`; health endpoint reports DB state; worker backs off instead of logging every second
- [x] Frontend treated server outage as "signed out" → reconnect screen with auto-retry, session kept
- [x] Concurrent refresh (two tabs) revoked all sessions → 30 s reuse grace window

### 1.12 Verified for Phase 1.9 (2026-10-22)
- 45-check API run (twice in a row): catalogue + template seed, SKU/GST validation, custom fields, duplicate detection, draft → issue with FY number, CGST/SGST and IGST maths, immutability, partial/full payment and receipts, cancel rules, public share link, quotation → invoice, lead → customer, timeline, CSV import, expenses, tasks/subtasks/comments/history, double-booking blocked, appointment → invoice, dashboard figures, staff scope (own invoices only, no cost price, no cancel/delete)
- 20 Vitest tests incl. GST rounding and financial-year boundaries
- Browser: catalogue add-item flow, every module screen renders, shared invoice layout checked (pane hidden for the rest of the click-through)

### Known issues
- [ ] Latency: every query round-trips to Neon us-east-2; signup takes ~8 s and the dashboard ~15–20 s from India. Host the API in the same region as the database (or move the Neon project closer) and batch the /me queries.
- [ ] Rotate the Neon database password (it was shared in chat) and keep it only in backend/.env.
- [ ] `npm audit` (2026-10-24): next 16.4.0 has critical advisories (fixed in 16.4.3) and body-parser 2.0–2.3 a high one — upgrade both before go-live

## Platform v2 — Console + ERP (design v2, 2026-10-23)
Design: `Platform design - Multi level flow, super admin, verder, partner.docx` (v2; v1 kept as `... (v1 backup 22 Oct).docx`). One app, two workspaces: **Console** (`/console`, AHEAD team) and **Business ERP** (`/app`, tenants). Partner white-label and vendor payouts move to "Later". Each step starts only when the previous step's tests are green.

### Step 1 — Data model and settings (R1, R2, R4) — done 2026-10-23
- [x] R1: `tenant_source` `admin` → `sales`; `tenants.onboarding_type` (trial / direct_paid) + `is_internal`
- [x] R1: `tenant_acquisitions` (platform table, never visible to tenants): who brought the tenant in, method, referral/coupon code, locked at signup; existing tenants backfilled as self-signup
- [x] R1: `createTenant()` takes an acquisition (default self-signup) and derives `source`; trial registry only for trial, non-internal tenants; signup records the coupon code
- [x] R1: `changeAcquisition()` for the Super Admin — reason required, updates `source`, audited (screen comes in Step 3)
- [x] R2: `config_values` table + definitions in `contracts/settings.ts` + `getSetting / setSetting / resetSetting / listSettings` (validated, versioned, audited, 60 s cache; an invalid stored value falls back to the default)
- [x] R2: trial days, trial plan, trial limits and grace days (monthly/yearly) moved from `.env` / constants to settings
- [x] R4: seed no longer overwrites plans, plan modules, prices or free-tier flags (`syncCatalog`); `npm run db:seed -- --reset-commercials` restores the code defaults in dev
- [x] R4: runtime reads the commercial catalogue from the DB (`getCatalog`): `/billing/plans`, Free limits, free-tier modules
- [x] Tests (30/30 green): seed keeps DB edits, reset restores defaults, settings fallback/validation/versioning, acquisition rules and lock, internal tenant, new platform tables closed to `app_user`
- Note: `direct_paid` is stored but not used yet — the `incomplete` subscription state arrives in Step 4

### Step 2 — R3-lite: Console workspace — done 2026-10-23
- [x] `platform_members` (user, Console role, `reports_to`, status) — platform table, closed to `app_user`
- [x] 18 `platform.*` permissions; 7 Console roles: Super Admin, Operations / Support, Support Agent, Finance, Sales Manager (`team`), Sales Executive (`own`), Vendor (`own`). Console keys only go to Console roles and vice versa (`expandGrants`)
- [x] Token and session carry the workspace (`ws = tenant | console`); old tokens count as tenant; refresh keeps the workspace and drops a removed Console member back to tenant
- [x] `consoleAuth` + `requirePlatformPermission` + `consoleTx`; scope filter over clients by `tenant_acquisitions` (own / team via reporting tree / all)
- [x] `POST /auth/switch-console`; login lands Console-only users in the Console; `/me` returns `workspace` + `console` (role, permissions)
- [x] `GET /console/me`, `GET /console/dashboard` (client counts in scope)
- [x] Bootstrap: `npm run console:member -- --email … --role super_admin [--name --mobile] [--reports-to …] [--deactivate]` (new users have no password: mobile OTP or "Forgot password")
- [x] Frontend: `/console` shell (sidebar by permission, Step 3 items marked "Soon"), dashboard, workspace switcher in both shells, login and `/app` route Console sessions to `/console`
- [x] Tests (38/38 green): role separation, route guards, old-token default, tenant token refused by Console, team/own/all scope; checked in the browser (switch in and out) and via API (login → Console → refresh → logout)
- Dev data: test Super Admin `console-admin@example.test` (mobile `+919000000011`, OTP login)

### Step 3 — Console screens — done 2026-10-23
- [x] Clients list (search by name/GSTIN, status filter, plan, source, users) and detail (subscription, owner, source, usage counts, modules, history) — account metadata only, scoped own / team / all; out-of-scope ids return 404
- [x] Extra days: extend a trial (trialing) or payment grace (past_due), 1–30 days with a reason; `grace_periods` table + audit
- [x] Change who brought a client in (reason required) from the detail screen
- [x] Plans & prices: edit plan name, tagline, visibility, limits and modules (re-computes entitlements of clients on that plan); versioned price edits; coupons (create, end now)
- [x] Settings screen: trial days/plan/limits, grace days, discount limit per role (`sales.discount_limits`), announcement banner (`announcement.banner`, shown on top of every client workspace via `/me`)
- [x] Console users: add (existing account by email, or new with name + mobile), change role and manager, deactivate/reactivate; roles overview. Rules: only a Super Admin grants or changes Super Admin, nobody edits their own role/status, the last Super Admin stays, no reporting loops
- [x] Platform audit log screen (tenant_id null entries) with filters
- [x] Tests (46/46 green): extensions, scope 404, versioned prices, plan module validation, coupons, Console-user rules; screens checked in the browser
- Not yet: MRR on the dashboard and payments screens (need Step 4); free-tier flags per module are not editable from the UI yet

### Step 4a — Paid onboarding from the Console — done 2026-10-24
- [x] `incomplete` tenant/subscription status: workspace exists, every module closed until the first payment; `incomplete → active` on payment, `incomplete → closed` when unpaid
- [x] Platform tables (closed to `app_user`): `platform_orders`, `platform_payments`, `platform_invoices`, `platform_sequences`
- [x] Quote: plan + add-on modules + extra users for the cycle from the active price list, sales discount, coupon, GST (CGST+SGST in AHEAD's state, else IGST), discount split pro-rata across lines
- [x] New client (Console → Clients → New client): owner by email (existing account or new, OTP login), acquisition = the sales user / vendor, no trial registry, live price panel
- [x] Discount above the role limit (`sales.discount_limits`) → order needs approval (`platform.discount.approve`); the creator cannot approve their own discount
- [x] Record offline payment (bank transfer, UPI, cheque, cash; full amount only) → AHEAD GST invoice `AHD/26-27/000001` numbered at payment, subscription active with cycle, add-ons and extra users (extra users raise the user limit), coupon redeemed
- [x] Console screens: New client, Payments (orders by status), order detail (approve, record payment, cancel), printable AHEAD invoice; orders on the client detail; dashboard tiles for awaiting payment / approvals
- [x] Settings: AHEAD billing details (legal name, GSTIN, state, address, SAC, GST rate) — invoicing is blocked until the state is set; unpaid order lapse days
- [x] Client ERP shows "workspace ready, modules open after payment" while `incomplete`
- [x] Tests (6 new, suite green): allocation, seller state required, approval rules, full-amount rule, intra/inter-state GST, invoice numbering, entitlements after payment
- To do before go-live: set AHEAD's real billing details in Console → Settings; CA to confirm SAC and rate

### Step 4b — Online payments and renewals — done 2026-10-24
- [x] Gateway adapter: Razorpay payment links (`RAZORPAY_KEY_ID/SECRET/WEBHOOK_SECRET`); without keys, development uses a built-in test gateway (`/pay/test/<link>` page with a Pay button)
- [x] `POST /api/v1/webhooks/razorpay`: HMAC-SHA256 signature on the raw body, stored once by event id (`webhook_events`), paid link → `capturePayment()`; wrong amount / unknown link kept as "needs attention" (200, no retry loop)
- [x] Console: send / resend payment link (owner gets email + SMS, link copied); client Plan & billing page shows what is due with a Pay button
- [x] Hourly jobs (worker): unpaid orders lapse (never-paid client → `closed`), renewal order 7 days before the period ends at current prices with a link and reminders at 7/3/1 days, dunning (period over → `past_due` + grace, grace over → Free), trial reminders at 7/3/1 days — every message de-duplicated in `notification_log`
- [x] A renewal paid on time extends from the old period end (`renewal_succeeded`)
- [x] Credit notes `CN/26-27/000001`: full refund of an AHEAD invoice, optional "end the paid plan now" (→ Free); shown on the invoice
- [x] Tests (9 new; suite 61/61 green): signatures, Razorpay parsing, webhook once-only and forged/wrong-amount cases, lapse, renewal + reminders + period extension, dunning, trial reminders, credit notes
- To do before go-live: add Razorpay keys, register the webhook (event `payment_link.paid`), and set AHEAD billing details; auto-debit (UPI AutoPay / e-mandate) is not built yet — renewals are paid by link

### Step 5 — Support and reports
- [ ] Support access with tenant consent (time-limited "Login as", banner, audit)
- [ ] Vendor / salesperson commission report (manual payout)

### Public website — homepage + SEO — done 2026-10-24
- [x] New homepage (`app/page.tsx`, `components/marketing/`): hero, product mockups drawn in HTML/SVG, getting-started steps, feature rows (CRM, GST billing, bookings, stock), AI assistant, before/after by industry, security, FAQ, module list with "Soon" badges for modules not built yet
- [x] SEO: metadata + Open Graph/Twitter in the root layout, canonical URLs, generated OG/Twitter/Apple images, `icon.svg`, `robots.txt`, `sitemap.xml`, web manifest, JSON-LD (Organization, WebSite, SoftwareApplication, FAQPage), titles for /login and /signup
- [x] Private areas (`/app`, `/console`, `/d`, `/pay`, `/print`, `/invite`, …) blocked in robots.txt and sent `X-Robots-Tag: noindex`
- To do before go-live: set `NEXT_PUBLIC_SITE_URL` to the production domain (canonical, sitemap and OG URLs use it); move a module's badge from "Soon" to live in `components/marketing/content.ts` as each ships; add Privacy and Terms pages and link them in the footer

### Later (design v2 §13)
- [ ] White-label partner (panel, domains, price book, monthly billing), vendor KYC + payouts, full theming, dedicated-DB tier, visual workflow builder

## Product v3 — enterprise UX and flows (gap review, 2026-10-24)
Review against Zoho Books/One, Odoo, ERPNext, NetSuite, Tally/Vyapar/Marg: today's screens are forms without a journey. This section closes that gap. UI language is **global English only** (no Hindi or other locales); industry terminology still changes per template. Each phase starts with a short wireframe + case list that Rahul approves before code.

### Phase 0 — Design system and validation (building blocks done 2026-10-24)
Built: `backend/src/contracts/validation.ts` (dependency-free field rules, imported by the web app as `@contracts/validation` — `turbopack.root` is the repo root), `kernel/zodRules.ts` (same rules as Zod), `lib/use-form.ts`, `lib/use-unsaved.ts`, `components/form.tsx` (Field states, ErrorSummary, DiscardChangesDialog), `components/editable-section.tsx` (view → edit → confirm with diff + reason), `components/data-list.tsx`, `components/page-states.tsx`. Applied to: Settings › Business (both cards, version check, reason in audit), CRM contact form (live duplicate check via `GET /contacts/duplicates`, email typo hint), Invoices + Quotations lists. API now uses the shared rules for business profile, branches, CRM, invoices (buyer + lines), catalogue HSN/SAC, signup and Console new client. Tests: `validation.test.ts` (10); suite 71/71.
- [x] View-first pattern with confirm-with-diff + reason for sensitive fields (Settings › Business; `tenant.update` audit keeps before/after + reason; stale `expectedUpdatedAt` → 409)
- [~] Unsaved-changes guard (link clicks + reload) and Discard dialog — on Business settings and the contact form; other forms still to move over. Undo toast not built
- [~] List-page component: search, filter chips, preset tabs, personal saved views (this browser), column chooser, density, selection + bulk bar, CSV export of all filtered rows (≤ 5,000), cursor pages 25/50/100, keyboard + Ctrl+click, cards on phones — on Invoices/Quotations. Sorting sorts the current page only (API has no sort yet); shared views (admin) need an API
- [~] Page states: first use, no results, loading skeleton (+ "Still loading…"), error with reference ID, no access, module locked, read-only banner — components exist; wired into the list component, other pages still to adopt. Breadcrumbs not built
- [x] Shared rules used by frontend and backend (one file, same messages)
- [ ] Idempotency-Key on money/document POSTs (API store not built yet)
- [~] Validation checklist — rules exist for all items below; applied to the forms listed above, the rest move over screen by screen:
  - Required fields marked; errors inline under the field, shown on blur and on submit, focus moves to the first error
  - Formats: mobile (+91, 10 digits, starts 6–9), email, GSTIN (pattern + checksum + state code matches the chosen state), PAN, TAN, IFSC, PIN code (6 digits), HSN (4/6/8) / SAC (6), UPI ID, URL
  - Lengths and ranges: names 2–100, notes max length, quantity > 0, discount 0–100 % or ≤ line amount, money in paise with 2 decimals, GST rate from the allowed list
  - Dates: valid calendar dates, no future date where it makes no sense (invoice date, DOB), end ≥ start, inside an open financial year / unlocked period
  - Uniqueness checked live (SKU, invoice number, email/mobile of a member) with a debounced API call
  - Cross-field rules (IGST vs CGST+SGST from states, password confirm, "same as billing address")
  - Normalise input: trim spaces, upper-case GSTIN/PAN/IFSC, strip spaces from mobile, Indian number format (lakh/crore) for display
  - Files: type and size limits, image dimensions for logos, CSV header check with a row-level error report
  - Submit disabled while saving, no double submit (Idempotency-Key on money/document POSTs), server 422 fields mapped back onto the form
  - Password strength meter and rules; OTP: numeric 6 digits, resend timer, attempts left

### Phase 1 — Signup, workspace provisioning, setup wizard (built 2026-10-24)
Built: `contracts/workspace.ts` (industries, goals, preferences + defaults, prefix/brand-colour rules, setup + provisioning types, shared with the web app), migration `20261024020000_workspace_setup` (`tenants.profile`, `tenants.preferences`), `modules/tenancy/workspace.ts`; routes `GET /public/industries` (templates + 23 industries), `GET /public/signup/check`, `GET /public/coupons/:code`, `POST /auth/signup` v2, `POST /auth/businesses`, `GET /tenant/workspace`, `PATCH /tenant/profile`, `PUT /tenant/preferences/:section`, `POST /tenant/sequences/invoice-start`, `PATCH /tenant/setup`, `GET /tenant/provisioning`, `POST /tenant/provisioning/retry`. Web: `(onboard)/signup` (5 steps), `/app/welcome`, `/app/setup` (7 steps), dashboard "Finish setting up" card, `WorkspaceBranding` (brand colour, font, density, default theme), sidebar ordered by the owner's picks. Effects: invoice/quotation/receipt prefixes + start number used by `allocateNumber`, default terms on new documents, seller phone/email/bank/UPI frozen on issue and printed with a real UPI QR (`qrcode` 1.5.4). Tests: `workspace.test.ts` (10). Checked in the browser end to end: signup (errors, typo hint, live checks, resume draft, wrong OTP) → loading screen → every wizard step → invoice `GS/26-27/0101` with QR.
Not built yet: Google sign-up (needs an OAuth client), GSTIN "Fetch details" (needs a GSP API — the state is taken from the GSTIN digits), signature upload and moving logos to file storage, sample bookings (sample data is customers only), Excel (.xlsx) import (CSV only), opening-dues import, invoice list bulk "Send reminder" / "Print" (needs a messaging provider), applying the Taxes choices to item forms and invoice titles (stored only), invoice templates other than the current layout (choice stored), "signups paused" switch.
- Matched to the wireframes (2026-10-24, second pass): app palette and radii from the canvas (light grey page, white cards with borders, #2450D8 default accent, 8 px fields/buttons, 12 px cards) in `globals.css` + base `components/ui/*`; list page header with Import/Export/New, tab counts (`GET /invoices|quotations/counts`), "Showing x–y of N" (`withTotal`), Columns/Density buttons, "Select all N matching", Overdue/Partial/Unpaid pills, overdue filter; green border on valid fields; "View history" link; signup rail 400/300 px, Google button (shown, disabled until OAuth), "Show" toggle, GSTIN "Fetch details" (disabled until a GSP API) with the derived state/PAN/holder box, inline Verify button, product-updates opt-in stored in the profile; wizard: logo upload (cropped to 320 px WebP data URL on the tenant until file storage), data step with 4-step import (map columns, preview, Skip/Update existing) for customers and products (`POST /items/import`), sample data (`POST/DELETE /tenant/sample-data`, migration `20261024030000_sample_data`), "x of 7 done · about n minutes", done card; module-locked page state and read-only banner wired in
- Note: signup runs ~25 sequential queries; with the database in us-east-2 it takes 10–20 s, so its transaction timeout is 30 s and new tenants create entitlements in one INSERT
- [x] Multi-step signup with progress: Account → Business → What you want to manage → Verify
  - Account: name, email, mobile, password (strength meter), Google sign-up, real Terms checkbox, OTP resend timer, email OTP option
  - Business: business name, business type (Proprietor / Partnership / LLP / Pvt Ltd / Public Ltd / Trust-NGO), GST registered? → GSTIN auto-fill (legal name, state) when the lookup API is available, composition scheme, state/city, team size, number of branches
  - Industry as icon cards with search, then sub-industry (see Industry coverage below)
  - Goals (billing, stock, bookings, staff, CRM, accounts…) pre-select recommended modules, user can change them
  - Cases: mobile/email already registered → sign in or add a new business; duplicate trial → clear message + paid path; invited user → join, not create; abandoned signup → draft resumes
- [x] Workspace provisioning screen: full-screen animation whose steps tick from real backend progress (business created → template applied → roles created → starter catalogue → dashboard ready); provisioning becomes an async job with a status endpoint; Retry on failure
- [x] Setup wizard after the first load (skippable, resumable, progress saved) — see "Not built yet" above:
  - Business profile: logo upload, address, PAN, financial year
  - Documents: number prefixes per document, invoice template with live preview, terms, signature, bank details + UPI QR
  - Taxes: GST settings, reverse charge (TDS/TCS later)
  - Bring data in: customers and items from CSV/Excel, opening balances, or "try with sample data" (removable)
  - Invite team with roles
  - Branding: brand colour, theme, font
  - Finish screen with "Create your first invoice"

### Phase 2 — Settings, My account, security (built 2026-10-25, matched to wireframes X1–X6, A1–A4)
Built: migration `20261025000000_account_security` (`user_mfa`, `user_trusted_devices`, `user_password_history`, `sign_in_events`, `users.preferences`, `users.password_changed_at`, OTP purposes email/mobile change + close account); `contracts/account.ts` (personal preferences, security policy, password policy check, IPv4 CIDR, notification events/templates, field-access list, roles matrix rules); `modules/account/*` (RFC 6238 TOTP with AES-256-GCM secret, backup codes, trusted devices, sign-in log, `/api/v1/account/*`); login: two-step challenge (`POST /auth/mfa/verify`, 5 wrong codes → 15 min lock), expired password (`POST /auth/password/expired`), failed-password counter now survives the rollback (the 5-attempt lockout didn't work before); every request: strictest session length and inactivity sign-out, IP allowlist, two-step required after the grace period (Console users always); `tenancy/security.ts` (policy, team sessions, sign-in history + CSV), `tenancy/roles.ts` (clone/edit/delete custom roles, field access), `tenancy/messages.ts` (templates, test send, invoice-issued and payment-received emails via the outbox, daily cap), `tenancy/data.ts` (import history, CSV/ZIP/XLSX export, close + reopen), `kernel/zip.ts`, number series with the real "last issued" (`GET/PUT /tenant/sequences`). Web: `components/settings-shell.tsx` (grouped menu, search, deep-link highlight, attention dots, phone list page), Settings pages Organization, Branding, Documents, Taxes, Payments, Users & security, Roles & permissions, Notifications, Data; Team gets "Reset two-step…"; My account (Profile & preferences, Security, My notifications, My businesses, Turn on two-step); sign-in code / backup code / lost phone / expired password screens; grace banner and forced setup. Print options (HSN summary, signatory, paper) are frozen on issued invoices. Tests: `account.test.ts` (14); 51-call API smoke run and a browser pass over every screen.
Not built yet / differs from the wireframes: photo upload and signature image (need file storage); export is downloaded straight away instead of "prepared in the background, link emailed" (no file storage or mail provider yet); import error file isn't kept after the import; opening-dues import; SMS/WhatsApp (need providers — shown disabled); location ("Mumbai, IN") next to sessions (needs an IP lookup service — IP only); backups card has no retention number (confirm the Neon plan); Branches and Audit log stay in the Settings menu next to the wireframe items.
- [x] Settings with a grouped sidebar and search:
  - Organization: profile, branches, financial year, currency, time zone, date and number format
  - Branding & appearance: logo, brand colour, light/dark/system theme, font, density, sidebar style
  - Documents: number series per document, templates + preview, terms, signature, print size (A4 / 80 mm / 58 mm)
  - Taxes: GST, composition, reverse charge, HSN rules; later TDS/TCS, e-invoice, e-way bill
  - Payments: bank accounts, UPI QR, payment modes, the tenant's own Razorpay keys
  - Users & security: enforce MFA (all users / admins / per role), password policy (length, expiry, reuse), session timeout, IP allowlist, active sessions, sign out everywhere, login history
  - Roles & permissions: custom roles (clone + edit), permission matrix grid, field-level access
  - Notifications: email/SMS/WhatsApp templates, which event notifies whom
  - Customization: custom fields, form layouts, terminology, pipeline stages, statuses
  - Data: import/export, backup download, close account (30-day soft delete)
  - Subscription: plan, usage meters, AHEAD invoices, upgrade/downgrade, add-ons
  - Integrations: API keys, webhooks (later)
- [x] My account (every user): profile + photo (photo needs file storage), change password, MFA (authenticator app + backup codes; SMS-code fallback not built — needs an SMS provider), personal theme/font/density, notification preferences, devices and sessions

### Phase 3 — Dashboard v2 with module tabs (built 2026-10-25, matched to wireframes 5.1–5.8)
Built: `contracts/dashboard.ts` (tabs, widgets per tab, ranges, comparison period, chart buckets, GSTR-3B date, per-person layout), `modules/reports/dashboard.ts` (one handler per tab; every figure follows the module's data scope and the branch filter; each widget runs in its own tenant transaction so they load side by side and a failing one returns an error without blocking the rest), routes `GET /dashboard/config`, `GET /dashboard/tab/:tab`, `PUT /dashboard/preferences` (saved per person and business in `users.preferences.dashboard`), `GET /search` (Ctrl+K), `POST /invoices/remind` (Invoice overdue template, daily cap, scope). Web: `components/dashboard/*` (header with range / compare / branch / + New, tabs, Customize with reorder, hide, widgets from other tabs, hide a tab, reset), `components/command-palette.tsx`. Tests: `dashboard.test.ts` (9); browser pass on every tab with seeded data, the staff view and phone width.
Not built / differs: Inventory, HR and Support tabs (modules not built); approvals in "Needs you" (no approval requests exist yet); gaps in today's schedule; staff working hours (9 h a day until schedules exist); bank balances, GST input credit and a full P&L (need Bank and Purchases); dues by age counts from the invoice date. Tab load is about 2–4 s here because each transaction makes several round trips to the database in us-east-2.
- [x] Tabs: **Overview** + one tab per module the user can see (Sales, Billing, CRM, Bookings, Inventory, Finance, HR, Tasks, Support, Reports); a tab shows only when the module is entitled and the role has its dashboard permission; read-only modules show their tab with an upgrade note; last opened tab remembered per user
- [x] One date-range filter shared by all tabs, with comparison to the previous period; branch filter for multi-branch tenants
- [x] Overview: today's money (sales, collections, dues), approvals/to-do inbox, today's appointments/tasks, recent activity, quick "+ New"
- [x] Module tabs (each loads its own widgets lazily):
  - Sales: quotations sent / won, conversion, top customers, pending orders
  - Billing: invoiced vs collected, dues ageing, overdue list, payment modes split
  - CRM: new leads, lead sources, pipeline by stage, follow-ups due, conversion
  - Bookings: today/this week, no-shows, utilisation by staff/resource
  - Inventory: stock value, low stock / reorder, expiring batches, fast/slow movers
  - Finance: expenses by category, cash and bank balance, P&L snapshot, GST payable
  - HR: headcount, today's attendance, on leave, payroll due, birthdays
  - Tasks: open/overdue by person, completed this week
  - Support: open tickets, SLA breaches, average resolution time
- [x] Role-aware defaults (Owner sees money first, staff see their own work); widgets can be hidden/reordered per user
- [x] Global search / Ctrl+K command palette (records, pages, actions)

### Phase 4 — Console: one simple app for the AHEAD team, vendors and partners (reworked 2026-10-27)
The first Phase 4 build (11 pages, MRR/ARR, History, Security, before → after + reason on every edit) was rejected as confusing on 26 Oct. Reworked to a minimal Console with three panels — each person sees only their own menu:
- **AHEAD team:** Home (to-do list, plain numbers, 6-month income), Clients, Leads, Payments, Partners, Settings (Plans & prices · Rules & billing details · Team).
- **Vendor:** Home (own clients, what they paid this month, referral link + code), My clients, Payments.
- **Partner:** Home (clients, this month's bill), Clients, Billing, Team.

Built: migrations `20261026000000_console_v2` (prospects, follow-ups, notes) and `20261026120000_console_partners` (`partners`; `platform_members.partner_id` + `referral_code`; FK `tenants.partner_id`). Partner people are Console members linked to a partner; `scopedTenantFilter` limits every client query to that partner. Partner Admin / Partner Staff roles; vendors can add clients and see their payments. Backend `modules/console/{insights,sales,client360,partners,referral}.ts`; routes `/home`, `/referral`, `/tenants/:id/{summary,health,users,timeline,notes,convert,plan}`, `/partner-clients`, `/partners`, `/billing`, prospects and follow-ups. Partner clients go live at once (billed by the partner, no AHEAD period) and the renewal / dunning jobs skip them. Signup accepts `?ref=CODE` (kept 30 days) and credits the vendor or salesperson. Removed: History, Security (allowed networks, Console session rules), Revenue and Audit log pages, and reasons on normal edits — a short note stays only on extending a trial, changing who brought a client in, cancelling an order and refunds. Web: `components/console/kit.tsx` (page, panels, stats, status chips, empty states, steps), one-page client view, 3-step Add client wizard (Business → Owner → Plan; payment link sent automatically, or live at once for partners), view-first Plans, Rules and Team; My account inside the Console; login takes vendors and partners straight to their panel. Tests: `consoleStep4.test.ts` (12, incl. partner isolation, partner bill, billing jobs, referral codes, role-aware Home); full backend suite passing; browser pass as Super Admin, partner admin and vendor, and at phone width.
Not built / later: the monthly partner invoice run (the bill is a live total; AHEAD sends the invoice by hand), partner branding and domains, vendor commission ledger and payouts, "Change plan" for a client paying AHEAD (pro-rated), @mentions in notes, a price change start date.
- [x] View-first everywhere; plain saves (no reason dialogs); audit kept in the background
- [x] One-page client view: plan & payments, activity & notes, owner, next step, setup & usage, users (counts only — no business data)
- [x] Home with a to-do list and plain numbers (no MRR/ARR jargon)
- [x] Leads: prospects, calls, automatic follow-ups
- [x] Vendor panel with referral link/code and client onboarding
- [x] Partner panel: clients, plan changes, monthly bill, own team
- [x] Two-step required for Console users (setup screen inside the Console)

### Industry coverage (match the big ERPs)
Today: 6 templates (salon, retail, pharmacy, gym, coaching/school, service company). Each new industry = template (modules, terminology, custom fields, dashboard widgets, starter catalogue) + the industry-specific feature it needs; features in brackets need modules that do not exist yet.
- [ ] Retail & wholesale / distribution / FMCG (schemes, price lists, beat routes)
- [ ] Manufacturing (BOM, job work, production orders) — needs a Manufacturing module
- [ ] Restaurant / café / cloud kitchen (tables, KOT, recipes) — needs POS + KOT
- [ ] Hotel / homestay (rooms, check-in/out)
- [ ] Clinic / hospital / diagnostic lab (patients, prescriptions, reports)
- [ ] Pharmacy (batch, expiry, Schedule H) — template exists, batch/expiry arrive with Inventory
- [ ] Salon / spa, gym / fitness — templates exist
- [ ] School / coaching / training (students, fees, batches) — template exists, fee module needed
- [ ] Jewellery (weight, purity, making charges, old-gold exchange)
- [ ] Apparel / textile / footwear (size × colour variants)
- [ ] Electronics / mobile shop (IMEI/serial, warranty)
- [ ] Automobile dealer / service garage (vehicle, job card)
- [ ] Hardware / building materials, furniture, optical store
- [ ] Construction / real estate (projects, units, site expenses)
- [ ] Professional services: CA / legal / consulting, IT / agency (projects, timesheets, retainers)
- [ ] Field service / AMC / repairs (service tickets, visits, contracts)
- [ ] Logistics / transport (trips, vehicles, freight bills)
- [ ] Travel agency, event management
- [ ] Agriculture / agro inputs
- [ ] NGO / trust (donations, 80G receipts)

### External dependencies for this section
- [ ] File storage (S3 or Cloudflare R2) — logo, signature, imports
- [ ] SMS + email provider — real OTP and notifications
- [ ] GSTIN lookup API (GSP, paid) — signup auto-fill
- [ ] Google OAuth client — Google sign-in

## Phase 2 — Operations (weeks 5–8)
Exit gate: stock and accounts update from sales and purchases.
Can run in parallel once Platform v2 Step 2 is merged. From the Maglo reference, add: reporting manager + teams, permission matrix UI, Contact vs Lead (re-enquiry count), configurable pipeline stages, round-robin assignment, follow-up screen, quotation statuses + proforma, one shared list-page component.
- [ ] Sales orders, approvals, delivery challan, returns + credit notes (SAL-02..05)
- [ ] Billing advanced: dues & ageing, recurring billing, POS counter screen, tenant Razorpay links, reminders (BIL-05..09)
- [ ] Inventory: stock ledger, warehouses, GRN/dispatch, transfers/adjustments with approval, batch/serial/expiry + FEFO, reorder alerts, valuation (INV-01..07, 09)
- [ ] Purchasing: suppliers, purchase requests, POs, supplier bills, 3-way match (INV-08)
- [ ] Catalogue advanced: variants, barcode, bundles, batch attributes, price lists (CAT-03..07)
- [ ] Finance: chart of accounts, posting engine (only writer of ledgers), AR/AP, cash/bank book, P&L, BS, TB, cash flow, GST summary, period lock (FIN-02..09)
- [ ] HR: employees, attendance, leave, shifts, self-service, payroll run + payslips, statutory rule sets, sensitive-field protection (HR-01..08, 10)
- [ ] CRM advanced: tags/segments, pipeline Kanban, enquiry form, Customer 360 (CRM-05..08)

## Phase 3 — Growth + intelligence (weeks 9–11)
Exit gate: paid checkout, vendor commission and partner billing work end to end.
- [ ] Platform billing (payment links, webhook, platform invoices, offline payments and renewals move up to Platform v2 Step 4): checkout preview (proration, GST, dependencies), Razorpay order/mandate, webhook (HMAC, idempotent), platform invoice numbering, PDF, dunning, renewal job, downgrade at period end, cancel auto-renew, offline payments (PAY-01..12)
- [ ] Customer Service: tickets, SLA, complaints/warranty (SUP-01..03)
- [ ] Reports & Analytics: standard reports + export, dashboard builder, report builder (RPT-02..06)
- [ ] AI Business Assistant (Python FastAPI): permission-checked tools, code-computed totals, briefing, drafts, credit metering + hard limit (AI-01..09)
- [ ] Automation & Notifications: ready-made automations, rule builder, SMS/WhatsApp provider, run-time entitlement checks (AUT-02..06)
- [ ] Tasks advanced: recurring, templates, multi-step approvals (TSK-03..05)
- [ ] Bookings advanced: resources, public booking page, classes, memberships, reminders (BKG-03..07)
- [ ] Vendor program — moved: v1 is a Console role + referral code (Platform v2 Steps 2 and 5); KYC and payouts under "Later" (VND-01..09)
- [ ] White-label partners — moved to Platform v2 "Later" (WL-01..06)
- [ ] Super Admin console — moved to Platform v2 Steps 2–5 (ADM-01..08)
- [ ] Replace in-process poller with Redis + BullMQ; Redis caches

## Phase 4 — Hardware + hardening (weeks 12–13)
- [ ] USB barcode scanner (keyboard mode) on billing/POS/inventory screens (HW-01)
- [ ] A4 invoice + 80/58 mm receipt print layouts (HW-02)
- [ ] Device Bridge desktop app (ESC/POS, cash drawer, labels), device registry (HW-03, HW-04)
- [ ] Biometric attendance import (HW-05, HW-06)
- [ ] Tenant-isolation test suite across API/exports/jobs/AI (NFR-10)
- [ ] Permission matrix tests (role × route)
- [ ] E2E (Playwright): signup → trial → checkout → renewal failure → grace → Free → upgrade
- [ ] Load test (k6) for NFR-01..03; security review (OWASP), backups/restore drill
- [ ] Docker + GitHub Actions CI/CD, staging + production
