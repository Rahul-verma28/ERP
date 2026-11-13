import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { db } from '../../kernel/db';
import { AppError, notFound } from '../../kernel/errors';
import type { TenantCtx } from '../../kernel/context';
import { dateOnly, todayIST } from '../../kernel/gst';
import { DateStr, Paise, inScope, scopeWhere } from '../../kernel/query';
import { audit } from '../audit/service';
import { notify } from '../notifications/service';

// CRM pipelines: each pipeline has its own lead stages and deal stages. Leads move through lead
// stages until they become a deal (or a customer, or are lost); deals move until won or lost.
// The business keeps its own lists of sources, labels and lost reasons.

export const STAGE_COLORS = ['slate', 'blue', 'violet', 'amber', 'orange', 'emerald', 'rose', 'cyan'] as const;
export type OptionKind = 'source' | 'label' | 'lost_reason';

const DEFAULT_LEAD_STAGES = [['New', 'slate'], ['Contacted', 'blue'], ['Interested', 'violet'], ['Qualified', 'emerald']] as const;
const DEFAULT_DEAL_STAGES = [['Requirement', 'blue', 20], ['Quotation sent', 'violet', 40], ['Negotiation', 'amber', 70], ['Ready to close', 'emerald', 90]] as const;
const DEFAULT_OPTIONS: Record<OptionKind, string[]> = {
  source: ['Walk-in', 'Phone call', 'WhatsApp', 'Website', 'Referral', 'IndiaMART', 'JustDial', 'Instagram', 'Facebook', 'Google', 'Exhibition', 'Other'],
  label: ['Hot', 'Warm', 'Cold', 'VIP', 'Bulk order'],
  lost_reason: ['Price too high', 'Bought from someone else', 'No budget', 'Not reachable', 'Not interested now', 'Other'],
};
const LABEL_COLORS: Record<string, string> = { Hot: 'rose', Warm: 'amber', Cold: 'cyan', VIP: 'violet', 'Bulk order': 'emerald' };

export const LEAD_OWNER = { owner: ['createdBy', 'ownerId'], branch: 'branchId' };
export const DEAL_OWNER = { owner: ['createdBy', 'ownerId'] };

/** The business's first pipeline, stages and lists, made the first time CRM is opened. */
export async function ensureSetup(ctx: Pick<TenantCtx, 'tenantId'>) {
  const pipeline = await db().crmPipeline.findFirst({ where: { tenantId: ctx.tenantId }, orderBy: [{ isDefault: 'desc' }, { position: 'asc' }] });
  if (pipeline) {
    await placeLooseLeads(ctx.tenantId, pipeline.id);
    return pipeline;
  }
  const created = await db().crmPipeline.create({ data: { tenantId: ctx.tenantId, name: 'Sales', isDefault: true } });
  await db().crmStage.createMany({
    data: [
      ...DEFAULT_LEAD_STAGES.map(([name, color], i) => ({ tenantId: ctx.tenantId, pipelineId: created.id, kind: 'lead', name, color, position: i })),
      ...DEFAULT_DEAL_STAGES.map(([name, color, probability], i) => ({ tenantId: ctx.tenantId, pipelineId: created.id, kind: 'deal', name, color, position: i, probability })),
    ],
  });
  if (!(await db().crmOption.count({ where: { tenantId: ctx.tenantId } }))) {
    await db().crmOption.createMany({
      data: (Object.entries(DEFAULT_OPTIONS) as [OptionKind, string[]][]).flatMap(([kind, names]) => names.map((name, i) => ({ tenantId: ctx.tenantId, kind, name, position: i, color: kind === 'label' ? (LABEL_COLORS[name] ?? 'slate') : null }))),
      skipDuplicates: true,
    });
  }
  await placeLooseLeads(ctx.tenantId, created.id);
  return created;
}

/** Leads from before pipelines (or added by older screens) go in the default pipeline, at the stage their status matches */
async function placeLooseLeads(tenantId: string, pipelineId: string) {
  const loose = await db().contact.count({ where: { tenantId, type: 'lead', pipelineId: null } });
  if (!loose) return;
  const stages = await db().crmStage.findMany({ where: { tenantId, pipelineId, kind: 'lead' }, orderBy: { position: 'asc' } });
  if (!stages.length) return;
  const at = (i: number) => stages[Math.min(i, stages.length - 1)].id;
  for (const [status, i] of [['new', 0], ['contacted', 1], ['qualified', 3], ['lost', 0], ['converted', 3]] as const) {
    await db().contact.updateMany({ where: { tenantId, type: 'lead', pipelineId: null, leadStatus: status }, data: { pipelineId, stageId: at(i) } });
  }
  await db().contact.updateMany({ where: { tenantId, type: 'lead', pipelineId: null }, data: { pipelineId, stageId: at(0) } });
}

export async function getSetup(ctx: TenantCtx) {
  await ensureSetup(ctx);
  const [pipelines, stages, options] = await Promise.all([
    db().crmPipeline.findMany({ where: { tenantId: ctx.tenantId }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] }),
    db().crmStage.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { position: 'asc' } }),
    db().crmOption.findMany({ where: { tenantId: ctx.tenantId }, orderBy: [{ position: 'asc' }, { name: 'asc' }] }),
  ]);
  return {
    pipelines: pipelines.map((p) => ({ ...p, leadStages: stages.filter((s) => s.pipelineId === p.id && s.kind === 'lead'), dealStages: stages.filter((s) => s.pipelineId === p.id && s.kind === 'deal') })),
    sources: options.filter((o) => o.kind === 'source'),
    labels: options.filter((o) => o.kind === 'label'),
    lostReasons: options.filter((o) => o.kind === 'lost_reason'),
  };
}

