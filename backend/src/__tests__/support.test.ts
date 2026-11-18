import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { prisma, db, withPlatform } from '../kernel/db';
import type { TenantCtx } from '../kernel/context';
import * as sp from '../modules/support/service';

class Rollback extends Error {}
async function rolledBack(fn: () => Promise<void>) {
  try {
    await withPlatform(async () => { await fn(); throw new Rollback(); }, { kind: 'platform' }, { timeoutMs: 120_000 });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
}
afterAll(() => prisma.$disconnect());

const HOUR = 3_600_000;

async function prepare() {
  const n = String(Math.floor(Math.random() * 1e9)).padStart(9, '0');
  const owner = await db().user.create({ data: { name: 'Owner', email: `sp-${n}@example.test`, mobile: `+917${n}` } });
  const agent = await db().user.create({ data: { name: 'Agent', email: `spa-${n}@example.test`, mobile: `+918${n}` } });
  const tenant = await db().tenant.create({ data: { name: `SP ${n}`, industryKey: 'general', templateVersion: 1, ownerUserId: owner.id, billingStateCode: '09' } });
  const roleId = (await prisma.role.findFirstOrThrow({ where: { key: 'owner', tenantId: null }, select: { id: true } })).id;
  const m = await db().tenantMember.create({ data: { tenantId: tenant.id, userId: owner.id, roleId, status: 'active' } });
  await db().tenantMember.create({ data: { tenantId: tenant.id, userId: agent.id, roleId, status: 'active' } });
  const ctx: TenantCtx = { kind: 'tenant', tenantId: tenant.id, userId: owner.id, memberId: m.id, roleId, sessionId: randomUUID(), branchIds: [], scope: 'all' };
  return { ctx, tenantId: tenant.id, owner, agent };
}

describe('customer service', () => {
  it('numbers tickets, sets SLA times by priority, assigns in turn and runs a ticket to the end', async () => {
    await rolledBack(async () => {
      const { ctx, owner, agent } = await prepare();
      await sp.saveSettings(ctx, sp.SettingsInput.parse({ ...(await sp.getSettings(ctx)), autoAssign: 'round_robin', formEnabled: false, slug: null }));
      const a = await sp.createTicket(ctx, sp.TicketInput.parse({ subject: 'Fan noise', guestName: 'Ravi', guestPhone: '9876500001', priority: 'urgent', category: 'repair' }));
      const b = await sp.createTicket(ctx, sp.TicketInput.parse({ subject: 'Bill wrong', guestName: 'Sita', guestPhone: '9876500002', category: 'billing' }));
      expect([a.number, b.number]).toEqual(['TKT-0001', 'TKT-0002']);
      // Urgent: reply in 1 h, fix in 8 h
      expect(a.firstResponseDue!.getTime() - a.createdAt.getTime()).toBeCloseTo(HOUR, -3);
      expect(a.resolveDue!.getTime() - a.createdAt.getTime()).toBeCloseTo(8 * HOUR, -3);
      // In turn: two different people, status open once someone has it
      expect(new Set([a.assigneeId, b.assigneeId])).toEqual(new Set([owner.id, agent.id]));
      expect(a.status).toBe('open');
      await expect(sp.createTicket(ctx, sp.TicketInput.parse({ subject: 'Who?', guestName: 'Xavier', guestPhone: '9876500003', category: 'nope' }))).rejects.toThrow('category');

      // A late one shows as late
      await db().supportTicket.update({ where: { id: b.id }, data: { firstResponseDue: new Date(Date.now() - HOUR) } });
      let list = await sp.listTickets(ctx, sp.TicketList.parse({ view: 'open' }));
      expect(list.counts).toMatchObject({ open: 2, overdue: 1 });
      expect(list.data[0].id).toBe(b.id);

      // The first reply stops the reply clock; resolving needs what was done
      await sp.reply(ctx, b.id, sp.ReplyInput.parse({ body: 'Checking your bill now' }));
      const t = await db().supportTicket.findUniqueOrThrow({ where: { id: b.id } });
      expect(t.firstResponseAt).not.toBeNull();
      await expect(sp.updateTicket(ctx, b.id, sp.TicketPatch.parse({ status: 'resolved', version: t.version }))).rejects.toThrow('what was done');
      const done = await sp.updateTicket(ctx, b.id, sp.TicketPatch.parse({ status: 'resolved', resolution: 'Sent a corrected bill', version: t.version }));
      expect(done.resolvedAt).not.toBeNull();
      const back = await sp.updateTicket(ctx, b.id, sp.TicketPatch.parse({ status: 'open', version: done.version }));
      expect(back.reopened).toBe(1);
      expect(back.resolvedAt).toBeNull();
      list = await sp.listTickets(ctx, sp.TicketList.parse({ view: 'all' }));
      expect(list.sums.avgFirstMin).not.toBeNull();
    });
  });

  it('takes a request on the public form, links the customer, hides notes and takes one rating', async () => {
    await rolledBack(async () => {
      const { ctx, tenantId } = await prepare();
      const customer = await db().contact.create({ data: { tenantId, type: 'customer', name: 'Meena', phone: '9876501234' } });
      const slug = `sp-${Date.now()}`;
      await sp.saveSettings(ctx, sp.SettingsInput.parse({ ...(await sp.getSettings(ctx)), formEnabled: true, slug }));
      const form = await sp.publicForm(slug);
      expect(form.categories.length).toBeGreaterThan(3);
      const made = await sp.publicCreate(slug, sp.PublicTicketInput.parse({ name: 'Meena', phone: '9876501234', category: 'complaint', subject: 'Mixer not working', description: 'Stopped after one week of use', invoiceNumber: 'NOPE-1' }));
      const t = await db().supportTicket.findFirstOrThrow({ where: { number: made.number, tenantId } });
      expect(t.contactId).toBe(customer.id);
      expect(t.channel).toBe('web');

      await sp.reply(ctx, t.id, sp.ReplyInput.parse({ body: 'Inside only', kind: 'note' }));
      await sp.reply(ctx, t.id, sp.ReplyInput.parse({ body: 'A technician will visit tomorrow' }));
      let seen = await sp.publicTicket(made.token);
      expect(seen.messages.map((m) => m.body)).toContain('A technician will visit tomorrow');
      expect(seen.messages.map((m) => m.body)).not.toContain('Inside only');
      expect(seen.canRate).toBe(false);
      await expect(sp.publicRate(made.token, { rating: 5 })).rejects.toThrow('once the request is resolved');

      const now = await db().supportTicket.findUniqueOrThrow({ where: { id: t.id } });
      await sp.updateTicket(ctx, t.id, sp.TicketPatch.parse({ status: 'resolved', resolution: 'Replaced the motor', version: now.version }));
      seen = await sp.publicRate(made.token, { rating: 4, feedback: 'Quick' });
      expect(seen.rating).toBe(4);
      await expect(sp.publicRate(made.token, { rating: 5 })).rejects.toThrow('already rated');
      // A reply on a resolved request brings it back
      await sp.publicReply(made.token, { body: 'It stopped again' });
      expect((await db().supportTicket.findUniqueOrThrow({ where: { id: t.id } })).status).toBe('open');
    });
  });

  it('works out the warranty from the sale of the serial number', async () => {
    await rolledBack(async () => {
      const { ctx, tenantId } = await prepare();
      const item = await db().item.create({ data: { tenantId, type: 'product', name: 'Mixer', pricePaise: 300_000n, gstRateBp: 1800 } });
      const loc = await db().stockLocation.create({ data: { tenantId, name: 'Shop' } });
      const sold = new Date(Date.now() - 100 * 86_400_000);
      await db().stockMove.create({ data: { tenantId, itemId: item.id, locationId: loc.id, moveDate: sold, kind: 'sale', quantity: -1, ratePaise: 200_000n, valuePaise: -200_000n, balanceQty: 0, sourceType: 'invoice', sourceId: randomUUID(), serials: ['MX-001'] } });
      const t = await sp.createTicket(ctx, sp.TicketInput.parse({ subject: 'Mixer broke', guestName: 'Asha', guestPhone: '9876500009', itemId: item.id, serial: 'MX-001' }));
      const got = await sp.getTicket(ctx, t.id);
      expect(got.warranty?.inWarranty).toBe(true);
      expect(got.warranty?.months).toBe(12);
      await sp.saveSettings(ctx, sp.SettingsInput.parse({ ...(await sp.getSettings(ctx)), warrantyMonths: 3, formEnabled: false, slug: null }));
      expect((await sp.getTicket(ctx, t.id)).warranty?.inWarranty).toBe(false);
    });
  });
});
