import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { prisma, db, withPlatform } from '../kernel/db';
import type { ConsoleCtx } from '../kernel/context';
import { extendClient, clientDetail } from '../modules/console/clients';
import { createCoupon, setPrice, updatePlan } from '../modules/console/catalogAdmin';
import { addMember, updateMember } from '../modules/console/members';

// Platform design v2, Step 3: Console screens' business rules. Every test runs in a transaction
// that is rolled back. Needs the dev database with migrations, seed and at least one trialing tenant.

class Rollback extends Error {}
async function rolledBack(fn: () => Promise<void>) {
  try {
    await withPlatform(async () => { await fn(); throw new Rollback(); }, { kind: 'platform' }, { timeoutMs: 120_000 });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
}

afterAll(() => prisma.$disconnect());

const roleId = async (key: string) => (await db().role.findFirstOrThrow({ where: { tenantId: null, layer: 'platform', key } })).id;

/** A Console user created inside the rolled-back transaction */
async function consoleUser(roleKey: string, reportsTo: string | null = null): Promise<ConsoleCtx> {
  const n = String(Math.floor(Math.random() * 1e9)).padStart(9, '0');
  const user = await db().user.create({ data: { name: `Step3 ${roleKey}`, email: `step3-${n}@example.test`, mobile: `+918${n}` } });
  const rid = await roleId(roleKey);
  const member = await db().platformMember.create({ data: { userId: user.id, roleId: rid, reportsTo } });
  return { kind: 'platform', userId: user.id, memberId: member.id, roleId: rid, sessionId: randomUUID(), scope: 'all' };
}

describe('Clients', () => {
  it('extends a trial with a reason, keeps a record and an audit entry', async () => {
    await rolledBack(async () => {
      const sub = await db().subscription.findFirst({ where: { status: 'trialing' } });
      if (!sub) return;
      const admin = await consoleUser('console_staff');
      const row = await extendClient(admin, sub.tenantId, { days: 5, reason: 'Client asked for more time' });
      const after = await db().subscription.findUniqueOrThrow({ where: { id: sub.id } });
      expect(row.kind).toBe('trial');
      expect(after.trialEndsAt!.getTime()).toBe(row.newEndAt.getTime());
      expect(after.trialEndsAt!.getTime() - Math.max(sub.trialEndsAt!.getTime(), row.createdAt.getTime() - 5_000)).toBeGreaterThan(4.9 * 86_400_000);
      expect(await db().auditLog.count({ where: { action: 'console.trial_extended', entityId: sub.tenantId } })).toBe(1);
    });
  });

  it('refuses to extend a paying or Free client', async () => {
    await rolledBack(async () => {
      const sub = await db().subscription.findFirst({ where: { status: 'trialing' } });
      if (!sub) return;
      await db().subscription.update({ where: { id: sub.id }, data: { status: 'free' } });
      const admin = await consoleUser('console_staff');
      await expect(extendClient(admin, sub.tenantId, { days: 3, reason: 'Should not work' })).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
    });
  });

  it('a client outside the scope is "not found", even by id', async () => {
    await rolledBack(async () => {
      const tenant = await db().tenant.findFirstOrThrow();
      const exec = { ...(await consoleUser('console_sales')), scope: 'own' as const };
      await expect(clientDetail(exec, tenant.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await db().tenantAcquisition.update({ where: { tenantId: tenant.id }, data: { acquiredByType: 'sales_user', acquiredByUserId: exec.userId, method: 'manual' } });
      const detail = await clientDetail(exec, tenant.id);
      expect(detail.acquisition?.byType).toBe('sales_user');
      expect(detail).not.toHaveProperty('contacts');
    });
  });
});

describe('Plans, prices and coupons', () => {
  it('a price change closes the active row and opens a new one', async () => {
    await rolledBack(async () => {
      const before = await db().price.findFirstOrThrow({ where: { itemType: 'plan', itemRef: 'starter', cycle: 'monthly', activeTo: null } });
      await setPrice({ itemType: 'plan', itemRef: 'starter', cycle: 'monthly', amountPaise: Number(before.amountPaise) + 100 });
      const rows = await db().price.findMany({ where: { itemType: 'plan', itemRef: 'starter', cycle: 'monthly' }, orderBy: { activeFrom: 'desc' } });
      expect(rows.filter((r) => r.activeTo === null)).toHaveLength(1);
      expect(Number(rows[0].amountPaise)).toBe(Number(before.amountPaise) + 100);
      expect((await db().price.findUniqueOrThrow({ where: { id: before.id } })).activeTo).not.toBeNull();
    });
  });

  it('plan modules must be real modules and the Free plan gets none', async () => {
    await rolledBack(async () => {
      await expect(updatePlan('starter', { fullModules: ['crm', 'teleport'] })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
      await expect(updatePlan('free', { fullModules: ['crm'] })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
      const out = await updatePlan('starter', { fullModules: ['crm', 'billing'], name: 'Starter X' });
      const plan = await db().plan.findUniqueOrThrow({ where: { key: 'starter' }, include: { modules: true } });
      expect(plan.name).toBe('Starter X');
      expect(plan.modules.map((m) => m.moduleKey).sort()).toEqual(['billing', 'crm']);
      expect(out.recomputed).toBeGreaterThanOrEqual(0);
    });
  });

  it('coupon codes are unique and a percentage cannot pass 100', async () => {
    await rolledBack(async () => {
      await createCoupon({ code: 'step3test', type: 'percent', value: 10, appliesTo: 'all' });
      await expect(createCoupon({ code: 'STEP3TEST', type: 'flat', value: 500, appliesTo: 'all' })).rejects.toMatchObject({ code: 'CONFLICT' });
      await expect(createCoupon({ code: 'TOOMUCH', type: 'percent', value: 120, appliesTo: 'all' })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    });
  });
});

describe('Console users', () => {
  it('only a Admin can add a Admin', async () => {
    await rolledBack(async () => {
      const ops = await consoleUser('console_staff');
      await expect(addMember(ops, { email: 'nobody-step3@example.test', name: 'X Y', mobile: '+917000000099', roleKey: 'super_admin' })).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
      const out = await addMember(ops, { email: 'nobody-step3@example.test', name: 'X Y', mobile: '+917000000099', roleKey: 'console_sales' });
      expect(out.newUser).toBe(true);
    });
  });

  it('nobody changes their own role, the last Admin stays, and the tree never loops', async () => {
    await rolledBack(async () => {
      // Leave exactly one active Admin: the one created here
      await db().platformMember.updateMany({ where: { role: { key: 'super_admin' } }, data: { status: 'deactivated' } });
      const boss = await consoleUser('super_admin');
      await expect(updateMember(boss, boss.memberId, { roleKey: 'console_staff' })).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });

      const other = await consoleUser('console_staff');
      await expect(updateMember(other, boss.memberId, { status: 'deactivated' })).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });

      const mgr = await consoleUser('console_sales');
      const exec = await consoleUser('console_sales', mgr.userId);
      await expect(updateMember(boss, mgr.memberId, { reportsTo: exec.userId })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });

      const secondBoss = await consoleUser('super_admin');
      await updateMember(secondBoss, boss.memberId, { roleKey: 'console_staff' });
      // The middleware reads the role live, so the demoted boss now acts as Operations
      const demoted = { ...boss, roleId: await roleId('console_staff') };
      await expect(updateMember(demoted, secondBoss.memberId, { status: 'deactivated' })).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
      await expect(updateMember(secondBoss, secondBoss.memberId, { status: 'deactivated' })).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    });
  });
});