/** The pipeline and stage a lead or deal goes in: the given ones (checked) or the default's first stage. */
export async function resolveStage(ctx: TenantCtx, kind: 'lead' | 'deal', pipelineId?: string | null, stageId?: string | null) {
  if (stageId) {
    const stage = await db().crmStage.findFirst({ where: { id: stageId, tenantId: ctx.tenantId, kind } });
    if (!stage) throw new AppError('VALIDATION_FAILED', 'Choose a stage from the list.', { fields: { stageId: 'Choose a stage' } });
    if (pipelineId && stage.pipelineId !== pipelineId) throw new AppError('VALIDATION_FAILED', 'This stage is in another pipeline.', { fields: { stageId: 'Not in this pipeline' } });
    return { pipelineId: stage.pipelineId, stageId: stage.id };
  }
  const pipeline = pipelineId ? await db().crmPipeline.findFirst({ where: { id: pipelineId, tenantId: ctx.tenantId } }) : await ensureSetup(ctx);
  if (!pipeline) throw new AppError('VALIDATION_FAILED', 'Choose a pipeline from the list.', { fields: { pipelineId: 'Choose a pipeline' } });
  const first = await db().crmStage.findFirst({ where: { tenantId: ctx.tenantId, pipelineId: pipeline.id, kind }, orderBy: { position: 'asc' } });
  if (!first) throw new AppError('CONFLICT', `The pipeline "${pipeline.name}" has no ${kind} stages. Add one in CRM setup.`);
  return { pipelineId: pipeline.id, stageId: first.id };
}

// ── Setup: pipelines, stages, options ──

export const PipelineInput = z.object({ name: z.string().trim().min(2, 'Use at least 2 characters').max(60), isDefault: z.boolean().optional() });

export async function createPipeline(ctx: TenantCtx, input: z.infer<typeof PipelineInput>) {
  await ensureSetup(ctx);
  if (await db().crmPipeline.findFirst({ where: { tenantId: ctx.tenantId, name: { equals: input.name, mode: 'insensitive' } } })) throw new AppError('VALIDATION_FAILED', 'A pipeline with this name already exists.', { fields: { name: 'Already used' } });
  if (input.isDefault) await db().crmPipeline.updateMany({ where: { tenantId: ctx.tenantId }, data: { isDefault: false } });
  const count = await db().crmPipeline.count({ where: { tenantId: ctx.tenantId } });
  const p = await db().crmPipeline.create({ data: { tenantId: ctx.tenantId, name: input.name, isDefault: !!input.isDefault, position: count } });
  // A new pipeline starts with the usual stages, to rename as needed
  await db().crmStage.createMany({
    data: [
      ...DEFAULT_LEAD_STAGES.map(([name, color], i) => ({ tenantId: ctx.tenantId, pipelineId: p.id, kind: 'lead', name, color, position: i })),
      ...DEFAULT_DEAL_STAGES.map(([name, color, probability], i) => ({ tenantId: ctx.tenantId, pipelineId: p.id, kind: 'deal', name, color, position: i, probability })),
    ],
  });
  await audit({ action: 'crm.pipeline.create', entity: 'crm_pipeline', entityId: p.id, after: { name: p.name } });
  return p;
}

export async function updatePipeline(ctx: TenantCtx, id: string, input: Partial<z.infer<typeof PipelineInput>>) {
  const p = await db().crmPipeline.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!p) throw notFound('Pipeline');
  if (input.name && input.name.toLowerCase() !== p.name.toLowerCase() && (await db().crmPipeline.findFirst({ where: { tenantId: ctx.tenantId, name: { equals: input.name, mode: 'insensitive' } } }))) throw new AppError('VALIDATION_FAILED', 'A pipeline with this name already exists.', { fields: { name: 'Already used' } });
  if (input.isDefault) await db().crmPipeline.updateMany({ where: { tenantId: ctx.tenantId }, data: { isDefault: false } });
  return db().crmPipeline.update({ where: { id }, data: { name: input.name, isDefault: input.isDefault || undefined } });
}

export async function deletePipeline(ctx: TenantCtx, id: string) {
  const p = await db().crmPipeline.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!p) throw notFound('Pipeline');
  if ((await db().crmPipeline.count({ where: { tenantId: ctx.tenantId } })) < 2) throw new AppError('CONFLICT', 'Keep at least one pipeline.');
  const [leads, deals] = await Promise.all([db().contact.count({ where: { pipelineId: id } }), db().deal.count({ where: { pipelineId: id } })]);
  if (leads || deals) throw new AppError('CONFLICT', `${leads} lead${leads === 1 ? '' : 's'} and ${deals} deal${deals === 1 ? '' : 's'} are in this pipeline. Move them first.`);
  await db().crmStage.deleteMany({ where: { pipelineId: id } });
  await db().crmPipeline.delete({ where: { id } });
  if (p.isDefault) {
    const next = await db().crmPipeline.findFirst({ where: { tenantId: ctx.tenantId }, orderBy: { position: 'asc' } });
    if (next) await db().crmPipeline.update({ where: { id: next.id }, data: { isDefault: true } });
  }
}

