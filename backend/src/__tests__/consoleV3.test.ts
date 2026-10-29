import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { prisma, db, withPlatform } from '../kernel/db';
import type { ConsoleCtx } from '../kernel/context';
import { cache } from '../kernel/cache';
import { pepperedHash } from '../kernel/crypto';
import { createAccessLink, linkInfo, maskMobile, usableLink, useLink } from '../modules/identity/accessLinks';
import { acquirerType, createClient, quote, welcomePercentFor } from '../modules/platformBilling/service';
import { PLANS, FREE_MODULES } from '../contracts/plans';
import { MODULES } from '../contracts/modules';
import { addMember, resendMemberLink } from '../modules/console/members';

// Console v3: login links (client owners and Console users set their own password),
// trial-or-paid client creation, and automatic "Onboarded by". Runs in a rolled-back transaction.

class Rollback extends Error {}
async function rolledBack(fn: () => Promise<void>) {
  try {
    await withPlatform(async () => { await fn(); throw new Rollback(); }, { kind: 'platform' }, { timeoutMs: 120_000 });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
}

afterAll(() => prisma.$disconnect());

const roleId = async (key: string) => (await db().role.findFirstOrThrow({ where: { tenantId: null, key, layer: { in: ['platform', 'partner'] } } })).id;

async function consoleUser(roleKey: string, scope: ConsoleCtx['scope'] = 'all'): Promise<ConsoleCtx> {
  const n = String(Math.floor(Math.random() * 1e9)).padStart(9, '0');
  const user = await db().user.create({ data: { name: `V3 ${roleKey}`, email: `v3-${n}@example.test`, mobile: `+918${n}` } });
  const rid = await roleId(roleKey);
  const member = await db().platformMember.create({ data: { userId: user.id, roleId: rid } });
  return { kind: 'platform', userId: user.id, memberId: member.id, roleId: rid, sessionId: randomUUID(), scope, partnerId: null };
}

const owner = () => {
  const m = `9${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;
  return { name: 'Sunil Patel', email: `v3o-${m}@example.test`, mobile: `+91${m}` };
};
const business = { name: 'Om Sai Hardware', industryKey: 'retail', stateCode: '23' };
const tokenOf = (url: string) => url.split('/start/')[1];

describe('login links', () => {
  it('masks the mobile and treats Onboarded by as the creator', () => {
    expect(maskMobile('+919754088990')).toBe('97xxxxx990');
    expect(acquirerType('vendor')).toBe('vendor');
    expect(acquirerType('console_sales')).toBe('sales_user');
    expect(acquirerType('super_admin')).toBe('sales_user');
  });

  it('a trial client from the Console gets a link; a new link stops the old one; a used link cannot be reused', async () => {
    await rolledBack(async () => {
      const vendor = await consoleUser('vendor', 'own');
      const o = owner();
      const out = await createClient(vendor, { business, owner: o, start: 'trial' });
      expect(out.status).toBe('trialing');
      expect(out.orderId).toBeNull();

      const acq = await db().tenantAcquisition.findUniqueOrThrow({ where: { tenantId: out.tenantId } });
      expect(acq.acquiredByType).toBe('vendor');
      expect(acq.acquiredByUserId).toBe(vendor.userId);
      expect((await db().tenant.findUniqueOrThrow({ where: { id: out.tenantId } })).source).toBe('vendor');

      const first = tokenOf(out.loginLink.url);
      const info = await linkInfo(first);
      expect(info).toMatchObject({ kind: 'client_owner', businessName: business.name, needsPassword: true });
      expect(info.mobile).not.toContain(o.mobile.slice(3, 8));

      const user = await db().user.findUniqueOrThrow({ where: { mobile: o.mobile } });
      const second = await createAccessLink({ kind: 'client_owner', userId: user.id, tenantId: out.tenantId, createdBy: vendor.userId });
      await expect(usableLink(first)).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });

      const link = await usableLink(tokenOf(second.url));
      await useLink(link.id, user.id);
      await expect(usableLink(tokenOf(second.url))).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
      expect((await db().user.findUniqueOrThrow({ where: { id: user.id } })).mobileVerifiedAt).not.toBeNull();
    });
  });

  it('an unknown or expired link is refused', async () => {
    await rolledBack(async () => {
      await expect(usableLink('notarealtoken123')).rejects.toMatchObject({ code: 'NOT_FOUND' });
      const admin = await consoleUser('super_admin');
      const link = await createAccessLink({ kind: 'console_member', userId: admin.userId, createdBy: null });
      await db().accessLink.update({ where: { tokenHash: pepperedHash(tokenOf(link.url)) }, data: { expiresAt: new Date(Date.now() - 1000) } });
      await expect(usableLink(tokenOf(link.url))).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
    });
  });

  it('a paid client gets an order and a link; sales are credited automatically', async () => {
    const seller = { legalName: 'AHEAD Test', gstin: '09AAAAA0000A1Z0', stateCode: '09', address: 'Noida', sac: '998314', gstRateBp: 1800 };
    cache.del('settings:platform');
    await cache.getOrSet('settings:platform', async () => new Map([['ahead.billing', { value: seller, version: 1 }]]), 60_000);
    try {
      await rolledBack(async () => {
        const sales = await consoleUser('console_sales', 'own');
        const out = await createClient(sales, { business, owner: owner(), start: 'paid', order: { planKey: 'starter', cycle: 'yearly', addOns: [], extraUsers: 0, discountPercent: 0 } });
        expect(out.orderId).not.toBeNull();
        expect(out.totalPaise).toBeGreaterThan(0);
        expect((await db().tenant.findUniqueOrThrow({ where: { id: out.tenantId } })).status).toBe('incomplete');
        expect((await db().tenantAcquisition.findUniqueOrThrow({ where: { tenantId: out.tenantId } })).acquiredByType).toBe('sales_user');
        expect(await db().accessLink.count({ where: { tenantId: out.tenantId, kind: 'client_owner' } })).toBe(1);
        await expect(createClient(sales, { business, owner: owner(), start: 'paid' })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
      });
    } finally {
      cache.del('settings:platform');
    }
  });

  it('a new Console user gets a link and can be sent a fresh one', async () => {
    await rolledBack(async () => {
      const admin = await consoleUser('super_admin');
      const o = owner();
      const added = await addMember(admin, { email: o.email, name: o.name, mobile: o.mobile, roleKey: 'console_staff' });
      expect(added.loginLink.url).toContain('/start/');
      expect((await linkInfo(tokenOf(added.loginLink.url))).kind).toBe('console_member');
      const again = await resendMemberLink(admin, added.id);
      await expect(usableLink(tokenOf(added.loginLink.url))).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
      expect((await usableLink(tokenOf(again.url))).kind).toBe('console_member');
    });
  });
});

describe('pricing option A and one discount per order', () => {
  it('every paid plan includes the Free modules, and only those are free-tier', () => {
    expect(PLANS.map((p) => p.key)).toEqual(['free', 'standard', 'professional', 'enterprise']);
    for (const p of PLANS.filter((x) => x.key !== 'free')) for (const m of FREE_MODULES) expect(p.fullModules).toContain(m);
    expect(MODULES.filter((m) => m.freeTier).map((m) => m.key).sort()).toEqual([...FREE_MODULES].sort());
  });

  it('a coupon and a manual discount cannot be combined; the welcome discount needs neither and no approval', async () => {
    const seller = { legalName: 'AHEAD Test', gstin: '09AAAAA0000A1Z0', stateCode: '09', address: 'Noida', sac: '998314', gstRateBp: 1800 };
    cache.del('settings:platform');
    await cache.getOrSet('settings:platform', async () => new Map([['ahead.billing', { value: seller, version: 1 }]]), 60_000);
    try {
      await rolledBack(async () => {
        const base = { planKey: 'standard', cycle: 'monthly' as const, addOns: [], extraUsers: 0, billTo: { name: 'X', stateCode: '09' } };
        await expect(quote({ ...base, discountPercent: 5, couponCode: 'ANY' })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
        const welcome = await quote({ ...base, discountPercent: 0 }, { actorRoleKey: 'vendor', welcomePercent: 10 });
        expect(welcome.welcomePercent).toBe(10);
        expect(welcome.discountPaise).toBe(Math.round(welcome.listPaise / 10));
        expect(welcome.needsApproval).toBe(false);
        const manual = await quote({ ...base, discountPercent: 3 }, { actorRoleKey: 'vendor', welcomePercent: 10 });
        expect(manual.welcomePercent).toBe(0);

        const vendor = await consoleUser('vendor', 'own');
        const out = await createClient(vendor, { business, owner: owner(), start: 'trial' });
        expect(await welcomePercentFor(out.tenantId)).toBe(0);
        await db().tenantAcquisition.update({ where: { tenantId: out.tenantId }, data: { method: 'referral_code', referralCode: 'TEST123' } });
        expect(await welcomePercentFor(out.tenantId)).toBe(10);
      });
    } finally {
      cache.del('settings:platform');
    }
  });
});
