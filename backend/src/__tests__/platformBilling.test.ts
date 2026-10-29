import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma, db, withPlatform } from '../kernel/db';
import { cache } from '../kernel/cache';
import type { ConsoleCtx } from '../kernel/context';
import { allocate, approveOrder, capturePayment, createClient, quote } from '../modules/platformBilling/service';
import { withExtraUsers } from '../modules/subscription/entitlements';

// Platform design v2, Step 4a: paid onboarding from the Console. Database tests run in a
// rolled-back transaction. AHEAD's billing details are primed into the settings cache (no DB write).

class Rollback extends Error {}
async function rolledBack(fn: () => Promise<void>) {
  try {
    await withPlatform(async () => { await fn(); throw new Rollback(); }, { kind: 'platform' }, { timeoutMs: 180_000 });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
}

const SELLER = { legalName: 'AHEAD Test', gstin: '09AAAAA0000A1Z0', stateCode: '09', address: 'Noida', sac: '998314', gstRateBp: 1800 };
function primeSettings(billing: typeof SELLER | null) {
  cache.del('settings:platform');
  const stored = new Map<string, { value: unknown; version: number }>();
  if (billing) stored.set('ahead.billing', { value: billing, version: 1 });
  return cache.getOrSet('settings:platform', async () => stored, 60_000);
}

beforeEach(() => primeSettings(SELLER));
afterAll(async () => {
  cache.del('settings:platform');
  await prisma.$disconnect();
});

async function consoleUser(roleKey: string): Promise<ConsoleCtx> {
  const n = String(Math.floor(Math.random() * 1e9)).padStart(9, '0');
  const user = await db().user.create({ data: { name: `Bill ${roleKey}`, email: `bill-${n}@example.test`, mobile: `+917${n}` } });
  const role = await db().role.findFirstOrThrow({ where: { tenantId: null, layer: 'platform', key: roleKey } });
  const member = await db().platformMember.create({ data: { userId: user.id, roleId: role.id } });
  return { kind: 'platform', userId: user.id, memberId: member.id, roleId: role.id, sessionId: randomUUID(), scope: 'all' };
}

const newClient = (discountPercent: number, stateCode = '09') => {
  const n = String(Math.floor(Math.random() * 1e9)).padStart(9, '0');
  return {
    business: { name: `Paid Client ${n}`, industryKey: 'retail', gstin: null, stateCode },
    owner: { name: 'Paid Owner', email: `owner-${n}@example.test`, mobile: `+916${n}` },
    start: 'paid' as const,
    order: { planKey: 'starter', cycle: 'monthly' as const, addOns: ['hr'], extraUsers: 2, discountPercent },
  };
};

describe('discount allocation', () => {
  it('splits in proportion and the last line takes the remainder', () => {
    expect(allocate([100, 200, 300], 60)).toEqual([10, 20, 30]);
    expect(allocate([333, 333, 334], 100)).toEqual([33, 33, 34]);
    expect(allocate([500], 0)).toEqual([0]);
  });
});

describe('paid onboarding', () => {
  it('needs AHEAD\'s state code before anything can be priced', async () => {
    await primeSettings(null);
    await rolledBack(async () => {
      await expect(quote({ planKey: 'starter', cycle: 'monthly', addOns: [], extraUsers: 0, discountPercent: 0, billTo: { name: 'X', stateCode: '09' } })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    });
  });

  it('within the discount limit: client waits for payment with every module closed', async () => {
    await rolledBack(async () => {
      const exec = await consoleUser('console_sales');
      const out = await createClient(exec, newClient(5));
      expect(out.status).toBe('awaiting_payment');
      const tenant = await db().tenant.findUniqueOrThrow({ where: { id: out.tenantId }, include: { acquisition: true, subscription: true } });
      expect(tenant.status).toBe('incomplete');
      expect(tenant.onboardingType).toBe('direct_paid');
      expect(tenant.acquisition).toMatchObject({ acquiredByType: 'sales_user', acquiredByUserId: exec.userId, method: 'manual' });
      expect(await db().trialRegistry.count({ where: { tenantId: tenant.id } })).toBe(0);
      const ents = await db().tenantEntitlement.findMany({ where: { tenantId: tenant.id } });
      expect(ents.every((e) => e.status === 'inactive')).toBe(true);
    });
  });

  it('above the limit: needs someone else\'s approval, then full payment issues an intra-state invoice and opens the plan', async () => {
    await rolledBack(async () => {
      const exec = await consoleUser('console_sales');
      const boss = await consoleUser('super_admin');
      const out = await createClient(exec, newClient(15));
      expect(out.status).toBe('pending_approval');

      const pay = { method: 'bank_transfer' as const, amountPaise: out.totalPaise, reference: 'UTR123', receivedAt: new Date(), recordedBy: boss.userId };
      await expect(capturePayment(out.orderId, pay)).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
      await expect(approveOrder(exec, out.orderId)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
      await approveOrder(boss, out.orderId);
      await expect(capturePayment(out.orderId, { ...pay, amountPaise: out.totalPaise - 100 })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });

      const { invoice } = await capturePayment(out.orderId, pay);
      expect(invoice.number).toMatch(/^AHD\/\d{2}-\d{2}\/\d{6}$/);
      expect(invoice.cgstPaise).toBe(invoice.sgstPaise);
      expect(invoice.igstPaise).toBe(0n);
      expect(invoice.taxablePaise + invoice.cgstPaise + invoice.sgstPaise).toBe(invoice.totalPaise);

      const order = await db().platformOrder.findUniqueOrThrow({ where: { id: out.orderId } });
      expect(order.status).toBe('paid');
      expect(Number(order.discountPaise)).toBe(Math.round(Number(order.listPaise) * 0.15));
      const sub = await db().subscription.findUniqueOrThrow({ where: { tenantId: out.tenantId }, include: { items: true } });
      expect(sub.status).toBe('active');
      expect(sub.currentPeriodEnd).not.toBeNull();
      expect(sub.items.reduce((n, i) => n + i.quantity, 0)).toBe(3); // HR add-on + 2 extra users
      const hr = await db().tenantEntitlement.findUniqueOrThrow({ where: { tenantId_moduleKey: { tenantId: out.tenantId, moduleKey: 'hr' } } });
      expect(hr.status).toBe('active');
    });
  });

  it('a buyer in another state is charged IGST', async () => {
    await rolledBack(async () => {
      const exec = await consoleUser('console_sales');
      const out = await createClient(exec, newClient(0, '27'));
      const order = await db().platformOrder.findUniqueOrThrow({ where: { id: out.orderId } });
      expect(order.cgstPaise).toBe(0n);
      expect(Number(order.igstPaise)).toBe(Math.round(Number(order.taxablePaise) * 0.18));
    });
  });

  it('extra users raise the user limit only while paying (or buying)', () => {
    const base = { users: 5, branches: 1, contacts: null, items: null, invoicesPerMonth: null, storageMb: 1, aiCredits: 0 };
    expect(withExtraUsers(base, 2, 'active').users).toBe(7);
    expect(withExtraUsers(base, 2, 'incomplete').users).toBe(7);
    expect(withExtraUsers(base, 2, 'free').users).toBe(5);
  });
});
