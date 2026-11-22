# AHEAD ERP — Backend API

See the [root README](../README.md) for setup, structure and how tenant isolation works, and [TASKS.md](../TASKS.md) for the build plan.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Prepares the local database (creates it if missing, migrates, seeds), then runs the API + in-process worker with reload |
| `npm run db:prepare` | Only the database step of `dev`: create if missing, migrate, seed (local PostgreSQL only) |
| `npm run db:copy-from-neon` | One-time copy of every row from Neon (`NEON_DATABASE_URL`) into the local database. Empties local first |
| `npm run build` / `npm start` | Compile to `dist/` and run |
| `npm run typecheck` | TypeScript check |
| `npm run db:migrate` | Apply Prisma migrations (schema, RLS, grants) |
| `npm run db:seed` | Sync modules, plans, prices, permissions, roles, templates from `src/contracts` |
| `npm test` | Vitest suite |

## Local database

Development runs on a local PostgreSQL (16+). In `.env` set `DATABASE_URL` and `DATABASE_URL_UNPOOLED` to `postgresql://<user>:<password>@localhost:5432/ahead_erp`; `npm run dev` creates the database, applies every migration in `prisma/migrations` (the same SQL that built Neon: tables, RLS policies, the `app_user` role, grants) and pins the time zone to UTC like Neon. To go back to Neon, put the Neon URLs back in `DATABASE_URL*`.

## Adding a business module

1. Add tables to `prisma/schema.prisma` with `tenant_id`, then a migration that enables + forces RLS, adds the `tenant_isolation` policy and grants to `app_user` (the RLS test fails otherwise).
2. Add permission keys to `src/contracts/permissions.ts` and grant them in `src/contracts/roles.ts`; run `npm run db:seed`.
3. Routes: `router.post('/things', requirePermission('module.thing.create'), validate(Schema), tx(handler))`. Inside handlers use `db()` only.
4. Validate `custom` JSONB with `validateCustom(tenantId, entity, input)` from `modules/config/service.ts`.