export const StageInput = z.object({
  pipelineId: z.string().uuid(),
  kind: z.enum(['lead', 'deal']),
  name: z.string().trim().min(2, 'Use at least 2 characters').max(40),
  color: z.enum(STAGE_COLORS).default('blue'),
  probability: z.number().int().min(0).max(100).optional().nullable(),
});

export async function createStage(ctx: TenantCtx, input: z.infer<typeof StageInput>) {
  if (!(await db().crmPipeline.findFirst({ where: { id: input.pipelineId, tenantId: ctx.tenantId } }))) throw notFound('Pipeline');
  if (await db().crmStage.findFirst({ where: { pipelineId: input.pipelineId, kind: input.kind, name: { equals: input.name, mode: 'insensitive' } } })) throw new AppError('VALIDATION_FAILED', 'This stage already exists.', { fields: { name: 'Already used' } });
  const position = await db().crmStage.count({ where: { pipelineId: input.pipelineId, kind: input.kind } });
  return db().crmStage.create({ data: { ...input, probability: input.kind === 'deal' ? (input.probability ?? null) : null, tenantId: ctx.tenantId, position } });
}

export async function updateStage(ctx: TenantCtx, id: string, input: { name?: string; color?: string; probability?: number | null }) {
  const s = await db().crmStage.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!s) throw notFound('Stage');
  return db().crmStage.update({ where: { id }, data: { name: input.name, color: input.color, probability: s.kind === 'deal' ? input.probability : undefined } });
}

/** Put a pipeline's stages of one kind in this order */
export async function reorderStages(ctx: TenantCtx, pipelineId: string, kind: 'lead' | 'deal', ids: string[]) {
  const stages = await db().crmStage.findMany({ where: { tenantId: ctx.tenantId, pipelineId, kind } });
  if (stages.length !== ids.length || !stages.every((s) => ids.includes(s.id))) throw new AppError('VALIDATION_FAILED', 'Send every stage of this pipeline once.');
  for (const [i, id] of ids.entries()) await db().crmStage.update({ where: { id }, data: { position: i } });
}

export async function deleteStage(ctx: TenantCtx, id: string) {
  const s = await db().crmStage.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!s) throw notFound('Stage');
  if ((await db().crmStage.count({ where: { pipelineId: s.pipelineId, kind: s.kind } })) < 2) throw new AppError('CONFLICT', 'Keep at least one stage.');
  const used = s.kind === 'lead' ? await db().contact.count({ where: { stageId: id } }) : await db().deal.count({ where: { stageId: id } });
  if (used) throw new AppError('CONFLICT', `${used} ${s.kind === 'lead' ? 'lead' : 'deal'}${used === 1 ? ' is' : 's are'} in this stage. Move ${used === 1 ? 'it' : 'them'} first.`);
  await db().crmStage.delete({ where: { id } });
}

export const OptionInput = z.object({ kind: z.enum(['source', 'label', 'lost_reason']), name: z.string().trim().min(2, 'Use at least 2 characters').max(40), color: z.enum(STAGE_COLORS).optional().nullable() });

export async function createOption(ctx: TenantCtx, input: z.infer<typeof OptionInput>) {
  if (await db().crmOption.findFirst({ where: { tenantId: ctx.tenantId, kind: input.kind, name: { equals: input.name, mode: 'insensitive' } } })) throw new AppError('VALIDATION_FAILED', 'This already exists.', { fields: { name: 'Already used' } });
  const position = await db().crmOption.count({ where: { tenantId: ctx.tenantId, kind: input.kind } });
  return db().crmOption.create({ data: { ...input, color: input.kind === 'label' ? (input.color ?? 'slate') : null, tenantId: ctx.tenantId, position } });
}

export async function updateOption(ctx: TenantCtx, id: string, input: { name?: string; color?: string | null }) {
  const o = await db().crmOption.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!o) throw notFound('Option');
  const row = await db().crmOption.update({ where: { id }, data: { name: input.name, color: o.kind === 'label' ? input.color : undefined } });
  // A renamed source or label is renamed where it is used
  if (input.name && input.name !== o.name) {
    if (o.kind === 'source') {
      await db().contact.updateMany({ where: { tenantId: ctx.tenantId, leadSource: o.name }, data: { leadSource: input.name } });
      await db().deal.updateMany({ where: { tenantId: ctx.tenantId, source: o.name }, data: { source: input.name } });
    }
  }
  return row;
}

export async function deleteOption(ctx: TenantCtx, id: string) {
  const o = await db().crmOption.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!o) throw notFound('Option');
  await db().crmOption.delete({ where: { id } });
}

// ── Lead actions ──

async function lead(ctx: TenantCtx, id: string) {
  const c = await db().contact.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!c || !inScope(ctx, c, LEAD_OWNER) || (c.type !== 'lead' && !c.stageId)) throw notFound('Lead');
  return c;
}

export async function moveLead(ctx: TenantCtx, id: string, stageId: string) {
  const c = await lead(ctx, id);
  if (c.leadStatus === 'converted' || c.leadStatus === 'lost') throw new AppError('CONFLICT', 'This lead is closed. Reopen it first.');
  const where = await resolveStage(ctx, 'lead', null, stageId);
  const stage = await db().crmStage.findUniqueOrThrow({ where: { id: where.stageId } });
  const updated = await db().contact.update({ where: { id }, data: { ...where, leadStatus: 'contacted', version: { increment: 1 } } });
  await db().activity.create({ data: { tenantId: ctx.tenantId, contactId: id, type: 'note', title: `Moved to ${stage.name}`, createdBy: ctx.userId } });
  return updated;
}

