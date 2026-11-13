import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { prisma, db, withPlatform } from '../kernel/db';
import type { TenantCtx } from '../kernel/context';
import * as crm from '../modules/crm/pipeline';

// CRM: default pipeline, lead stages, lead → deal with products, won/lost, bulk actions, report.

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
  const user = await db().user.create({ data: { name: 'CRM Tester', email: `crm-${n}@example.test`, mobile: `+919${n}` } });
  const tenant = await db().tenant.create({ data: { name: `CRM ${n}`, industryKey: 'general', templateVersion: 1, ownerUserId: user.id, billingStateCode: '09' } });
  await db().tenantMember.create({ data: { tenantId: tenant.id, userId: user.id, status: 'active', roleId: (await prisma.role.findFirstOrThrow({ where: { key: 'owner', tenantId: null } })).id } });
  const roleId = (await prisma.role.findFirstOrThrow({ where: { key: 'owner', tenantId: null }, select: { id: true } })).id;
  const ctx: TenantCtx = { kind: 'tenant', tenantId: tenant.id, userId: user.id, memberId: randomUUID(), roleId, sessionId: randomUUID(), branchIds: [], scope: 'all' };
  const setupData = await crm.getSetup(ctx);
  const place = await crm.resolveStage(ctx, 'lead');
  const lead = await db().contact.create({ data: { tenantId: tenant.id, type: 'lead', name: 'Anita Singh', phone: '9876500011', subject: '20 ceiling fans', leadStatus: 'new', ...place, ownerId: user.id, createdBy: user.id } });
  const fan = await db().item.create({ data: { tenantId: tenant.id, name: 'Ceiling fan', unit: 'pcs', pricePaise: 150_000n, gstRateBp: 1800 } });
  return { ctx, user, setup: setupData, lead, fan };
}

describe('crm pipelines', () => {
  it('makes a default pipeline with lead and deal stages and the usual lists', async () => {
    await rolledBack(async () => {
      const { setup } = await prepare();
      expect(setup.pipelines).toHaveLength(1);
      expect(setup.pipelines[0].leadStages.map((s) => s.name)).toEqual(['New', 'Contacted', 'Interested', 'Qualified']);
      expect(setup.pipelines[0].dealStages[0].probability).toBe(20);
      expect(setup.sources.length).toBeGreaterThan(5);
      expect(setup.lostReasons.length).toBeGreaterThan(3);
    });
  });

  it('moves a lead, converts it to a deal with its products, and wins the deal', async () => {
    await rolledBack(async () => {
      const { ctx, setup, lead, fan } = await prepare();
      const qualified = setup.pipelines[0].leadStages[3];
      const moved = await crm.moveLead(ctx, lead.id, qualified.id);
      expect(moved.stageId).toBe(qualified.id);
      await crm.setProducts(ctx, { contactId: lead.id }, { items: [{ itemId: fan.id, quantity: 20, pricePaise: 150_000 }] });
      expect((await db().contact.findUniqueOrThrow({ where: { id: lead.id } })).valuePaise).toBe(3_000_000n);

      // Making a customer needs the state
      await expect(crm.convertLeadToDeal(ctx, lead.id, crm.ConvertInput.parse({ title: 'Fans for Anita', makeCustomer: true }))).rejects.toThrow('state');
      const deal = await crm.convertLeadToDeal(ctx, lead.id, crm.ConvertInput.parse({ title: 'Fans for Anita', valuePaise: 3_000_000, makeCustomer: true, stateCode: '09' }));
      expect(deal.stageId).toBe(setup.pipelines[0].dealStages[0].id);
      const after = await db().contact.findUniqueOrThrow({ where: { id: lead.id } });
      expect(after).toMatchObject({ type: 'customer', leadStatus: 'converted', stateCode: '09' });
      expect(await crm.productsOf(ctx, { dealId: deal.id })).toHaveLength(1);
      await expect(crm.convertLeadToDeal(ctx, lead.id, crm.ConvertInput.parse({ title: 'Again' }))).rejects.toThrow('already converted');

      const won = await crm.closeDeal(ctx, deal.id, 'won');
      expect(won.status).toBe('won');
      await expect(crm.moveDeal(ctx, deal.id, setup.pipelines[0].dealStages[1].id)).rejects.toThrow('closed');
      expect((await crm.reopenDeal(ctx, deal.id)).status).toBe('open');
      await expect(crm.closeDeal(ctx, deal.id, 'lost')).rejects.toThrow('reason');
      expect((await crm.closeDeal(ctx, deal.id, 'lost', { reason: 'Price too high' })).lostReason).toBe('Price too high');

      const report = await crm.crmReport(ctx);
      expect(report.leads.converted).toBe(1);
      expect(report.deals.lost).toBe(1);
    });
  });

  it('loses and reopens a lead, runs bulk actions, and guards stages in use', async () => {
    await rolledBack(async () => {
      const { ctx, user, setup, lead } = await prepare();
      expect((await crm.loseLead(ctx, lead.id, { reason: 'No budget' })).leadStatus).toBe('lost');
      await expect(crm.moveLead(ctx, lead.id, setup.pipelines[0].leadStages[1].id)).rejects.toThrow('closed');
      expect((await crm.reopenLead(ctx, lead.id)).leadStatus).toBe('new');

      const r = await crm.bulkLeads(ctx, crm.BulkInput.parse({ ids: [lead.id], action: 'label', label: 'Hot' }));
      expect(r.done).toBe(1);
      expect((await db().contact.findUniqueOrThrow({ where: { id: lead.id } })).labels).toEqual(['Hot']);
      await crm.bulkLeads(ctx, crm.BulkInput.parse({ ids: [lead.id], action: 'assign', ownerId: user.id }));

      await expect(crm.deleteStage(ctx, lead.stageId!)).rejects.toThrow('in this stage');
      const extra = await crm.createStage(ctx, crm.StageInput.parse({ pipelineId: setup.pipelines[0].id, kind: 'lead', name: 'Site visit', color: 'amber' }));
      await expect(crm.createStage(ctx, crm.StageInput.parse({ pipelineId: setup.pipelines[0].id, kind: 'lead', name: 'site visit' }))).rejects.toThrow('already exists');
      await crm.deleteStage(ctx, extra.id);
      await expect(crm.deletePipeline(ctx, setup.pipelines[0].id)).rejects.toThrow('at least one');
    });
  });
});
