import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { prisma, db, withPlatform } from '../kernel/db';
import type { TenantCtx } from '../kernel/context';
import * as portal from '../modules/portal/service';

class Rollback extends Error {}
async function rolledBack(fn: () => Promise<void>) {
  try {
    await withPlatform(async () => { await fn(); throw new Rollback(); }, { kind: 'platform' }, { timeoutMs: 120_000 });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
}
afterAll(() => prisma.$disconnect());

async function prepare() {
  const n = String(Math.floor(Math.random() * 1e9)).padStart(9, '0');
  const owner = await db().user.create({ data: { name: 'Owner', email: `pt-${n}@example.test`, mobile: `+917${n}` } });
  const tenant = await db().tenant.create({ data: { name: `PT ${n}`, industryKey: 'general', templateVersion: 1, ownerUserId: owner.id, billingStateCode: '09' } });
  const roleId = (await prisma.role.findFirstOrThrow({ where: { key: 'owner', tenantId: null }, select: { id: true } })).id;
  const m = await db().tenantMember.create({ data: { tenantId: tenant.id, userId: owner.id, roleId, status: 'active' } });
  const ctx: TenantCtx = { kind: 'tenant', tenantId: tenant.id, userId: owner.id, memberId: m.id, roleId, sessionId: randomUUID(), branchIds: [], scope: 'all' };
  const slug = `pt-${n}`;
  await portal.saveSettings(ctx, portal.SettingsInput.parse({ enabled: true, slug, title: 'Your account', showBills: true, showQuotes: true, allowQuoteReply: true, showStatement: true, showRequests: true, showBookings: true }));
  const meena = await db().contact.create({ data: { tenantId: tenant.id, type: 'customer', name: 'Meena', companyName: 'Meena Stores', phone: '+91 98765 01234' } });
  const other = await db().contact.create({ data: { tenantId: tenant.id, type: 'customer', name: 'Other', phone: '9000000002' } });
  const doc = (contactId: string, kind: 'invoice' | 'quotation', status: string, total: bigint, paid = 0n, due?: string) =>
    db().salesDocument.create({ data: { tenantId: tenant.id, contactId, kind, status: status as never, number: `${kind === 'invoice' ? 'INV' : 'QT'}-${randomUUID().slice(0, 6)}`, issueDate: new Date('2026-11-01T00:00:00Z'), dueDate: due ? new Date(`${due}T00:00:00Z`) : null, buyer: {}, seller: {}, totalPaise: total, paidPaise: paid, subtotalPaise: total, taxablePaise: total } as never });
  return { ctx, tenant, slug, meena, other, doc };
}
const signIn = async (ctx: TenantCtx, slug: string, contactId: string) => {
  const { url } = await portal.portalLink(ctx, contactId);
  const r = await portal.linkSignIn(slug, { token: new URL(url).searchParams.get('t')! });
  return (cid = contactId) => portal.session(slug, r.token, cid);
};

describe('customer portal', () => {
  it("shows a customer their own dues and bills, and nobody else's", async () => {
    await rolledBack(async () => {
      const { ctx, slug, meena, other, doc } = await prepare();
      await doc(meena.id, 'invoice', 'issued', 100_000n, 0n, '2026-01-01');
      await doc(meena.id, 'invoice', 'partially_paid', 50_000n, 20_000n, '2099-01-01');
      await doc(other.id, 'invoice', 'issued', 999_000n);
      const as = await signIn(ctx, slug, meena.id);
      const home = await portal.home(await as());
      expect(home.dues).toMatchObject({ duePaise: 130_000, overduePaise: 100_000, openBills: 2 });
      const docs = await portal.documents(await as());
      expect(docs.data).toHaveLength(2);
      expect(docs.data.every((d) => d.shareToken)).toBe(true);
      // The sign-in covers only Meena
      await expect(as(other.id)).rejects.toThrow('sign in again');
    });
  });

  it('lets a customer answer a quotation once, raise a request, and stops them when access is off', async () => {
    await rolledBack(async () => {
      const { ctx, slug, meena, doc } = await prepare();
      const q = await doc(meena.id, 'quotation', 'sent', 75_000n, 0n, '2099-12-31');
      const as = await signIn(ctx, slug, meena.id);
      expect(await portal.replyToQuote(await as(), q.id, { decision: 'accepted', note: 'Deliver Monday' })).toEqual({ status: 'accepted' });
      await expect(portal.replyToQuote(await as(), q.id, { decision: 'declined' })).rejects.toThrow('already accepted');
      const r = await portal.raiseRequest(await as(), portal.RequestInput.parse({ category: 'complaint', subject: 'Fan noise', description: 'The fan hums at speed 3' }));
      const t = await db().supportTicket.findFirstOrThrow({ where: { number: r.number, tenantId: ctx.tenantId } });
      expect(t).toMatchObject({ contactId: meena.id, channel: 'web' });
      await portal.setBlocked(ctx, meena.id, true);
      await expect(as()).rejects.toThrow('turned off');
    });
  });

  it('finds customers by mobile however it was typed, and closes with the portal', async () => {
    await rolledBack(async () => {
      const { ctx, slug } = await prepare();
      // "+91 98765 01234" on the record; asking with the 10 digits sends a code (dev returns it)
      const asked = await portal.requestCode(slug, portal.OtpInput.parse({ mobile: '98765-01234' }));
      expect(asked.sent).toBe(true);
      await portal.saveSettings(ctx, portal.SettingsInput.parse({ enabled: false, slug, title: 'Your account', showBills: true, showQuotes: true, allowQuoteReply: true, showStatement: true, showRequests: true, showBookings: true }));
      await expect(portal.publicInfo(slug)).rejects.toThrow('not found');
    });
  });
});