export const LostInput = z.object({ reason: z.string().trim().min(2, 'Choose the reason').max(200), note: z.string().trim().max(1000).optional().nullable() });

export async function loseLead(ctx: TenantCtx, id: string, input: z.infer<typeof LostInput>) {
  const c = await lead(ctx, id);
  if (c.leadStatus === 'converted') throw new AppError('CONFLICT', 'This lead is already converted.');
  await db().activity.create({ data: { tenantId: ctx.tenantId, contactId: id, type: 'note', title: `Marked lost: ${input.reason}`, body: input.note ?? null, createdBy: ctx.userId } });
  return db().contact.update({ where: { id }, data: { leadStatus: 'lost', lostReason: input.reason, version: { increment: 1 } } });
}

export async function reopenLead(ctx: TenantCtx, id: string) {
  const c = await lead(ctx, id);
  if (c.leadStatus !== 'lost') throw new AppError('CONFLICT', 'Only a lost lead can be reopened.');
  await db().activity.create({ data: { tenantId: ctx.tenantId, contactId: id, type: 'note', title: 'Reopened', createdBy: ctx.userId } });
  return db().contact.update({ where: { id }, data: { leadStatus: 'new', lostReason: null, version: { increment: 1 } } });
}

export const BulkInput = z.object({
  ids: z.array(z.string().uuid()).min(1, 'Choose at least one lead').max(500),
  action: z.enum(['assign', 'stage', 'label', 'lost', 'delete']),
  ownerId: z.string().uuid().optional(),
  stageId: z.string().uuid().optional(),
  label: z.string().trim().max(40).optional(),
  reason: z.string().trim().max(200).optional(),
});

export async function bulkLeads(ctx: TenantCtx, input: z.infer<typeof BulkInput>) {
  const rows = (await db().contact.findMany({ where: { tenantId: ctx.tenantId, id: { in: input.ids }, type: 'lead' } })).filter((c) => inScope(ctx, c, LEAD_OWNER));
  const ids = rows.map((r) => r.id);
  if (input.action === 'assign') {
    if (!input.ownerId) throw new AppError('VALIDATION_FAILED', 'Choose who to assign to.', { fields: { ownerId: 'Required' } });
    if (!(await db().tenantMember.findFirst({ where: { userId: input.ownerId, status: 'active' } }))) throw new AppError('VALIDATION_FAILED', 'Choose an active user.', { fields: { ownerId: 'Not an active user' } });
    await db().contact.updateMany({ where: { id: { in: ids } }, data: { ownerId: input.ownerId } });
    if (input.ownerId !== ctx.userId) await notify(input.ownerId, `${ids.length} lead${ids.length === 1 ? '' : 's'} assigned to you`, undefined, '/app/m/crm');
  } else if (input.action === 'stage') {
    if (!input.stageId) throw new AppError('VALIDATION_FAILED', 'Choose the stage.', { fields: { stageId: 'Required' } });
    const where = await resolveStage(ctx, 'lead', null, input.stageId);
    await db().contact.updateMany({ where: { id: { in: ids }, leadStatus: { notIn: ['converted', 'lost'] } }, data: where });
  } else if (input.action === 'label') {
    if (!input.label) throw new AppError('VALIDATION_FAILED', 'Choose the label.', { fields: { label: 'Required' } });
    for (const r of rows) if (!r.labels.includes(input.label)) await db().contact.update({ where: { id: r.id }, data: { labels: [...r.labels, input.label] } });
  } else if (input.action === 'lost') {
    if (!input.reason) throw new AppError('VALIDATION_FAILED', 'Choose the reason.', { fields: { reason: 'Required' } });
    await db().contact.updateMany({ where: { id: { in: ids }, leadStatus: { not: 'converted' } }, data: { leadStatus: 'lost', lostReason: input.reason } });
  } else {
    const withDeals = new Set((await db().deal.findMany({ where: { contactId: { in: ids } }, select: { contactId: true } })).map((d) => d.contactId));
    const free = ids.filter((id) => !withDeals.has(id));
    await db().activity.deleteMany({ where: { contactId: { in: free } } });
    await db().crmProduct.deleteMany({ where: { contactId: { in: free } } });
    await db().contact.deleteMany({ where: { id: { in: free } } });
    await audit({ action: 'crm.lead.bulk_delete', entity: 'contact', after: { count: free.length, kept: ids.length - free.length } });
    return { done: free.length, skipped: input.ids.length - free.length };
  }
  await audit({ action: `crm.lead.bulk_${input.action}`, entity: 'contact', after: { count: ids.length } });
  return { done: ids.length, skipped: input.ids.length - ids.length };
}

// ── Deals ──

export const DealInput = z.object({
  title: z.string().trim().min(2, 'Enter what is being sold').max(160),
  contactId: z.string().uuid({ message: 'Choose the customer or lead' }),
  pipelineId: z.string().uuid().optional().nullable(),
  stageId: z.string().uuid().optional().nullable(),
  valuePaise: Paise.default(0),
  expectedCloseOn: DateStr.optional().nullable(),
  source: z.string().trim().max(60).optional().nullable(),
  labels: z.array(z.string().trim().max(40)).max(10).default([]),
  notes: z.string().trim().max(4000).optional().nullable(),
  ownerId: z.string().uuid().optional().nullable(),
});
export const DealPatch = DealInput.partial().extend({ version: z.number().int() });

