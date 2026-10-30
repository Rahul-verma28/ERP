import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { prisma, db, withPlatform } from '../kernel/db';
import { cache } from '../kernel/cache';
import type { ConsoleCtx } from '../kernel/context';
import { planDiff, planEditor, publishDraft, saveDraft, setOverride } from '../modules/console/product';
import { applyOverrides } from '../modules/subscription/entitlements';
import { capturePayment, changePlan, createClient, pendingChange, previewPlanChange, proRate } from '../modules/platformBilling/service';

// Blueprint Phase D: plan drafts and publish, module switches, pro-rated plan changes.
// Rolled back; the seller's billing details are primed in the settings cache.

const SELLER = { legalName: 'AHEAD Test', gstin: '09AAAAA0000A1Z0', stateCode: '09', address: 'Noida', sac: '998314', gstRateBp: 1800 };

class Rollback extends Error {}
async function rolledBack(fn: () => Promise<void>) {
  cache.del('settings:platform');
  await cache.getOrSet('settings:platform', async () => new Map([['ahead.billing', { value: SELLER, version: 1 }]]), 60_000);
  try {
    await withPlatform(async () => { await fn(); throw new Rollback(); }, { kind: 'platform' }, { timeoutMs: 150_000 });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  } finally {
    cache.del('settings:platform');
    cache.del('catalog:commercial');
  }
}

afterAll(() => prisma.$disconnect());

async function admin(): Promise<ConsoleCtx> {
  const n = String(Math.floor(Math.random() * 1e9)).padStart(9, '0');
  const user = await db().user.create({ data: { name: 'PD Admin', email: `pd-${n}@example.test`, mobile: `+918${n}` } });
  const role = await db().role.findFirstOrThrow({ where: { tenantId: null, layer: 'platform', key: 'super_admin' } });
  const member = await db().platformMember.create({ data: { userId: user.id, roleId: role.id } });
  return { kind: 'platform', userId: user.id, memberId: member.id, roleId: role.id, sessionId: randomUUID(), scope: 'all', partnerId: null };
}

describe('pure helpers', () => {
  it('pro-rates only the price difference for the days left', () => {
    const start = new Date('2026-10-01T00:00:00Z');
    const end = new Date('2026-10-31T00:00:00Z');
    expect(proRate(99_900, 249_900, start, end, new Date('2026-10-16T00:00:00Z'))).toEqual({ amountPaise: 75_000, daysLeft: 15 });
    expect(proRate(249_900, 99_900, start, end, new Date('2026-10-16T00:00:00Z')).amountPaise).toBe(0);
  });

  it('lists what a draft changes', () => {
    const live = { name: 'Standard', tagline: 'x', isPublic: true, limits: { users: 5, branches: 1, contacts: null, items: null, invoicesPerMonth: null, storageMb: 5120, aiCredits: 0 }, fullModules: ['crm', 'hr'], monthlyPaise: 99_900, yearlyPaise: 999_000 };
    const d = planDiff(live, { ...live, fullModules: ['crm', 'support'], limits: { ...live.limits, users: 8 }, monthlyPaise: 109_900 });
    expect(d).toMatchObject({ added: ['support'], removed: ['hr'], limits: [{ key: 'users', from: 5, to: 8 }], prices: [{ cycle: 'monthly', from: 99_900, to: 109_900 }], changed: true });
    expect(planDiff(live, live).changed).toBe(false);
  });

  it('module switches open or close a module, never for a closed business', () => {
    const base = { hr: { status: 'inactive' as const, tier: 'basic' as const }, crm: { status: 'active' as const, tier: 'full' as const } };
    const on = applyOverrides(base, [{ moduleKey: 'hr', state: 'on' }, { moduleKey: 'crm', state: 'off' }], 'active', new Set(['crm']));
    expect(on.hr).toEqual({ status: 'active', tier: 'full' });
    expect(on.crm).toEqual({ status: 'read_only', tier: 'basic' });
    expect(applyOverrides(base, [{ moduleKey: 'hr', state: 'on' }], 'closed', new Set()).hr.status).toBe('inactive');
  });
});

