# Maglo CRM + Console — reference study for AHEAD ERP

Source: `D:\Rahul\maglo-service` and `D:\Rahul\console-service` (MakunaiGlobal), read on 2026-10-23.
Reference only — no code is copied. Sections 1–5 come from the backend code; section 6 is a walkthrough of the live int environment (`int-maglo-ui`, `int-console-service/docs`), browsed read-only. No customer names or phone numbers are recorded here.

> **Heads-up:** the Maglo UI shows much more than `maglo-service` contains — Accounts, Contacts, Products, Inventory, Orders, Quotation / Proforma / Invoice, Payments, Helpdesk, Reports and Triggers are served by other Makunai services that are not in these two repos. They are the most ERP-relevant part (see §6).

---

## 1. Big picture

```
                 ┌──────────────── console-service ────────────────┐
  Browser ──JWT──►  Orgs · Partners(tenants) · Users · Roles/Perms  │
                 │  Teams · Plans · Orders · Payments(Razorpay)    │
                 │  Entitlements · Grace · Wallet · Coupons        │
                 │  OAuth2 server · API keys · Sessions · Notifs   │
                 └───────▲───────────── gRPC (auth.proto) ─────────┘
                         │ ValidateToken, GetUserPermissions,
                         │ GetUserChildHierarchy, GetPartnerDetails…
   ┌─────────────────────┼──────────────────────┐
   │ maglo-service (CRM) │  holler / babbler     │  (other products, same pattern)
   │ Leads · Boards ·    │                       │
   │ Journeys · Workflows│                       │
   └─────────────────────┴───────────────────────┘
```

- **Console = control plane.** Owns identity, tenancy ("partner" = client company), RBAC, billing and which products a client may use.
- **Each product (Maglo, Holler, Babbler) = data plane.** Stores only `partner_id` / `user_id` integers and asks Console over **gRPC** for everything about people and permissions. No cross-DB foreign keys.
- Product switches live on Console: `PartnerMetaData.is_maglo_enabled / is_holler_enabled / is_babbler_enabled` + per-product trial expiry, mirrored on `User` so a user can be given one product but not another.

Stack (both): Python 3.11, FastAPI, SQLAlchemy 2 + Alembic, Postgres, Redis, Celery, `dependency-injector`, gRPC. Maglo adds Kafka (inbound leads), pandas/openpyxl (Excel import/export), boto3 (S3 files). Console adds Razorpay, ReportLab (PDF statements), Firebase (push), Mongo (API logs). Layout is per-component: `models / schema / repositories / services / controllers / tests`.

---

## 2. Console — the platform core