async function checkOwner(ownerId?: string | null) {
  if (ownerId && !(await db().tenantMember.findFirst({ where: { userId: ownerId, status: 'active' } }))) throw new AppError('VALIDATION_FAILED', 'Owner must be an active user.', { fields: { ownerId: 'Not an active user' } });
}

export async function createDeal(ctx: TenantCtx, input: z.infer<typeof DealInput>, leadId?: string | null) {
  const contact = await db().contact.findFirst({ where: { id: input.contactId, tenantId: ctx.tenantId, type: { in: ['customer', 'lead'] } } });
  if (!contact) throw new AppError('VALIDATION_FAILED', 'Choose the customer or lead.', { fields: { contactId: 'Choose the customer' } });
  if (input.expectedCloseOn && dateOnly(input.expectedCloseOn) < dateOnly(todayIST())) throw new AppError('VALIDATION_FAILED', "The closing date can't be in the past.", { fields: { expectedCloseOn: 'In the past' } });
  await checkOwner(input.ownerId);
  const where = await resolveStage(ctx, 'deal', input.pipelineId, input.stageId);
  const deal = await db().deal.create({
    data: {
      ...input, ...where, tenantId: ctx.tenantId, leadId: leadId ?? null, valuePaise: BigInt(input.valuePaise), expectedCloseOn: input.expectedCloseOn ? dateOnly(input.expectedCloseOn) : null,
      source: input.source ?? contact.leadSource, ownerId: input.ownerId ?? contact.ownerId ?? ctx.userId, createdBy: ctx.userId,
    },
  });
  await db().activity.create({ data: { tenantId: ctx.tenantId, contactId: contact.id, dealId: deal.id, type: 'note', title: `Deal created: ${deal.title}`, createdBy: ctx.userId } });
  if (deal.ownerId && deal.ownerId !== ctx.userId) await notify(deal.ownerId, `New deal assigned: ${deal.title}`, undefined, `/app/m/crm/deals/${deal.id}`);
  await audit({ action: 'crm.deal.create', entity: 'deal', entityId: deal.id, after: { title: deal.title, valuePaise: input.valuePaise } });
  return deal;
}

export const ConvertInput = DealInput.omit({ contactId: true }).extend({
  /** Also add the lead to Customers now (needs mobile and state) */
  makeCustomer: z.boolean().default(false),
  stateCode: z.string().length(2).optional().nullable(),
  /** Carry the lead's interested products over to the deal */
  copyProducts: z.boolean().default(true),
});

/** Lead → deal. The lead's timeline stays on the contact and shows on the deal too. */
export async function convertLeadToDeal(ctx: TenantCtx, id: string, input: z.infer<typeof ConvertInput>) {
  const c = await lead(ctx, id);
  if (c.leadStatus === 'converted') throw new AppError('CONFLICT', 'This lead is already converted.');
  const { makeCustomer, stateCode, copyProducts, ...dealInput } = input;
  if (makeCustomer) {
    const fields: Record<string, string> = {};
    if (!c.phone) fields.phone = 'Add the mobile number to the lead first';
    if (!(stateCode ?? c.stateCode)) fields.stateCode = 'Choose the state';
    if (Object.keys(fields).length) throw new AppError('VALIDATION_FAILED', Object.values(fields)[0], { fields });
  }
  const deal = await createDeal(ctx, { ...dealInput, contactId: c.id, source: dealInput.source ?? c.leadSource, labels: dealInput.labels.length ? dealInput.labels : c.labels }, c.id);
  if (copyProducts) {
    const items = await db().crmProduct.findMany({ where: { contactId: c.id, dealId: null } });
    if (items.length) await db().crmProduct.createMany({ data: items.map((p) => ({ tenantId: ctx.tenantId, dealId: deal.id, itemId: p.itemId, quantity: p.quantity, pricePaise: p.pricePaise })) });
  }
  await db().contact.update({
    where: { id: c.id },
    data: { leadStatus: 'converted', convertedAt: new Date(), ...(makeCustomer ? { type: 'customer', stateCode: stateCode ?? c.stateCode, isActive: true } : {}), version: { increment: 1 } },
  });
  await db().activity.create({ data: { tenantId: ctx.tenantId, contactId: c.id, dealId: deal.id, type: 'note', title: makeCustomer ? 'Converted to deal and customer' : 'Converted to deal', createdBy: ctx.userId } });
  return deal;
}

async function deal(ctx: TenantCtx, id: string) {
  const d = await db().deal.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!d || !inScope(ctx, d, DEAL_OWNER)) throw notFound('Deal');
  return d;
}