describe('plan drafts', () => {
  it('a draft shows its impact, refuses a missing dependency, and publishing makes it live', async () => {
    await rolledBack(async () => {
      const a = await admin();
      const live = (await planEditor('standard')).live;
      // Sales needs Products: removing Products must be refused at publish
      await saveDraft(a, 'standard', { ...live, fullModules: live.fullModules.filter((m) => m !== 'catalog') });
      expect((await planEditor('standard')).problems.length).toBeGreaterThan(0);
      await expect(publishDraft(a, 'standard')).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });

      await saveDraft(a, 'standard', { ...live, fullModules: [...live.fullModules, 'hr'], monthlyPaise: (live.monthlyPaise ?? 0) + 10_000, limits: { ...live.limits, users: 6 } });
      const ed = await planEditor('standard');
      expect(ed.diff).toMatchObject({ added: ['hr'], removed: [] });
      expect(ed.draft?.limits.users).toBe(6);
      const after = await publishDraft(a, 'standard');
      expect(after.draft).toBeNull();
      expect(after.live.fullModules).toContain('hr');
      expect(after.live.limits.users).toBe(6);
      expect(after.live.monthlyPaise).toBe((live.monthlyPaise ?? 0) + 10_000);
    });
  });
});

describe('module switches and plan changes', () => {
  it('a paying business upgrades now (pro-rated, same renewal date) or downgrades at renewal', async () => {
    await rolledBack(async () => {
      const a = await admin();
      const n = String(Math.floor(Math.random() * 1e9)).padStart(9, '0');
      const out = await createClient(a, { business: { name: 'Upgrade Traders', industryKey: 'retail', stateCode: '09' }, owner: { name: 'Neeta Rao', email: `pdo-${n}@example.test`, mobile: `+917${n}` }, start: 'paid', order: { planKey: 'standard', cycle: 'monthly', addOns: [], extraUsers: 0, discountPercent: 0 } });
      await capturePayment(out.orderId!, { method: 'upi', amountPaise: out.totalPaise, reference: 'UTR1', receivedAt: new Date(), recordedBy: a.userId });
      const sub = await db().subscription.findUniqueOrThrow({ where: { tenantId: out.tenantId } });

      await setOverride(a, out.tenantId, 'hr', { state: 'on', reason: 'Two-week HR demo' });
      expect(await db().tenantModuleOverride.count({ where: { tenantId: out.tenantId } })).toBe(1);

      const up = await previewPlanChange(out.tenantId, { planKey: 'professional', cycle: 'monthly' });
      expect(up.kind).toBe('upgrade');
      if (up.kind === 'upgrade') expect(up.item.unitPaise).toBeGreaterThan(140_000);
      const order = await changePlan(a, out.tenantId, { planKey: 'professional', cycle: 'monthly' });
      expect(order.kind).toBe('upgrade');
      if (order.kind !== 'upgrade') return;
      await capturePayment(order.orderId, { method: 'upi', amountPaise: order.totalPaise, reference: 'UTR2', receivedAt: new Date(), recordedBy: a.userId });
      const upgraded = await db().subscription.findUniqueOrThrow({ where: { tenantId: out.tenantId } });
      expect((await db().plan.findUniqueOrThrow({ where: { id: upgraded.planId } })).key).toBe('professional');
      expect(upgraded.currentPeriodEnd?.getTime()).toBe(sub.currentPeriodEnd?.getTime());

      const down = await changePlan(a, out.tenantId, { planKey: 'standard', cycle: 'monthly' });
      expect(down).toMatchObject({ kind: 'scheduled' });
      expect(await pendingChange(out.tenantId)).toMatchObject({ planKey: 'standard', cycle: 'monthly' });
    });
  });
});
