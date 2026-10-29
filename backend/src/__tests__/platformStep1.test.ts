import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { prisma, db, withPlatform } from '../kernel/db';
import { syncCatalog } from '../modules/subscription/catalog';
import { resolveSetting, setSetting } from '../modules/settings/service';
import { createTenant, validateAcquisition } from '../modules/tenancy/createTenant';
import { changeAcquisition } from '../modules/tenancy/acquisition';
import { SETTINGS } from '../contracts/settings';

// Platform design v2, Step 1 (R1 acquisition, R2 settings, R4 seed). Database tests run inside
// a transaction that is always rolled back, so they leave no rows behind. Requires DATABASE_URL
// with migrations and the seed applied.

class Rollback extends Error {}
async function rolledBack(fn: () => Promise<void>) {
  try {
    // Long timeout: from India every query is a round trip to Neon us-east-2
    await withPlatform(async () => { await fn(); throw new Rollback(); }, { kind: 'platform' }, { timeoutMs: 120_000 });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
}

const owner = () => {
  const n = String(Math.floor(Math.random() * 1e9)).padStart(9, '0');
  return { kind: 'new' as const, name: 'Step One Test', email: `step1-${n}@example.test`, mobile: `+919${n}`, passwordHash: null, mobileVerified: true };
};

afterAll(() => prisma.$disconnect());

describe('R4: seed keeps commercial data edited in the database', () => {
  it('does not overwrite plan limits, plan modules, prices or free-tier flags', async () => {
    await rolledBack(async () => {
      const tx = db();
      const free = await tx.plan.findUniqueOrThrow({ where: { key: 'free' } });
      await tx.plan.update({ where: { id: free.id }, data: { limits: { ...(free.limits as object), users: 99 } } });
      const price = await tx.price.findFirstOrThrow({ where: { itemType: 'plan', itemRef: 'starter', cycle: 'monthly', activeTo: null } });
      await tx.price.update({ where: { id: price.id }, data: { amountPaise: 123400n } });
      await tx.module.update({ where: { key: 'crm' }, data: { isFreeTier: false } });
      await tx.planModule.deleteMany({ where: { plan: { key: 'starter' }, moduleKey: 'inventory' } });

      await syncCatalog(tx);

      expect(((await tx.plan.findUniqueOrThrow({ where: { key: 'free' } })).limits as { users: number }).users).toBe(99);
      const active = await tx.price.findMany({ where: { itemType: 'plan', itemRef: 'starter', cycle: 'monthly', activeTo: null } });
      expect(active.map((p) => p.amountPaise)).toEqual([123400n]);
      expect((await tx.module.findUniqueOrThrow({ where: { key: 'crm' } })).isFreeTier).toBe(false);
      expect(await tx.planModule.count({ where: { plan: { key: 'starter' }, moduleKey: 'inventory' } })).toBe(0);
    });
  });

  it('--reset-commercials restores the code defaults', async () => {
    await rolledBack(async () => {
      const tx = db();
      const free = await tx.plan.findUniqueOrThrow({ where: { key: 'free' } });
      await tx.plan.update({ where: { id: free.id }, data: { limits: { ...(free.limits as object), users: 99 } } });

      await syncCatalog(tx, { resetCommercials: true });

      expect(((await tx.plan.findUniqueOrThrow({ where: { key: 'free' } })).limits as { users: number }).users).toBe(2);
    });
  });
});

describe('R2: platform settings', () => {
  it('falls back to the code default when nothing (or something invalid) is stored', () => {
    expect(resolveSetting('trial.days', undefined)).toBe(SETTINGS['trial.days'].default);
    expect(resolveSetting('trial.days', 'fifteen')).toBe(14);
    expect(resolveSetting('trial.days', 500)).toBe(14);
    expect(resolveSetting('grace.days_yearly', 21)).toBe(21);
  });

  it('stores a valid value with a version and an audit entry, and rejects an invalid one', async () => {
    await rolledBack(async () => {
      const tx = db();
      await setSetting('trial.days', 21, null);
      await setSetting('trial.days', 30, null);
      const row = await tx.configValue.findUniqueOrThrow({ where: { scope_key: { scope: 'platform', key: 'trial.days' } } });
      expect(row.value).toBe(30);
      expect(row.version).toBe(2);
      expect(await tx.auditLog.count({ where: { action: 'settings.changed', entityId: 'trial.days', at: { gte: row.updatedAt } } })).toBeGreaterThan(0);
      await expect(setSetting('trial.days', 0, null)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    });
  });
});

describe('R1: tenant source and acquisition', () => {
  it('needs an acquiring user for every channel except self-signup', () => {
    expect(validateAcquisition({ byType: 'self', method: 'signup' })).toBe('direct');
    expect(validateAcquisition({ byType: 'sales_user', byUserId: randomUUID(), method: 'manual' })).toBe('sales');
    expect(() => validateAcquisition({ byType: 'vendor', method: 'referral_code' })).toThrow(expect.objectContaining({ code: 'VALIDATION_FAILED' }));
    expect(() => validateAcquisition({ byType: 'self', byUserId: randomUUID(), method: 'signup' })).toThrow(expect.objectContaining({ code: 'VALIDATION_FAILED' }));
  });

  it('self-signup records a locked acquisition, source direct, onboarding trial', async () => {
    await rolledBack(async () => {
      const { tenant } = await createTenant({ owner: owner(), businessName: 'Step One Salon', industryKey: 'salon', acquisition: { byType: 'self', method: 'signup', couponCode: 'welcome10' } });
      expect(tenant.source).toBe('direct');
      expect(tenant.onboardingType).toBe('trial');
      const acq = await db().tenantAcquisition.findUniqueOrThrow({ where: { tenantId: tenant.id } });
      expect(acq).toMatchObject({ acquiredByType: 'self', method: 'signup', couponCode: 'WELCOME10', acquiredByUserId: null });
      expect(await db().trialRegistry.count({ where: { tenantId: tenant.id } })).toBe(1);
    });
  });

  it('a sales-brought tenant gets source sales; an internal tenant skips the trial registry', async () => {
    await rolledBack(async () => {
      const salesUser = randomUUID();
      const sold = await createTenant({ owner: owner(), businessName: 'Step One Gym', industryKey: 'gym', acquisition: { byType: 'sales_user', byUserId: salesUser, method: 'manual' } });
      expect(sold.tenant.source).toBe('sales');
      expect((await db().tenantAcquisition.findUniqueOrThrow({ where: { tenantId: sold.tenant.id } })).acquiredByUserId).toBe(salesUser);

      const internal = await createTenant({ owner: owner(), businessName: 'AHEAD Internal', industryKey: 'services', isInternal: true });
      expect(internal.tenant.isInternal).toBe(true);
      expect(await db().trialRegistry.count({ where: { tenantId: internal.tenant.id } })).toBe(0);
    });
  });

  it('only changes with a reason, updates the source and is audited', async () => {
    await rolledBack(async () => {
      const { tenant, user } = await createTenant({ owner: owner(), businessName: 'Step One Shop', industryKey: 'retail' });
      await expect(changeAcquisition(tenant.id, { byType: 'vendor', byUserId: randomUUID(), method: 'referral_code' }, user.id, '')).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });

      const vendor = randomUUID();
      const after = await changeAcquisition(tenant.id, { byType: 'vendor', byUserId: vendor, method: 'referral_code', referralCode: 'VND42' }, user.id, 'Vendor shared proof of referral');
      expect(after).toMatchObject({ acquiredByType: 'vendor', acquiredByUserId: vendor, changeReason: 'Vendor shared proof of referral' });
      expect((await db().tenant.findUniqueOrThrow({ where: { id: tenant.id } })).source).toBe('vendor');
      expect(await db().auditLog.count({ where: { action: 'tenant.acquisition_changed', entityId: tenant.id } })).toBe(1);
    });
  });
});