export async function updateDeal(ctx: TenantCtx, id: string, input: z.infer<typeof DealPatch>) {
  const d = await deal(ctx, id);
  if (d.version !== input.version) throw new AppError('VERSION_CONFLICT', 'This deal was changed by someone else. Reload and try again.');
  const { version: _v, pipelineId: _p, stageId: _s, ...body } = input;
  await checkOwner(body.ownerId);
  const where = input.stageId || input.pipelineId ? await resolveStage(ctx, 'deal', input.pipelineId ?? (input.stageId ? null : d.pipelineId), input.stageId) : {};
  if (body.contactId && !(await db().contact.findFirst({ where: { id: body.contactId, tenantId: ctx.tenantId } }))) throw new AppError('VALIDATION_FAILED', 'Choose the customer or lead.', { fields: { contactId: 'Choose the customer' } });
  const updated = await db().deal.update({
    where: { id },
    data: { ...body, ...where, valuePaise: body.valuePaise === undefined ? undefined : BigInt(body.valuePaise), expectedCloseOn: body.expectedCloseOn === undefined ? undefined : body.expectedCloseOn ? dateOnly(body.expectedCloseOn) : null, version: { increment: 1 } },
  });
  if (body.ownerId && body.ownerId !== d.ownerId && body.ownerId !== ctx.userId) await notify(body.ownerId, `${d.title} was assigned to you`, undefined, `/app/m/crm/deals/${id}`);
  return updated;
}

export async function moveDeal(ctx: TenantCtx, id: string, stageId: string) {
  const d = await deal(ctx, id);
  if (d.status !== 'open') throw new AppError('CONFLICT', 'This deal is closed. Reopen it first.');
  const where = await resolveStage(ctx, 'deal', d.pipelineId, stageId);
  const stage = await db().crmStage.findUniqueOrThrow({ where: { id: where.stageId } });
  await db().activity.create({ data: { tenantId: ctx.tenantId, contactId: d.contactId, dealId: id, type: 'note', title: `Moved to ${stage.name}`, createdBy: ctx.userId } });
  return db().deal.update({ where: { id }, data: { stageId: where.stageId, version: { increment: 1 } } });
}

export async function closeDeal(ctx: TenantCtx, id: string, outcome: 'won' | 'lost', input?: z.infer<typeof LostInput>) {
  const d = await deal(ctx, id);
  if (d.status !== 'open') throw new AppError('CONFLICT', `This deal is already ${d.status}.`);
  if (outcome === 'lost' && !input?.reason) throw new AppError('VALIDATION_FAILED', 'Choose the reason.', { fields: { reason: 'Choose the reason' } });
  await db().activity.create({ data: { tenantId: ctx.tenantId, contactId: d.contactId, dealId: id, type: 'note', title: outcome === 'won' ? 'Deal won' : `Deal lost: ${input!.reason}`, body: input?.note ?? null, createdBy: ctx.userId } });
  await audit({ action: `crm.deal.${outcome}`, entity: 'deal', entityId: id, after: { title: d.title, valuePaise: d.valuePaise, reason: input?.reason } });
  return db().deal.update({ where: { id }, data: { status: outcome, lostReason: outcome === 'lost' ? input!.reason : null, closedAt: new Date(), version: { increment: 1 } } });
}

export async function reopenDeal(ctx: TenantCtx, id: string) {
  const d = await deal(ctx, id);
  if (d.status === 'open') throw new AppError('CONFLICT', 'This deal is already open.');
  await db().activity.create({ data: { tenantId: ctx.tenantId, contactId: d.contactId, dealId: id, type: 'note', title: 'Deal reopened', createdBy: ctx.userId } });
  return db().deal.update({ where: { id }, data: { status: 'open', lostReason: null, closedAt: null, version: { increment: 1 } } });
}

export async function deleteDeal(ctx: TenantCtx, id: string) {
  const d = await deal(ctx, id);
  await db().crmProduct.deleteMany({ where: { dealId: id } });
  await db().activity.updateMany({ where: { dealId: id }, data: { dealId: null } });
  await db().deal.delete({ where: { id } });
  await audit({ action: 'crm.deal.delete', entity: 'deal', entityId: id, before: { title: d.title } });
}

export const DealList = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(50),
  cursor: z.string().uuid().optional(),
  q: z.string().trim().max(100).optional(),
  pipelineId: z.string().uuid().optional(),
  stageId: z.string().uuid().optional(),
  status: z.enum(['open', 'won', 'lost']).optional(),
  ownerId: z.string().uuid().optional(),
  contactId: z.string().uuid().optional(),
  /** closing = open deals expected to close within 30 days; late = past the expected date */
  due: z.enum(['closing', 'late']).optional(),
});

/** Open tasks and how many are done, per contact or deal, for the "Tasks 2/3" column */
export async function taskCounts(where: Prisma.ActivityWhereInput, key: 'contactId' | 'dealId') {
  const rows = await db().activity.groupBy({ by: [key, 'completedAt'], where: { ...where, type: { in: ['task', 'follow_up'] } }, _count: { _all: true } });
  const out = new Map<string, { done: number; total: number }>();
  for (const r of rows) {
    const id = r[key] as string | null;
    if (!id) continue;
    const t = out.get(id) ?? { done: 0, total: 0 };
    t.total += r._count._all;
    if (r.completedAt) t.done += r._count._all;
    out.set(id, t);
  }
  return out;
}

