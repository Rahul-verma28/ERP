# AHEAD ERP

Multi-tenant ERP + CRM SaaS for Indian SMBs. Next.js frontend, Express + TypeScript API, PostgreSQL with row-level security, Prisma ORM.

- Build plan and status: [TASKS.md](TASKS.md)
- Design source: PRD v1, LLD v1 (Platform Core), Roles & Permissions, Onboarding/Trial/Payment Flow, Module Catalogue

## Project Structure

- `frontend/` — Next.js 16 app (tenant app, auth pages; admin/partner/vendor portals later)
- `backend/` — Express API, Prisma schema + migrations, in-process worker (outbox relay, scheduled jobs)

```text
backend/src/
├── config/env.ts          # Zod-validated environment
├── kernel/                # db (withTenant / withPlatform), errors, crypto, cache, context
├── middleware/            # auth + permission checks, validation, rate limits, errors
├── contracts/             # modules, permissions, 28 roles, plans, industry templates
├── modules/
│   ├── identity/          # OTP, signup, login, refresh, email verification, /me
│   ├── tenancy/           # createTenant, profile, branches, members, invitations
│   ├── access/            # role permissions, visible roles, caches
│   ├── config/            # templates, terminology, custom fields + validator
│   ├── subscription/      # state machine, entitlements, trial-expiry job
│   ├── events/            # transactional outbox + consumers
│   ├── audit/ notifications/
├── worker.ts              # outbox relay (1 s) + hourly jobs
└── server.ts
```

## Quick Start

### 1. Backend
```bash
cd backend
npm install
cp .env.example .env   # fill DATABASE_URL (local PostgreSQL), JWT_SECRET, PEPPER
npm run dev            # creates the database if missing, migrates, seeds, then starts the API
```
Runs at `http://localhost:5000` (health: `/api/v1/health`).

In development there is no SMS/email provider: OTP codes, verification links and invitation links are printed in the API log, and OTP codes are also returned in the API response (`devCode`).

### 2. Frontend
```bash
cd frontend
npm install
npm run dev
```
Runs at `http://localhost:3000`. Requests to `/api/v1/*` are proxied to the backend (`BACKEND_URL`, default `http://localhost:5000`).

### Docker (production)
```bash
cp .env.docker.example .env   # passwords and secrets
docker compose up -d --build   # PostgreSQL, API + worker, web app
```
The API container waits for PostgreSQL, creates and migrates the database, then starts. Uploaded files are kept in the `uploads` volume, the database in `pgdata`.

### Troubleshooting
- `GET /api/v1/health` reports `database: up/down`. If the database is unreachable the API answers 503 `PROVIDER_UNAVAILABLE` and the web app shows a reconnect screen instead of signing you out.
- Run the API from one terminal with `npm run dev`. On Windows, stopping a backgrounded `npx tsx` can leave the child process alive on port 5000, still serving old code.

### Tests
```bash
cd backend
npm test        # RLS isolation (needs the database), state machine, entitlements, roles
```

## How tenant isolation works

Every request that touches tenant data runs inside `withTenant()`: one transaction that sets `app.tenant_id` and switches to the `app_user` role (no `BYPASSRLS`), so PostgreSQL policies filter every tenant table. Platform tables (users, sessions, trial registry, plans) are only reachable through `withPlatform()`. Routes declare a permission key with `requirePermission('module.resource.action')`, which checks the tenant's entitlement (active / read-only / not in plan) and the user's role before the handler runs.
