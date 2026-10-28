import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { prisma, db, withPlatform } from '../kernel/db';
import type { ConsoleCtx } from '../kernel/context';
import { consoleHome } from '../modules/console/insights';
import { addNote, closeFollowup, createProspect, listNotes, listProspects, updateProspect } from '../modules/console/sales';
import { changePartnerClientPlan, createPartner, createPartnerClient, partnerBill } from '../modules/console/partners';
import { myReferral, referralAcquisition } from '../modules/console/referral';
import { capturePayment, convertClient } from '../modules/platformBilling/service';
import { listClients } from '../modules/console/clients';
import { cache } from '../kernel/cache';

// Console rework: leads, Convert to paid, client filters, partners (isolation, bill, billing jobs),
// referral codes and the role-aware Home. Database tests run in a transaction that is rolled back.

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

async function consoleUser(roleKey: string, scope: ConsoleCtx['scope'] = 'all', reportsTo: string | null = null, partnerId: string | null = null): Promise<ConsoleCtx> {
  const n = String(Math.floor(Math.random() * 1e9)).padStart(9, '0');
  const user = await db().user.create({ data: { name: `Step4 ${roleKey}`, email: `step4-${n}@example.test`, mobile: `+918${n}` } });
  const rid = await roleId(roleKey);
  const member = await db().platformMember.create({ data: { userId: user.id, roleId: rid, reportsTo, partnerId } });
  return { kind: 'platform', userId: user.id, memberId: member.id, roleId: rid, sessionId: randomUUID(), scope, partnerId };
}