export async function listDeals(ctx: TenantCtx, q: z.infer<typeof DealList>) {
  const today = dateOnly(todayIST());
  const in30 = new Date(today.getTime() + 30 * 86_400_000);
  const matched = q.q ? await db().contact.findMany({ where: { tenantId: ctx.tenantId, OR: [{ name: { contains: q.q, mode: 'insensitive' } }, { companyName: { contains: q.q, mode: 'insensitive' } }, { phone: { contains: q.q } }] }, select: { id: true }, take: 200 }) : [];
  const where: Prisma.DealWhereInput = {
    AND: [
      { tenantId: ctx.tenantId },
      scopeWhere(ctx, DEAL_OWNER),
      q.pipelineId ? { pipelineId: q.pipelineId } : {},
      q.stageId ? { stageId: q.stageId } : {},
      q.status ? { status: q.status } : {},
      q.ownerId ? { ownerId: q.ownerId } : {},
      q.contactId ? { contactId: q.contactId } : {},
      q.due === 'closing' ? { status: 'open', expectedCloseOn: { gte: today, lte: in30 } } : q.due === 'late' ? { status: 'open', expectedCloseOn: { lt: today } } : {},
      q.q ? { OR: [{ title: { contains: q.q, mode: 'insensitive' } }, { contactId: { in: matched.map((m) => m.id) } }] } : {},
    ],
  };
  const rows = await db().deal.findMany({ where, take: q.limit + 1, orderBy: { id: 'desc' }, ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}) });
  const data = rows.slice(0, q.limit);
  return { data: await decorateDeals(ctx, data), nextCursor: rows.length > q.limit ? data[data.length - 1].id : null };
}

type DealRow = Awaited<ReturnType<typeof db>>['deal'] extends never ? never : Prisma.DealGetPayload<object>;
export async function decorateDeals(ctx: TenantCtx, rows: DealRow[]) {
  const [contacts, stages, users, tasks] = await Promise.all([
    db().contact.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.contactId))] } }, select: { id: true, name: true, companyName: true, phone: true, type: true } }),
    db().crmStage.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.stageId))] } } }),
    db().user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.ownerId).filter(Boolean))] as string[] } }, select: { id: true, name: true } }),
    rows.length ? taskCounts({ tenantId: ctx.tenantId, dealId: { in: rows.map((r) => r.id) } }, 'dealId') : new Map(),
  ]);
  const c = new Map(contacts.map((x) => [x.id, x]));
  const s = new Map(stages.map((x) => [x.id, x]));
  const u = new Map(users.map((x) => [x.id, x]));
  return rows.map((r) => ({ ...r, contact: c.get(r.contactId) ?? null, stage: s.get(r.stageId) ?? null, owner: r.ownerId ? (u.get(r.ownerId) ?? null) : null, tasks: tasks.get(r.id) ?? { done: 0, total: 0 } }));
}

export async function getDeal(ctx: TenantCtx, id: string) {
  const d = await deal(ctx, id);
  const [[row], activities, products, quotations] = await Promise.all([
    decorateDeals(ctx, [d]),
    db().activity.findMany({ where: { dealId: id }, orderBy: { createdAt: 'desc' }, take: 200 }),
    productsOf(ctx, { dealId: id }),
    db().salesDocument.findMany({ where: { contactId: d.contactId, kind: { in: ['quotation', 'invoice', 'sales_order'] }, createdAt: { gte: d.createdAt } }, orderBy: { createdAt: 'desc' }, take: 20, select: { id: true, kind: true, number: true, status: true, issueDate: true, totalPaise: true } }),
  ]);
  const names = await userNames(activities.flatMap((a) => [a.createdBy, a.assigneeId]));
  return { ...row, activities: activities.map((a) => ({ ...a, createdByName: a.createdBy ? names.get(a.createdBy) ?? null : null, assigneeName: a.assigneeId ? names.get(a.assigneeId) ?? null : null })), products, documents: quotations };
}

export async function userNames(ids: (string | null)[]) {
  const list = [...new Set(ids.filter(Boolean))] as string[];
  return new Map((list.length ? await db().user.findMany({ where: { id: { in: list } }, select: { id: true, name: true } }) : []).map((u) => [u.id, u.name]));
}

// ── Products a lead or deal is interested in ──

export const ProductsInput = z.object({
  items: z.array(z.object({ itemId: z.string().uuid(), quantity: z.number().positive('Enter more than 0').max(1e7), pricePaise: Paise })).max(100),
});

export async function productsOf(ctx: TenantCtx, where: { contactId?: string; dealId?: string }) {
  const rows = await db().crmProduct.findMany({ where: { tenantId: ctx.tenantId, ...(where.dealId ? { dealId: where.dealId } : { contactId: where.contactId, dealId: null }) } });
  const items = await db().item.findMany({ where: { id: { in: rows.map((r) => r.itemId) } }, select: { id: true, name: true, unit: true, gstRateBp: true } });
  const byId = new Map(items.map((i) => [i.id, i]));
  return rows.map((r) => ({ id: r.id, itemId: r.itemId, name: byId.get(r.itemId)?.name ?? 'Item', unit: byId.get(r.itemId)?.unit ?? 'pcs', gstRateBp: byId.get(r.itemId)?.gstRateBp ?? 0, quantity: Number(r.quantity), pricePaise: r.pricePaise }));
}