### 2.1 Tenancy
| Table | What it is |
|---|---|
| `console_organization` | Top group (`org_key`) above partners |
| `console_partners` | **The tenant.** Legal name, CIN, GST, `active_license` (seat count), `parent_id` (partner hierarchy / resellers), `partner_status`, `billing_cycle`, `is_internal` (Makunai's own staff tenant), `is_maglo_publisher` |
| `console_partner_meta_data` | Per-tenant product flags + trial expiries, timezone, business profile (type, years, revenue, #users), API key |
| `console_partner_config` | Key/JSON-value settings per tenant, with `history` (last N changes) |
| `console_addresses` | Billing/shipping addresses |
| `console_countries/states/cities` | Shared location master (also exposed over gRPC for products) |

Partner lifecycle in `partner/services.py`: `create_partner` → `onboard_partner` → `set_trial_expiry_time_and_allow_services` → `check_partner_free_trial_eligible` → `change_partner_status` / `toggle_partner_activation`.

### 2.2 Users, hierarchy, teams
- `console_users`: one row per person, belongs to one partner + one role; **`parent_id` = reporting manager** (org tree). Flags: staff/admin/internal/suspended, verified email/phone, per-product enabled, walkthrough completed.
- Hierarchy is used everywhere: gRPC `GetUserChildHierarchy`, `GetUserParentHierarchy`, `GetPartnerUserDetailsByHierarchy` — so a manager sees their subtree's leads.
- `console_team` (nested via `parent_team_id`) + `console_team_member` (user + **role inside the team**). There's a "strict hierarchy policy" endpoint for teams.
- Bulk user upload from Excel runs as a Celery task with a result endpoint and a downloadable reference template.
- `user-tracker`: agent availability status (online/away/custom) — used by lead assignment.
- `console_user_sessions`: device/IP, per-service sessions, force-logout (`/deactive-user-session`).

### 2.3 RBAC (worth copying closely)
- `console_permission`: `slug`, `category`, `display_text`, `is_internal` (internal-only permissions hidden from clients).
- `console_role`: `hierarchy` (int seniority), **`data_scope` = `ALL | SUBTREE | OWN`**, `base_role_id`, optional `partner_id` (custom role).
- `console_default_role_permission`: global template role→permissions.
- `console_partner_role_permission`: per-tenant override. `POST /partner_role/materialize` copies the default catalog into a tenant so it can be customised; new roles are placed `ABOVE`/`BELOW` a reference role; a role in use cannot be deleted.
- Products enforce with a FastAPI dependency `PermissionDependency("lead.view")` that fetches the user's permission slugs over gRPC (cached in Redis) and returns 403.

**Key idea:** *what* you can do = permission slugs; *which rows* you see = `data_scope` × user tree.

### 2.4 Commercials: plans → orders → payments → entitlements
| Table | Notes |
|---|---|
| `console_plans` | `service_name` (which product), `modules[]`, `limits` JSON (e.g. users, boards), price, discount %, currency, `duration`, `hierarchy` (for upgrade/downgrade ordering), `plan_type` `STANDARD`/`WALLET`, `is_free_trial`, one-time charge `otc_charge`, `tag` |
| `console_coupons` | % discount, valid date range, list of plans |
| `console_orders` | `order_type` `FRESH/RENEWAL/UPGRADE/DOWNGRADE`, `add_ons`, `payment_method` (gateway/manual), `source`, `is_manually_created`, `original_order_id` |
| `console_payments` | vendor-agnostic (`vendors/base_client.py` → `razorpay_client.py`), webhook verifies `X-Razorpay-Signature` |
| `console_entitlements` | **What the tenant currently owns per product**: `modules[]`, `limits`, `start_date`/`end_date`, `is_manually_deactivated`. `activate_pending_entitlements` starts queued renewals; `get_subscription_status` drives the "plan expiring" popup (`dismiss_popup`) |
| `console_grace_periods` | Extra days after expiry: `granted_days`, `consumed_days`, `status ACTIVE/EXPIRED/SETTLED`, `attempt_number`, `settled_by_order_id` (paying later closes the grace) |
| `console_wallets` + `console_wallet_transactions` | Prepaid balance per tenant (with `frozen_balance`), every txn stores previous/remaining balance + `service_name`; PDF/CSV statement + low-balance email. Used for usage-billed products (calls/WhatsApp) — plan_type `WALLET` |

`GET /calculate-amount` prices an order (plan + add-ons + coupon + proration) before checkout.

### 2.5 Integration surface
- **OAuth2 authorization server** (`/authorize`, `/token`, `/introspect`, `/revoke`, `/.well-known/*`, JWKS): lets external apps / MCP clients log in with Console accounts.
- **API keys** per partner with `scopes` and `user_context`; validated by products over gRPC (`ValidateApiKey`). Used for website forms / external lead push.
- `console_api_logs` (Mongo) and `console_audit_logs` (action, resource, before/after state, by whom).
- Notifications: subscriptions per user per channel (FCM/webhook) + history with unread count.
- `console_release_notes`, `user_config` (per-user UI prefs), `constants` / `dynamic_variables` / media constants (DB-driven config and copy).

---

## 3. Maglo — the CRM product

### 3.1 Core model: Lead (person) vs Lead Request (enquiry)
- `maglo_leads` — the **person**: name, phone, WhatsApp, email, alternates, city/state/country, verification flags, `partner_id`. Deduplicated by phone/email.
- `maglo_lead_requests` — **one enquiry of that person on one Service Board** (pipeline). Holds the working state:
  `status`, `sub_status`, `lead_stage`, `assigned_to`, `is_closed/closed_by/closed_at`, `is_converted`, `is_dropped`, `is_irrelevant`, `is_interested`, `is_referred + reason`, `is_reopened + reason`, `revive_count / last_revived_at`, `lead_re_enquired_count`, `primary_source_id`, `lead_request_origin`.
- When the same person enquires again: existing lead is reused, re-enquiry count increments, source is appended, existing assignee is kept (`add_lead_and_source`). A source `threshold_value` can cap volume.

This split is the most reusable idea: **contact master once, many deals/enquiries per pipeline.**

### 3.2 Service Boards = configurable pipelines
- `maglo_service_board`: a pipeline per business line (e.g. "MBBS India", "MBBS Abroad"), slug + `service_board_key` (used by inbound APIs), Holler/Babbler toggles, clone endpoint.
- `maglo_service_board_users`: who works the board + `is_masking_enabled` (hide phone/email from that user — `mask_phone`/`mask_email`).
- `maglo_service_board_config`: key/JSON settings per board with history (assignment strategy, etc.).
- `maglo_home`: remembers user's last board.

### 3.3 Status journeys (configurable state machine)
- Global masters: `maglo_statuses`, `maglo_substatuses`.
- `maglo_service_journeys` (one per board) → `…_journey_statuses` (status + `eligible_next_status` JSON + `assessments`) → `…_journey_substatuses` with `sequence`, `eligible_next_substatus`, **`pre_stamp_actions`, `post_stamp_actions`, `communications`, `assessments`**.
- So each board defines allowed transitions, required checks/questions before moving, and auto-messages after. Bulk status change endpoint exists.

### 3.4 Dynamic fields (EAV)
`maglo_business_domain` → `maglo_sections` (ordered) → `maglo_cf_metadata` (field_name, `data_type`, required, sequence, slug) + `maglo_cf_choice_options`; values in `maglo_cf_values` (`entity_id`, value, `additional_info.versions` for history, also file fields on S3). `maglo_partner_section_cf_mapping` picks which sections/fields each tenant + board shows and in which order. Fields can be migrated between boards.

### 3.5 Sources & acquisition
- `maglo_partner_lead_sources` (tenant's sources with key + threshold) and `maglo_lead_sources` (per lead request: channel, campaign).
- Channels master (`maglo_channels`) associated to boards.
- **Meta (Facebook) Lead Ads**: OAuth page tokens → page → ad account → adset/campaign → form mappings with field-key mapping; webhook `/leads/meta/webhook` ingests leads. Also `/create-external-lead` (API key), Excel bulk creation, Kafka topic `inbound_leads`.
- Publishers (`maglo_partner_publisher_bridge`): third-party lead vendors that push into a partner, with monitoring and masking flags.
- **Self-serve**: tokenised public link so the lead fills/updates their own form.

### 3.6 Assignment
`distribution_algorithm`: strategy pattern with `RRA` (round-robin) and `EDA` (even distribution, remainder spread), combined with user availability from Console and board users. Refer / bulk-refer transfers leads between users or boards (`REFER` history event).

### 3.7 Activity, follow-ups, deals, analytics
- `maglo_lead_histories`: timeline with `event_type` = calls, messages, emails, transactions, status, sub_status, personal_details, custom_fields, files, assignee, refer, documents, followups, revival, reenquired, self_serve; previous→current state + actor.
- Remarks per lead request.
- `followups`: scheduled_at, type, remarks, completed/cancelled, change history; "followup cards" (today/overdue/upcoming).
- `deals`: amount, `stage`, `priority`, `next_eligible_stages`, validity.
- Dashboard cards, lead count, analytics v1/v2, Excel export as background task (`maglo_task_logs` tracks async jobs), `maglo_ml_analytics` stores ML predictions (lead scoring) with confidence.
- Email templates per board + send-mail; WhatsApp/OTP via Babbler.

### 3.8 Workflow automation
`maglo_workflows`: per board + `event` (e.g. lead status change) + a JSON graph of nodes:
- `condition` (field/operator/value, or AND/OR group) with `next` / `else_next`
- `time` (`immediate`, `after_delay`, `before_time`, repeat fixed-frequency or custom delays)
- `action_followup`, `action_whatsapp`

Executed by Celery (`execute_workflow_task`) through an executor factory per event. Small, clean design to copy.

---

## 4. What to borrow for AHEAD ERP

Mapped against the existing platform core (tenants, roles, entitlements) and the R1–R10 plan:

| Maglo/Console idea | Use in AHEAD | Priority |
|---|---|---|
| `data_scope ALL/SUBTREE/OWN` on roles + `parent_id` reporting tree | Add to roles; filter CRM/sales lists by scope inside `withTenant` queries | High |
| Default role catalog + per-tenant "materialize" for custom roles | Matches R-series tenant customisation; keep default perms in seed, copy on first edit | High |
| Plans with `modules[]` + `limits` JSON, Entitlement rows with start/end, Grace periods, order types FRESH/RENEWAL/UPGRADE/DOWNGRADE | Directly fits R4–R7 (DB-editable plans, Razorpay onboarding). Add grace + `calculate-amount` | High |
| Lead (contact) vs Lead Request (enquiry per pipeline) | CRM module: Contact master + Enquiry/Opportunity per pipeline; re-enquiry increments instead of duplicates | High |
| Configurable pipelines with status → sub-status, allowed transitions, pre/post actions | CRM pipelines; later reuse the same engine for Sales Order / Service Ticket stages | Medium |
| Custom fields: domain → section → field → value, per-tenant mapping | Generic custom fields across Customer, Item, Invoice (Indian SMBs always ask) | Medium |
| Activity timeline with typed events + before/after | One `activity_log` table per entity type; also covers audit | Medium |
| Round-robin / even assignment + availability | Lead auto-assignment | Medium |
| Workflow JSON (condition/time/action) run by a job queue | Automation module (follow-up reminders, WhatsApp on stage change) once a queue exists | Later |
| Wallet + transactions with previous/remaining balance | If you bill WhatsApp/SMS usage per tenant | Later |
| API keys with scopes, Meta lead-ads webhook, self-serve form links | Lead capture integrations | Later |
| Field masking per user | Useful for agent roles in CRM | Later |

**Skip / do differently**
- Microservices + gRPC: AHEAD is one backend; keep identity and CRM in one service and one Postgres with RLS. Copy the *boundaries* (platform core vs modules), not the network split.
- Statuses stored as strings on `lead_request` plus global status masters with unique names — prefer tenant-scoped status rows referenced by id.
- Timestamps as BigInteger epochs mixed with DateTime — pick `timestamptz` everywhere.
- Some typos/drift in names (`is_eamil_verified`, `session_mangement`) — a reminder to lint the schema.

---

## 5. Pointers into the code

| Topic | File |
|---|---|
| Maglo routes | `maglo-service/src/routes/base.py` |
| Lead create / dedupe / refer / export | `maglo-service/src/components/lead/services.py` |
| Lead request model | `maglo-service/src/components/lead_request/models.py` |
| Journeys | `maglo-service/src/components/service_journey/models.py` |
| Custom fields | `maglo-service/src/components/custom_field/models.py`, `partner_section_cf/models.py` |
| Workflow nodes + executor | `maglo-service/src/components/workflow_automation/schemas.py`, `executors/base.py` |
| Assignment | `maglo-service/src/components/distribution_algorithm/assignment.py` |
| Permission check | `maglo-service/src/components/rbac/permission_dependency.py` |
| Console gRPC contract | `console-service/src/protos/auth.proto` |
| Roles / data scope | `console-service/src/components/auth/models.py`, `partner_role/constants.py` |
| Plans / entitlements / grace | `console-service/src/components/plan`, `entitlement/services.py`, `grace/services.py` |
| Wallet | `console-service/src/components/wallet/services.py` |
| OAuth server | `console-service/src/components/oauth_server/` |
| Per-tenant dedicated DB (encrypted creds) | `console-service/src/components/partner_db_config/` |

---

## 6. Live UI walkthrough (int environment, 2026-10-23)

### 6.1 Navigation
```
Insights ▸ Lead                      Logistics ▸ Products · Inventory · Order
Leads                                Finance   ▸ Quotation · Proforma Invoice · Invoice · Payments
Follow-up                            Automation▸ Workflows · Triggers (beta)
Call - Logs                          Helpdesk (beta)
Organisation ▸ Accounts · Contacts   Reports (beta)
Pipeline                             Settings  ▸ Templates · Sources · Channel · Service boards ·
                                                 Users · Roles · Teams · Integrations ·
                                                 Partner Config · Publisher
```
Top bar on every page: availability toggle (**Active**/away), **team switcher** ("Watch Team" — scope the whole app to one team), notifications bell, **service-board switcher**. Left footer has a guided "Start Tour".

**Page pattern used everywhere** (worth copying as one reusable component):
KPI cards row (counts per status, "previous 90 days") → search box + Sort By + filter chips (Status, Sub-Status, Source, Campaign, Channel, Location, Date Filters, Clear) → status tabs → table with column picker ("All columns"), row action menu (⋮), pagination with 20–500 rows per page, `N Active / M Inactive` counter on master lists.

### 6.2 Sales & CRM screens
| Screen | What's on it |
|---|---|
| **Insights ▸ Lead** | Charts: lead conversion trend (generated vs converted by day), top sources, top users by conversion %, assigned vs converted per user, per-user lead status. Each has its own date range + filter |
| **Leads (list)** | Cards: Total, Fresh, Closed, Referred, Revived, Re-enquired, Converted, Irrelevant, Interested. Tabs TOTAL / FRESH / RE-ENQUIRED. Columns: click-to-call + WhatsApp, Name/phone, Status+Sub-status, Next follow-up, Agent (+ assignment trail), Source, Re-enquired count, Custom section link, **Score**, Lead age, Created, Revive count/time, Last activity, then every custom field as a column. "CS Filter" = filter on custom fields. **Bulk actions:** Assign, Refer, Change status, Revive, Send email, Dialer (auto-dial list), Download, Delete |
| **Lead detail** | Header: name, request id, status/sub-status, assignee, quick icons (edit, copy link, call, follow-up, email, WhatsApp, raise ticket, reassign), **Create ▸ Contact / Deal / Activity**, prev/next lead. KPI strip: lead age, stage, source, re-enquired, last follow-up, score. Left: personal details, sticky DID (fixed caller number), notes, source details (channel, campaign, source). Right tabs: **Lead Details (custom sections as sub-tabs) · Lead Notes · Addresses · Orders · Deals · Follow-ups · Lead History · Lead Activity Log · Tickets** |
| **Follow-up** | Cards + tabs: Pending, Missed, Planned, Done, Cancelled, Rescheduled; filter by entity (lead/contact/account) |
| **Call logs** | Cards: total, unique, connected, missed calls, talk time, duration. Columns: DID, lead/contact (phone masked), agent, call status, agent status, call type, duration, talk time, **recording player** |
| **Accounts** (B2B companies) | Industry, category, status/sub-status (accounts have their own journey), contact count, onboarded on |
| **Contacts** | Linked to account, role, department, status/sub-status |
| **Pipeline** | Deal **kanban** (New deal → Closed won / Closed lost) with ₹ totals per column; cards for total deals, revenue, new in 7 days and **deal-size buckets** (Titan / Growth / Moderate / Small win). Toggle **Planned vs Actual pipeline** + History. Deal card: id, size bucket, expected date, lead, product, amount, owner |

### 6.3 Logistics & finance screens (the ERP part)
| Screen | What's on it |
|---|---|
| **Products** | Cards: total, active/inactive, stock-tracked vs not. Columns: name, linked items (bundles/variants), SKU, category, unit, inventory tracked |
| **Inventory** | Tabs **Stock view · Movement log · Batch view · Transfer** (between locations); Excel import with reference file |
| **Orders** | Cards: All, Delivered, Pending payment, Draft, Cancelled. Order id format `<tenant>-<n>-YYYYMMDD-<seq>`; statuses include Draft → Order verified → Pending payment → Delivered; assignee per order; bulk actions |
| **Quotation** | Statuses **Draft · Sent · Negotiating · Accepted · Rejected · Expired · Cancelled**. Numbering `PFX-QO-00-0038`. Create form: entity type (Lead/Contact/Account) + record, **template**, number, date, valid-until, name, item table (item, qty, rate, discount, tax, amount; add free row or pick products), totals (sub-total, discount, before tax, tax, total). Buttons: Preview, Save draft, **Save & Share** |
| **Proforma invoice** | Same lifecycle and form as quotation |
| **Invoice** | Statuses Draft, Sent, Overdue, Cancelled; columns order number, due date, amount, **balance due** |
| **Payments** | Transaction id, order, payment type, status (paid/captured, pending, refunded, failed), method, **vendor** (Razorpay), created by |
| **Templates** | Separate document templates for Quotation / Proforma / Invoice, with extra custom fields |

### 6.4 Automation, support, reports
| Screen | What's on it |
|---|---|
| **Workflows** | List with event (`ON_LEAD_CREATION`, `LEAD_REQUEST_STATUS_CHANGED`, `ON_LEAD_REFFERED`, `ON_MISSED_FOLLOWUP`…), active toggle. Editor is a **node canvas**: start node → Conditions (field, operator, value, AND/OR, variables like `{Source Name}`) / Time / Actions, with minimap |
| **Triggers** (beta) | "Standard field changed" / "Custom field changed" on an entity + watch field (e.g. `assigned_to`, `status`) → runs an associated workflow; "Watch all firings" log |
| **Helpdesk** (beta) | **Kanban of tickets** (Open, In progress, …), id `EPC-000062`, linked to any record (Order #, Lead #, LeadRequest #, Contact #), priority, due date, assignee; filters by epic, entity type, priority |
| **Reports** (beta) | Saved custom reports: name, **primary entity** (Lead, Order…), created by — a report builder |

### 6.5 Settings
| Screen | What's on it |
|---|---|
| **Service boards** | Name, category (e.g. education), users, leads, sections, board key, status. Per-board menu: **Service Board Config · Service Journey · Custom Section · Lead Score Config · Assignment Engine · Pipeline Management · Inventory Management · Ticket Configuration · Order Config · Manual Shipment Config** — i.e. the board is the unit of configuration for every module |
| **Service journey** | Entity selector (Lead…) → table of Status · Next eligible status · Sub-statuses, drag to reorder |
| **Sources** | Name, threshold value, source key (UUID used by inbound APIs), created by, status |
| **Users** | Role, email, phone, **cloud agent number** (telephony), service boards, teams, **parent (manager)**, availability, status |
| **Roles** | Name, description, **data scope (ALL / SUBTREE)**. **Role permissions** page: 96 toggles in 27 categories — Leads (14), Bulk actions (5), Analytics (13), Calls (6), User access (8), Service boards (6), Publisher/partner channel (7), Orders & transfers (6), Product & inventory (5), Templates & custom fields (4), Contacts & documents (3), General (3), Finance & payments (2), plus single toggles for Pipeline, Tasks, Field tracking, Pricing, Dashboard, WhatsApp, Lead/Call insight, Lead activity, Email config, Integrations, Help & support… |
| **Teams** | Name, description, linked service boards |
| **Integrations** | Active: **Google Ads** (form mappings 42/49 active), **IndiaMART** (product mappings). Available: Facebook lead forms, Facebook conversions, **Razorpay**, **Shiprocket** |
| **Partner config** | Default service board, default source key, IVR source key, max re-enquiries per source, DID management, email configuration, **strict hierarchy policy**, international tenant, unified inbox |

### 6.6 Console API (Swagger, `Makunai Console API's v0.1.0`)
143 endpoints in 34 groups: Auth 20 (login, signup, OTP, reset password, **assume_user** = impersonation, roles, permissions, permission categories/resources), Users 14 (incl. bulk upload, delete-account with OTP, lookup by IVR number), Teams 12, Partners 10 (onboard, status change, toggle activation, logo upload), Notifications 7, Plans 6, Orders 6, Partner roles / Partner role permission / Default role permission 5 each (incl. **permission matrix per partner**), Partner address, Partner config, Release notes, User metadata, API keys 5 each, Wallet 4, User config 4, **Partner DB config 4** (optional dedicated database per tenant, credentials encrypted with Fernet), OAuth (discovery, public, authenticated) 14, Grace 2, Entitlements 2, Payment 2 (history + webhook), App config 2 (incl. navbar marquee announcement), Partner home page 2 (dashboard cards), Location 3, Constants 3, Digital assets 3, User tracker 3, Api logs 1, Session management 1.

### 6.7 Extra takeaways for AHEAD (from the UI)
1. **Quotation → Proforma → Invoice → Payment** with shared item-table form, per-type templates, Save & Share, validity/expiry and balance-due — exactly the GST billing flow; copy the status sets above.
2. **Inventory tabs** (stock, movement log, batch, transfer) are a good minimum scope for the inventory module.
3. **One list-page component** (KPI cards + filters + status tabs + column picker + bulk actions) drives almost every screen — build it once in the frontend.
4. **Record detail = header actions + KPI strip + tabs**, and every module hangs a tab off the customer/lead (orders, deals, follow-ups, tickets, history).
5. **Tickets linkable to any entity** and **triggers on field change** are cheap, high-value generic features.
6. **Permission matrix UI** grouped by category with "x/y enabled" counts — good model for the roles screen.
7. **Team switcher + availability toggle** in the top bar, and **impersonation (`assume_user`)** for support staff.
8. Indian integrations clients expect: IndiaMART, Google/Facebook lead forms, Razorpay, Shiprocket, IVR/cloud telephony with call recordings.