const mobile = () => `9${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;

describe('Sales workspace', () => {
  it('a new prospect gets a first-call follow-up and a mobile can be used only once', async () => {
    await rolledBack(async () => {
      const exec = await consoleUser('console_sales_executive', 'own');
      const m = mobile();
      const p = await createProspect(exec, { name: 'Asha Rao', businessName: 'Rao Salon', mobile: `+91${m}` });
      expect(await db().consoleFollowup.count({ where: { prospectId: p.id, doneAt: null } })).toBe(1);
      await expect(createProspect(exec, { name: 'Other', businessName: 'Other Salon', mobile: `+91${m}` })).rejects.toMatchObject({ code: 'CONFLICT' });
    });
  });

  it('lost needs a reason; won or lost closes open follow-ups', async () => {
    await rolledBack(async () => {
      const exec = await consoleUser('console_sales_executive', 'own');
      const p = await createProspect(exec, { name: 'Ravi', businessName: 'Ravi Traders' });
      await expect(updateProspect(exec, p.id, { stage: 'lost' })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
      await updateProspect(exec, p.id, { stage: 'lost', lostReason: 'Went with a local vendor' });
      expect(await db().consoleFollowup.count({ where: { prospectId: p.id, doneAt: null } })).toBe(0);
    });
  });

  it('an executive sees only their own prospects; a manager sees the team', async () => {
    await rolledBack(async () => {
      const mgr = await consoleUser('console_sales_manager', 'team');
      const a = await consoleUser('console_sales_executive', 'own', mgr.userId);
      const b = await consoleUser('console_sales_executive', 'own', mgr.userId);
      const pa = await createProspect(a, { name: 'A', businessName: 'Alpha Shop' });
      await createProspect(b, { name: 'B', businessName: 'Beta Shop' });
      expect((await listProspects(a, {})).some((p: { id: string }) => p.id === pa.id)).toBe(true);
      expect((await listProspects(b, {})).some((p: { id: string }) => p.id === pa.id)).toBe(false);
      await expect(updateProspect(b, pa.id, { stage: 'contacted' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect((await listProspects({ ...mgr, scope: 'team' }, {})).filter((p: { businessName: string }) => ['Alpha Shop', 'Beta Shop'].includes(p.businessName))).toHaveLength(2);
      const f = await db().consoleFollowup.findFirstOrThrow({ where: { prospectId: pa.id } });
      await expect(closeFollowup(b, f.id, { done: true })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  it('a note private to the team is hidden from other teams', async () => {
    await rolledBack(async () => {
      const tenant = await db().tenant.findFirstOrThrow({ where: { isInternal: false } });
      const mgr1 = await consoleUser('console_sales_manager', 'team');
      const mgr2 = await consoleUser('console_sales_manager', 'team');
      await addNote(mgr1, tenant.id, { body: 'Owner prefers calls after 6 pm', privateToTeam: true });
      expect((await listNotes(mgr1, tenant.id)).some((n) => n.body.startsWith('Owner prefers'))).toBe(true);
      expect((await listNotes(mgr2, tenant.id)).some((n) => n.body.startsWith('Owner prefers'))).toBe(false);
      const ops = await consoleUser('platform_ops', 'all');
      expect((await listNotes(ops, tenant.id)).some((n) => n.body.startsWith('Owner prefers'))).toBe(true);
    });
  });
});

describe('Convert to paid', () => {
  it('makes an order for a trial client, refuses a second one, and payment makes it paying', async () => {
    const seller = { legalName: 'AHEAD Test', gstin: '09AAAAA0000A1Z0', stateCode: '09', address: 'Noida', sac: '998314', gstRateBp: 1800 };
    cache.del('settings:platform');
    await cache.getOrSet('settings:platform', async () => new Map([['ahead.billing', { value: seller, version: 1 }]]), 60_000);
    try {
      await rolledBack(async () => {
        const tenant = await db().tenant.findFirst({ where: { status: 'trialing', isInternal: false, billingStateCode: { not: null } } });
        if (!tenant) return;
        await db().platformOrder.updateMany({ where: { tenantId: tenant.id, status: { in: ['awaiting_payment', 'pending_approval'] } }, data: { status: 'cancelled' } });
        const admin = await consoleUser('super_admin');
        const order = await convertClient(admin, tenant.id, { planKey: 'starter', cycle: 'monthly', addOns: [], extraUsers: 0, discountPercent: 0 });
        expect(order.status).toBe('awaiting_payment');
        await expect(convertClient(admin, tenant.id, { planKey: 'starter', cycle: 'monthly', addOns: [], extraUsers: 0, discountPercent: 0 })).rejects.toMatchObject({ code: 'CONFLICT' });
        await capturePayment(order.orderId, { method: 'upi', amountPaise: order.totalPaise, reference: 'UTR123', receivedAt: new Date(), recordedBy: admin.userId });
        expect((await db().tenant.findUniqueOrThrow({ where: { id: tenant.id } })).status).toBe('active');
        await expect(convertClient(admin, tenant.id, { planKey: 'starter', cycle: 'monthly', addOns: [], extraUsers: 0, discountPercent: 0 })).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
      });
    } finally {
      cache.del('settings:platform');
    }
  });
});

describe('Clients list filters', () => {
  it('the owner filter never shows clients outside your scope', async () => {
    await rolledBack(async () => {
      const tenant = await db().tenant.findFirstOrThrow({ where: { isInternal: false } });
      const other = await consoleUser('console_sales_executive', 'own');
      const me = await consoleUser('console_sales_executive', 'own');
      await db().tenantAcquisition.update({ where: { tenantId: tenant.id }, data: { acquiredByType: 'sales_user', acquiredByUserId: other.userId, method: 'manual' } });
      expect((await listClients(other, { ownerId: other.userId, limit: 50 })).data.map((c) => c.id)).toContain(tenant.id);
      expect((await listClients(me, { ownerId: other.userId, limit: 50 })).data).toHaveLength(0);
    });
  });
});

describe('Partners', () => {
  const owner = () => {
    const m = mobile();
    return { name: 'Kiran Shah', email: `p4-${m}@example.test`, mobile: `+91${m}` };
  };
  async function newPartner(admin: ConsoleCtx, name: string, discountPercent = 25) {
    const contact = owner();
    const { id } = await createPartner(admin, { name, contactName: contact.name, email: contact.email, mobile: contact.mobile, discountPercent });
    const member = await db().platformMember.findFirstOrThrow({ where: { partnerId: id } });
    const role = await db().role.findUniqueOrThrow({ where: { id: member.roleId } });
    expect(role.key).toBe('partner_admin');
    const ctx: ConsoleCtx = { kind: 'platform', userId: member.userId, memberId: member.id, roleId: member.roleId, sessionId: randomUUID(), scope: 'all', partnerId: id };
    return { id, ctx };
  }
  const industry = async () => (await db().tenant.findFirstOrThrow({ where: { isInternal: false } })).industryKey;

  it('a partner client goes live at once, billed to the partner, outside AHEAD renewals', async () => {
    await rolledBack(async () => {
      const admin = await consoleUser('super_admin');
      const p = await newPartner(admin, `Acme Resellers ${mobile()}`, 25);
      const { tenantId } = await createPartnerClient(p.ctx, { business: { name: 'Acme Client One', industryKey: await industry(), stateCode: '27' }, owner: owner(), planKey: 'starter', cycle: 'monthly' });
      const t = await db().tenant.findUniqueOrThrow({ where: { id: tenantId }, include: { subscription: true } });
      expect(t).toMatchObject({ status: 'active', source: 'partner', billingOwner: 'partner', partnerId: p.id });
      expect(t.subscription?.currentPeriodEnd).toBeNull();
      // Renewal and dunning jobs only pick AHEAD-billed subscriptions
      expect(await db().subscription.count({ where: { tenantId, tenant: { billingOwner: 'self' } } })).toBe(0);

      const list = await db().price.findFirstOrThrow({ where: { itemType: 'plan', itemRef: 'starter', cycle: 'monthly', activeTo: null } });
      const bill = await partnerBill(p.id);
      expect(bill.lines).toHaveLength(1);
      expect(bill.lines[0].chargePaise).toBe(Math.round(Number(list.amountPaise) * 0.75));
      expect(bill.totalPaise).toBe(bill.subtotalPaise + bill.gstPaise);

      await changePartnerClientPlan(p.ctx, tenantId, 'growth');
      expect((await partnerBill(p.id)).lines[0].plan).not.toBe(bill.lines[0].plan);
    });
  });

  it('partner people see only their own clients; AHEAD sees all of them', async () => {
    await rolledBack(async () => {
      const admin = await consoleUser('super_admin');
      const a = await newPartner(admin, `Alpha Partners ${mobile()}`);
      const b = await newPartner(admin, `Beta Partners ${mobile()}`);
      const industryKey = await industry();
      const { tenantId } = await createPartnerClient(a.ctx, { business: { name: 'Alpha Client', industryKey, stateCode: '27' }, owner: owner(), planKey: 'starter', cycle: 'monthly' });
      const ids = async (ctx: ConsoleCtx) => (await listClients(ctx, { limit: 200 })).data.map((c) => c.id);
      expect(await ids(a.ctx)).toEqual([tenantId]);
      expect(await ids(b.ctx)).toEqual([]);
      expect(await ids(admin)).toContain(tenantId);
      await expect(changePartnerClientPlan(b.ctx, tenantId, 'growth')).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(createPartnerClient(admin, { business: { name: 'X Client', industryKey, stateCode: '27' }, owner: owner(), planKey: 'starter', cycle: 'monthly' })).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    });
  });

  it('a paused partner cannot add clients', async () => {
    await rolledBack(async () => {
      const admin = await consoleUser('super_admin');
      const p = await newPartner(admin, `Paused Partners ${mobile()}`);
      await db().partner.update({ where: { id: p.id }, data: { status: 'paused' } });
      await expect(createPartnerClient(p.ctx, { business: { name: 'Nope Client', industryKey: await industry(), stateCode: '27' }, owner: owner(), planKey: 'starter', cycle: 'monthly' })).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    });
  });

  it('the partner Home shows its clients and this month’s bill', async () => {
    await rolledBack(async () => {
      const admin = await consoleUser('super_admin');
      const p = await newPartner(admin, `Home Partners ${mobile()}`);
      const home = await consoleHome(p.ctx, 'partner', { discount: false, income: false, payments: false, leads: false });
      expect(home.stats.map((s) => s.key)).toEqual(['clients', 'live', 'bill']);
      expect(home.income).toBeNull();
      expect(home.referral).toBeNull();
    });
  });
});

describe('Referral codes', () => {
  it('a vendor gets a code once, and a signup with it is credited to them', async () => {
    await rolledBack(async () => {
      const vendor = await consoleUser('vendor', 'own');
      const first = await myReferral(vendor);
      expect(first.code).toMatch(/^[A-Z]{1,6}\d{3}$/);
      expect(first.link).toContain(`/signup?ref=${first.code}`);
      expect((await myReferral(vendor)).code).toBe(first.code);
      expect(await referralAcquisition(first.code.toLowerCase(), 'link')).toMatchObject({ byType: 'vendor', byUserId: vendor.userId, method: 'referral_link' });
      expect(await referralAcquisition('NOPE000', 'code')).toBeNull();
      const support = await consoleUser('platform_support');
      await expect(myReferral(support)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    });
  });

  it('a vendor Home shows their link, not AHEAD’s income', async () => {
    await rolledBack(async () => {
      const vendor = await consoleUser('vendor', 'own');
      const home = await consoleHome(vendor, 'vendor', { discount: false, income: false, payments: true, leads: false });
      expect(home.referral?.code).toBeTruthy();
      expect(home.stats.some((s) => s.key === 'income')).toBe(false);
      expect(home.stats[0].key).toBe('clients');
    });
  });
});