/** Replace the list. A deal's value follows its products when it has any. */
export async function setProducts(ctx: TenantCtx, where: { contactId?: string; dealId?: string }, input: z.infer<typeof ProductsInput>) {
  if (where.dealId) await deal(ctx, where.dealId);
  else await lead(ctx, where.contactId!);
  const found = await db().item.count({ where: { tenantId: ctx.tenantId, id: { in: input.items.map((i) => i.itemId) } } });
  if (found !== new Set(input.items.map((i) => i.itemId)).size) throw new AppError('VALIDATION_FAILED', 'Choose items from your list.');
  await db().crmProduct.deleteMany({ where: { tenantId: ctx.tenantId, ...(where.dealId ? { dealId: where.dealId } : { contactId: where.contactId, dealId: null }) } });
  if (input.items.length) {
    await db().crmProduct.createMany({ data: input.items.map((i) => ({ tenantId: ctx.tenantId, contactId: where.dealId ? null : where.contactId!, dealId: where.dealId ?? null, itemId: i.itemId, quantity: i.quantity.toFixed(3), pricePaise: BigInt(i.pricePaise) })) });
  }
  const total = input.items.reduce((s, i) => s + Math.round(i.quantity * i.pricePaise), 0);
  if (total > 0) {
    if (where.dealId) await db().deal.update({ where: { id: where.dealId }, data: { valuePaise: BigInt(total), version: { increment: 1 } } });
    else await db().contact.update({ where: { id: where.contactId }, data: { valuePaise: BigInt(total) } });
  }
  return productsOf(ctx, where);
}

// ── Reports ──

export async function crmReport(ctx: TenantCtx, pipelineId?: string) {
  const pipeline = pipelineId ?? (await ensureSetup(ctx)).id;
  const [leads, deals, stages] = await Promise.all([
    db().contact.findMany({ where: { AND: [{ tenantId: ctx.tenantId, OR: [{ type: 'lead' }, { stageId: { not: null } }] }, scopeWhere(ctx, LEAD_OWNER)] }, select: { leadStatus: true, leadSource: true, stageId: true, pipelineId: true, ownerId: true, createdAt: true, convertedAt: true, lostReason: true } }),
    db().deal.findMany({ where: { AND: [{ tenantId: ctx.tenantId }, scopeWhere(ctx, DEAL_OWNER)] }, select: { status: true, stageId: true, pipelineId: true, valuePaise: true, ownerId: true, closedAt: true, createdAt: true, lostReason: true, source: true } }),
    db().crmStage.findMany({ where: { tenantId: ctx.tenantId, pipelineId: pipeline }, orderBy: { position: 'asc' } }),
  ]);
  const names = await userNames([...leads.map((l) => l.ownerId), ...deals.map((d) => d.ownerId)]);
  const count = <T,>(rows: T[], key: (r: T) => string) => [...rows.reduce((m, r) => m.set(key(r), (m.get(key(r)) ?? 0) + 1), new Map<string, number>())].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  const open = leads.filter((l) => l.leadStatus !== 'converted' && l.leadStatus !== 'lost');
  const converted = leads.filter((l) => l.leadStatus === 'converted').length;
  const won = deals.filter((d) => d.status === 'won');
  const lost = deals.filter((d) => d.status === 'lost');
  const openDeals = deals.filter((d) => d.status === 'open');
  const stageProb = new Map(stages.map((s) => [s.id, s.probability ?? 0]));
  const month = (d: Date) => d.toISOString().slice(0, 7);
  const months = [...Array(6)].map((_, i) => { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 5 + i); return d.toISOString().slice(0, 7); });
  return {
    leads: {
      total: leads.length, open: open.length, converted, lost: leads.filter((l) => l.leadStatus === 'lost').length,
      conversionRate: leads.length ? Math.round((converted / leads.length) * 100) : 0,
      byStage: stages.filter((s) => s.kind === 'lead').map((s) => ({ name: s.name, color: s.color, value: open.filter((l) => l.stageId === s.id).length })),
      bySource: count(leads, (l) => l.leadSource || 'Not set'),
      byOwner: count(leads, (l) => (l.ownerId ? names.get(l.ownerId) ?? 'Someone' : 'Unassigned')),
      lostReasons: count(leads.filter((l) => l.lostReason), (l) => l.lostReason!),
      byMonth: months.map((m) => ({ name: m, value: leads.filter((l) => month(l.createdAt) === m).length })),
    },
    deals: {
      open: openDeals.length, openValuePaise: openDeals.reduce((s, d) => s + d.valuePaise, 0n),
      weightedPaise: openDeals.reduce((s, d) => s + (d.valuePaise * BigInt(stageProb.get(d.stageId) ?? 0)) / 100n, 0n),
      won: won.length, wonValuePaise: won.reduce((s, d) => s + d.valuePaise, 0n), lost: lost.length,
      winRate: won.length + lost.length ? Math.round((won.length / (won.length + lost.length)) * 100) : 0,
      byStage: stages.filter((s) => s.kind === 'deal').map((s) => { const here = openDeals.filter((d) => d.stageId === s.id); return { name: s.name, color: s.color, value: here.length, valuePaise: here.reduce((t, d) => t + d.valuePaise, 0n) }; }),
      byOwner: [...deals.reduce((m, d) => { const k = d.ownerId ? names.get(d.ownerId) ?? 'Someone' : 'Unassigned'; const r = m.get(k) ?? { name: k, open: 0, won: 0, wonValuePaise: 0n }; if (d.status === 'open') r.open++; if (d.status === 'won') { r.won++; r.wonValuePaise += d.valuePaise; } return m.set(k, r); }, new Map<string, { name: string; open: number; won: number; wonValuePaise: bigint }>()).values()],
      lostReasons: count(lost.filter((d) => d.lostReason), (d) => d.lostReason!),
      wonByMonth: months.map((m) => ({ name: m, value: won.filter((d) => d.closedAt && month(d.closedAt) === m).length, valuePaise: won.filter((d) => d.closedAt && month(d.closedAt) === m).reduce((s, d) => s + d.valuePaise, 0n) })),
    },
  };
}
