# Console and ERP as two products

Status: approved direction (23 Nov 2026), being built in phases. Owner: Rahul.

| Phase | State |
|---|---|
| 1. Licence in the ERP | Done: signed licences, `tenant_licences`, entitlements from the licence, provisioning API, closed-business screen |
| 2. console-api | Core done: own service and database, staff login with two-step, plans and coupons, businesses and subscriptions, licences issued and delivered through the outbox, team, system health, import from the ERP. Billing (orders, payments, invoices), partners admin, leads: next |
| 3. Flows rewired | Not started |
| 4. console-web | Not started |
| 5. Clean up | Not started |

## Why

AHEAD sells an ERP. AHEAD itself runs a Console to sell, bill and support it. Today both live in
one backend and one database, so the ERP cannot run without AHEAD's own tables (plans, partners,
platform invoices). The goal:

1. **Cloud**: AHEAD hosts the ERP for many businesses; the Console runs them.
2. **Enterprise / self-hosted** (later): a company runs the ERP on its own server with its own
   PostgreSQL. No Console there: a signed licence file switches modules on.

The same ERP code must serve both. So the ERP must only ever depend on **a licence** and a small
**provisioning API**, never on Console tables.

## The picture

```
                      ┌────────────────────────────────────┐
                      │ CONSOLE  (console-api + console-web)│
                      │ DB: ahead_console                   │
                      │ staff, partners, applications,      │
                      │ leads, plans, prices, coupons,      │
                      │ subscriptions, orders, payments,    │
                      │ platform invoices, licences, usage  │
                      └───────┬───────────────▲─────────────┘
       provisioning API       │               │  usage report (daily),
       + signed licences      │               │  signup, billing requests
                              ▼               │
                      ┌────────────────────────────────────┐
                      │ ERP  (backend + frontend)           │
                      │ DB: ahead_erp (one per deployment)  │
                      │ businesses, users, roles, every     │
                      │ module's data, licence copy, files  │
                      └────────────────────────────────────┘
```

## Rules

1. **Each side owns its database.** No query ever touches the other side's tables.
2. **The ERP never asks the Console on a user's request.** It reads its own copy of the licence.
   The Console tells the ERP when something changes; the ERP also re-checks daily.
3. **The Console never changes ERP data directly.** It calls the provisioning API.
4. **Two kinds of people, two logins.** ERP users (business owners and their teams) and Console
   users (AHEAD staff, partners) are separate accounts, separate tokens, separate sessions.
   Console staff must use two-step sign-in.
5. **Every call between the two is authenticated and replay-safe** (key + timestamp + HMAC).
6. **Failures never lose work.** Calls in either direction go through an outbox with retries.

## Licence

A licence is an Ed25519-signed JWT (`alg: EdDSA`). Only the Console holds the private key; the
ERP has the public key (`LICENCE_PUBLIC_KEY`), so a self-hosted ERP verifies a licence offline.

```jsonc
{
  "iss": "ahead-console", "typ": "ahead-licence", "v": 1,
  "sub": "<tenant id>",              // cloud: one business; self-hosted: "*" = whole install
  "dep": "<deployment id>",          // which ERP installation it is for
  "plan": { "key": "standard", "name": "Standard" },
  "status": "trialing | active | past_due | free | suspended | closed",
  "modules": { "sales": "full", "inventory": "full", "hr": "none", ... },  // full | basic | none
  "limits": { "users": 5, "branches": 1, "invoicesPerMonth": null, "customers": 10000, "storageMb": 5120 },
  "trialEndsAt": null, "periodEnd": "2027-11-23", "graceEndsAt": null,
  "iat": 1795400000, "exp": 1796600000  // cloud: 14 days, refreshed; self-hosted: contract end
}
```

What the ERP does with it:

- `full` / `basic`: the module is open at that tier.
- `none`: closed; **read-only if the business ever used it** (the ERP knows this, the Console doesn't).
- `status` `closed` / `suspended`: the whole workspace is read-only with one clear screen
  (owner: reopen / download data; others: ask the owner). No per-page "not in your plan".
- Expired licence: 7 more days with a banner, then read-only. A newer licence replaces it.

## Provisioning API (ERP side, called by the Console)

Base `/internal/v1`, header `Authorization: AHEAD-HMAC key=<id>, ts=<unix>, sig=<hex>`.

| Call | What it does |
|---|---|
| `POST /tenants` | Create a workspace: business details, owner (name, email, mobile), licence. Returns a one-use owner setup link. |
| `PUT /tenants/:id/licence` | Store a newer licence (ignored if older). |
| `POST /tenants/:id/owner-link` | New setup link for the owner (handover, lost access). |
| `GET /tenants/:id/overview` | Facts for Console's client page: members, last activity, usage, setup progress. |
| `GET /tenants?ids=` | Overviews for many businesses (lists, health). |
| `DELETE /tenants/:id` | Purge a closed workspace after the retention period. |

## Console API (called by the ERP)

Base `/provision/v1`, same signed header with the deployment's key.

| Call | What it does |
|---|---|
| `POST /signups` | Self-serve signup from the ERP site: checks trial abuse, records acquisition / referral, starts trial or free plan, returns the tenant id and licence. The ERP then creates the workspace. |
| `GET /licences?since=` | Daily safety net: every licence changed since a time. |
| `POST /usage` | Daily usage per business (users, invoices this month, customers, storage, last active). |
| `POST /billing/session` | The owner opened Plan & billing: returns the plan, invoices, and a payment link / plan-change quote. Shown inside the ERP; payment happens on Razorpay. |

## What moves where

| Console DB (`ahead_console`) | ERP DB (`ahead_erp`) |
|---|---|
| console users, MFA, sessions | users, sessions, OTP, MFA, trusted devices |
| partners, partner users, KYC files | businesses (tenants) with profile and preferences |
| applications, prospects, follow-ups, notes | members, invitations, roles, permissions, field access |
| modules catalogue, plans, prices, coupons, drafts | **licence copy** per business |
| subscriptions, items, scheduled changes, grace | every module's data |
| orders, payments, platform invoices, credit notes, webhooks | files, audit log, notifications, outbox |
| trial registry, acquisition, referral | usage counters (sent to Console daily) |
| licences issued, usage received, job runs | job runs |

## Phases

1. **Licence in the ERP** — licence format, signing keys, `tenant_licences`, entitlements read
   from the licence, the provisioning API. Old code paths keep working until phase 3.
2. **console-api** — new service and database; staff and partner accounts; catalogue, plans,
   subscriptions, billing, partners, applications, leads moved over; licences issued and pushed.
3. **Flows rewired** — signup, Console "add client", plan changes, renewals, closing and reopening,
   Plan & billing inside the ERP, usage reports. Closed-business screen.
4. **console-web** — the Console and partner portal as their own web app on their own address.
5. **Clean up** — Console tables and code removed from the ERP; fresh databases and seed data.
6. **Self-hosted ERP** (when the first enterprise asks) — licence file upload, install guide.

Each phase ends with type-checks, tests and a browser check, and the app still works.
