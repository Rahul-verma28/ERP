import { afterAll, describe, expect, it } from 'vitest';
import { prisma, withTenant, db } from '../kernel/db';

// NFR-10 / LLD §3.2: tenant isolation is enforced by PostgreSQL, not only by the API.
// Requires DATABASE_URL and at least two tenants (run the signup smoke test first).

// Platform tables that carry tenant_id but are only reachable with platform privileges
const PLATFORM_TABLES = ['trial_registry', 'console_prospects', 'console_followups', 'console_notes', 'user_sessions', 'sign_in_events', 'tenant_acquisitions', 'grace_periods', 'platform_orders', 'platform_payments', 'platform_invoices', 'platform_credit_notes'];

describe('row-level security', () => {
  afterAll(() => prisma.$disconnect());

  it('every tenant table has RLS enabled and forced', async () => {
    const rows = await prisma.$queryRaw<{ table_name: string; rls: boolean; forced: boolean }[]>`
      SELECT c.relname::text AS table_name, c.relrowsecurity AS rls, c.relforcerowsecurity AS forced
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
       WHERE c.relkind = 'r'
         AND EXISTS (SELECT 1 FROM information_schema.columns col
                      WHERE col.table_schema = 'public' AND col.table_name = c.relname AND col.column_name = 'tenant_id')`;
    const missing = rows.filter((r) => !PLATFORM_TABLES.includes(r.table_name) && (!r.rls || !r.forced)).map((r) => r.table_name);
    expect(missing).toEqual([]);
  });

  it('a tenant transaction only sees its own rows and cannot write into another tenant', async () => {
    const tenants = await prisma.tenant.findMany({ take: 2, orderBy: { createdAt: 'desc' } });
    if (tenants.length < 2) return;
    const [a, b] = tenants;

    const seen = await withTenant({ kind: 'system', tenantId: a.id }, async () => ({
      tenants: await db().tenant.findMany({ select: { id: true } }),
      branches: await db().branch.findMany({ select: { tenantId: true } }),
      members: await db().tenantMember.findMany({ select: { tenantId: true } }),
    }));
    expect(seen.tenants.map((t) => t.id)).toEqual([a.id]);
    expect(seen.branches.every((r) => r.tenantId === a.id)).toBe(true);
    expect(seen.members.every((r) => r.tenantId === a.id)).toBe(true);

    await expect(
      withTenant({ kind: 'system', tenantId: a.id }, () =>
        db().branch.create({ data: { tenantId: b.id, name: 'Intruder', code: 'X1' } }),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('platform tables are not readable by app_user', async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe('SET LOCAL ROLE app_user');
        return tx.trialRegistry.findMany();
      }),
    ).rejects.toThrow(/permission denied/);
  });

  it('acquisition records and platform settings are not readable by app_user', async () => {
    for (const read of [(tx: typeof prisma) => tx.tenantAcquisition.findMany(), (tx: typeof prisma) => tx.configValue.findMany()]) {
      await expect(
        prisma.$transaction(async (tx) => {
          await tx.$executeRawUnsafe('SET LOCAL ROLE app_user');
          return read(tx as unknown as typeof prisma);
        }),
      ).rejects.toThrow(/permission denied/);
    }
  });

  it('without a tenant set, tenant tables return nothing', async () => {
    const rows = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL ROLE app_user');
      return tx.branch.findMany();
    });
    expect(rows).toEqual([]);
  });
});
