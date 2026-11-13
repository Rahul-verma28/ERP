import type { TenantCtx } from '../../kernel/context';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { db, withTenant } from '../../kernel/db';
import { AppError, notFound } from '../../kernel/errors';
import { normaliseEmail } from '../../kernel/crypto';
import { optionalText, zEmail, zGstin, zPhone, zPincode, zStateCode } from '../../kernel/zodRules';
import * as rules from '../../contracts/validation';
import { IdParam, ListQuery, Paise, assertRecordLimit, assertVersion, inScope, markOnboarding, page, pageArgs, scopeWhere } from '../../kernel/query';
import { validate } from '../../middleware/request';
import { requirePermission, tenantAuth, tx } from '../../middleware/auth';
import { validateCustom } from '../config/service';
import { audit } from '../audit/service';
import { notify } from '../notifications/service';
import { getRolePermissions } from '../access/service';
import { customerBalances, setOpeningBalance } from '../billing/ledger';
import * as crm from './pipeline';
import { DateStr } from '../../kernel/query';
import { dateOnly, todayIST } from '../../kernel/gst';

// CRM basic (CRM-01..04): customers, leads → convert, timeline, CSV import with de-duplication.

const router = Router();
router.use(tenantAuth);

const OWNER_FIELDS = { owner: ['createdBy', 'ownerId'], branch: 'branchId' };

const optional = optionalText;

const ContactInput = z.object({
  name: z.string().trim().min(2, 'Use at least 2 characters').max(160, 'Keep it under 160 characters'),
  companyName: optional(z.string().trim().max(160)),
  phone: optional(zPhone),
  email: optional(zEmail),
  gstin: optional(zGstin),
  stateCode: optional(zStateCode),
  address: z.object({ line1: z.string().trim().max(200).optional(), line2: z.string().trim().max(200).optional(), city: z.string().trim().max(80).optional(), pincode: zPincode.optional().or(z.literal('')) }).optional().nullable(),
  /** Customers: where goods go when not the billing address. Given = complete. */
  shippingAddress: z.object({
    name: optional(z.string().trim().max(160)),
    line1: z.string().trim().min(1, 'Enter the delivery address').max(200),
    line2: optional(z.string().trim().max(200)),
    city: z.string().trim().min(1, 'Enter the city').max(80),
    pincode: zPincode,
    stateCode: zStateCode,
  }).optional().nullable(),
  leadStatus: z.enum(['new', 'contacted', 'qualified', 'lost']).optional(),
  leadSource: optional(z.string().trim().max(60)),
  ownerId: optional(z.string().uuid()),
  branchId: optional(z.string().uuid()),
  isActive: z.boolean().optional(),
  notes: optional(z.string().max(4000)),
  custom: z.record(z.unknown()).optional(),
  /** Empty = no limit */
  creditLimitPaise: Paise.optional().nullable(),
  /** Invoices fall due this many days after their date; empty = due on receipt */
  paymentDays: z.number().int().min(0, 'Use 0 to 365').max(365, 'Use 0 to 365').optional().nullable(),
  priceListId: z.string().uuid().optional().nullable(),
  /** Leads: what they want */
  subject: optional(z.string().trim().max(200)),
  pipelineId: z.string().uuid().optional().nullable(),
  stageId: z.string().uuid().optional().nullable(),
  followUpOn: DateStr.optional().nullable(),
  valuePaise: Paise.optional().nullable(),
  labels: z.array(z.string().trim().max(40)).max(10).optional(),
});
const ContactPatch = ContactInput.partial().extend({ version: z.number().int() });
/** What the customer already owed before AHEAD, set while adding them */
const OpeningInput = z.object({ amountPaise: Paise.refine((v) => v > 0, 'Enter an amount'), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a date') });

/** Rules beyond the field formats. A customer is billed, so the mobile and the state (place of supply) are needed. */
function checkContact(kind: Kind, c: { phone?: string | null; email?: string | null; gstin?: string | null; stateCode?: string | null; subject?: string | null }) {
  const fields: Record<string, string> = {};
  if (kind === 'customer') {
    if (!c.phone) fields.phone = 'Enter the mobile number';
    if (!c.stateCode) fields.stateCode = 'Choose the state';
  } else {
    if (!c.phone && !c.email) fields.phone = 'Enter a phone number or an email';
    if (c.subject !== undefined && !c.subject) fields.subject = 'Enter what they are looking for';
  }
  const mismatch = rules.gstinStateMismatch(c.gstin, c.stateCode);
  if (mismatch) fields.gstin = mismatch;
  if (Object.keys(fields).length) throw new AppError('VALIDATION_FAILED', Object.values(fields)[0], { fields });
}

const ContactList = ListQuery.extend({
  /** Leads: open (default), lost, converted or all */
  status: z.enum(['open', 'new', 'contacted', 'qualified', 'lost', 'converted', 'all']).optional(),
  pipelineId: z.string().uuid().optional(),
  stageId: z.string().uuid().optional(),
  ownerId: z.string().uuid().optional(),
  source: z.string().trim().max(60).optional(),
  label: z.string().trim().max(40).optional(),
  /** Leads by follow-up date */
  followUp: z.enum(['today', 'overdue', 'week', 'none']).optional(),
  active: z.enum(['true', 'false', 'all']).default('true'),
  /** Customers only: owes = has a balance due, overdue = has invoices past their due date */
  dues: z.enum(['owes', 'overdue']).optional(),
});

type Kind = 'customer' | 'lead';
const perm = (kind: Kind, action: string) => `crm.${kind === 'lead' ? 'lead' : 'contact'}.${action}`;

/** Find likely duplicates by phone or email (CRM-04). */
async function findDuplicate(phone?: string | null, email?: string | null, excludeId?: string) {
  if (!phone && !email) return null;
  return db().contact.findFirst({
    where: { id: excludeId ? { not: excludeId } : undefined, OR: [...(phone ? [{ phone }] : []), ...(email ? [{ email }] : [])] },
    select: { id: true, name: true, type: true },
  });
}

async function checkOwner(ownerId?: string | null) {
  if (!ownerId) return;
  const m = await db().tenantMember.findFirst({ where: { userId: ownerId, status: 'active' } });
  if (!m) throw new AppError('VALIDATION_FAILED', 'Owner must be an active user.', { fields: { ownerId: 'Not an active user' } });
}

async function loadInScope(req: Request, kind?: Kind) {
  const c = await db().contact.findUnique({ where: { id: String(req.params.id) } });
  if (!c || (kind && c.type !== kind) || !inScope(req.ctx!, c, OWNER_FIELDS)) throw notFound(kind === 'lead' ? 'Lead' : 'Customer');
  return c;
}

function registerContactRoutes(kind: Kind, base: string) {
  router.get(base, requirePermission(perm(kind, 'view')), validate(ContactList, 'query'), tx(async (req, res) => {
    const q = req.query as unknown as z.infer<typeof ContactList>;
    const dueIds = kind === 'customer' && q.dues ? [...(await customerBalances())].filter(([, b]) => (q.dues === 'overdue' ? b.overduePaise > 0n : b.balancePaise > 0n)).map(([id]) => id) : null;
    const where: Prisma.ContactWhereInput = {
      AND: [
        { type: kind },
        dueIds ? { id: { in: dueIds } } : {},
        scopeWhere(req.ctx!, OWNER_FIELDS),
        kind === 'lead' ? leadWhere(q) : { isActive: q.active === 'all' ? undefined : q.active === 'true' },
        q.q
          ? { OR: [{ name: { contains: q.q, mode: 'insensitive' } }, { companyName: { contains: q.q, mode: 'insensitive' } }, { phone: { contains: q.q } }, { email: { contains: q.q, mode: 'insensitive' } }] }
          : {},
      ],
    };
    const rows = await db().contact.findMany({ where, ...pageArgs(q) });
    const result = page(rows, q.limit);
    if (kind === 'lead') return res.json({ ...result, data: await decorateLeads(req.ctx!, result.data) });
    // Customers carry what they owe, for people who may see dues
    if (kind === 'customer' && (await getRolePermissions(req.ctx!.roleId)).has('billing.dues.view')) {
      const owed = await customerBalances(result.data.map((c) => c.id));
      return res.json({ ...result, data: result.data.map((c) => ({ ...c, ...(owed.get(c.id) ?? { balancePaise: 0n, overduePaise: 0n }) })) });
    }
    res.json(result);
  }));

  router.post(base, requirePermission(perm(kind, 'create')), validate(ContactInput.extend({ allowDuplicate: z.boolean().default(false), opening: OpeningInput.optional().nullable() })), tx(async (req, res) => {
    const ctx = req.ctx!;
    const { allowDuplicate, opening, ...body } = req.body as z.infer<typeof ContactInput> & { allowDuplicate: boolean; opening?: z.infer<typeof OpeningInput> | null };
    body.stateCode = body.stateCode ?? (body.gstin ? body.gstin.slice(0, 2) : null);
    checkContact(kind, kind === 'lead' ? { ...body, subject: body.subject ?? '' } : body);
    await assertRecordLimit(ctx, 'contacts', () => db().contact.count(), 'customers and leads');
    await checkOwner(body.ownerId);
    if (!allowDuplicate) {
      const dup = await findDuplicate(body.phone, body.email);
      if (dup) throw new AppError('CONFLICT', `${dup.name} already has this phone or email.`, { duplicateId: dup.id, duplicateType: dup.type });
    }
    const custom = await validateCustom(ctx.tenantId, kind === 'lead' ? 'lead' : 'contact', body.custom);
    const place = kind === 'lead' ? await crm.resolveStage(ctx, 'lead', body.pipelineId, body.stageId) : { pipelineId: null, stageId: null };
    const contact = await db().contact.create({
      data: {
        ...body,
        ...place,
        followUpOn: body.followUpOn ? dateOnly(body.followUpOn) : null,
        valuePaise: body.valuePaise == null ? null : BigInt(body.valuePaise),
        labels: body.labels ?? [],
        address: body.address ?? undefined,
        shippingAddress: body.shippingAddress ?? undefined,
        tenantId: ctx.tenantId,
        type: kind,
        leadStatus: kind === 'lead' ? (body.leadStatus ?? 'new') : null,
        ownerId: body.ownerId ?? ctx.userId,
        createdBy: ctx.userId,
        custom: custom as Prisma.InputJsonValue,
      },
    });
    if (kind === 'customer') await markOnboarding(ctx, 'firstCustomer');
    if (kind === 'customer' && opening) await setOpeningBalance(ctx, contact.id, opening);
    if (contact.ownerId && contact.ownerId !== ctx.userId) await notify(contact.ownerId, `New ${kind} assigned: ${contact.name}`, undefined, `/app/m/crm/${contact.id}`);
    res.status(201).json(contact);
  }));
}

registerContactRoutes('customer', '/contacts');
registerContactRoutes('lead', '/leads');

// Live duplicate check while a contact form is being filled (same rule as create)
const DuplicateQuery = z.object({
  kind: z.enum(['customer', 'lead']).default('customer'),
  phone: optionalText(zPhone),
  email: optionalText(zEmail),
  excludeId: z.string().uuid().optional(),
});
router.get(
  '/contacts/duplicates',
  validate(DuplicateQuery, 'query'),
  (req, res, next) => requirePermission(perm((req.query as unknown as z.infer<typeof DuplicateQuery>).kind, 'create'))(req, res, next),
  tx(async (req, res) => {
    const q = req.query as unknown as z.infer<typeof DuplicateQuery>;
    res.json({ duplicate: await findDuplicate(q.phone, q.email, q.excludeId) });
  }),
);

// Single-record routes work for both kinds; the permission follows the record's type.
async function contactPerm(req: Request, action: string) {
  const c = await db().contact.findUnique({ where: { id: String(req.params.id) }, select: { type: true } });
  return perm((c?.type ?? 'customer') as Kind, action);
}

const dynamicPermission = (action: string) => async (req: Request, res: Response, next: NextFunction) => {
  const key = await withTenant(req.ctx!, () => contactPerm(req, action));
  await requirePermission(key)(req, res, next);
};

router.get('/contacts/:id', validate(IdParam, 'params'), dynamicPermission('view'), tx(async (req, res) => {
  const c = await loadInScope(req);
  const balances = async () => (c.type === 'customer' && (await getRolePermissions(req.ctx!.roleId)).has('billing.dues.view') ? ((await customerBalances([c.id])).get(c.id) ?? { balancePaise: 0n, overduePaise: 0n }) : {});
  // ?view=summary: the customer page needs the record, owner and balance, not the timeline
  if (req.query.view === 'summary') {
    const [owner, owed] = await Promise.all([c.ownerId ? db().user.findUnique({ where: { id: c.ownerId }, select: { id: true, name: true } }) : null, balances()]);
    return res.json({ ...c, ...owed, owner });
  }
  const [activities, invoices, appointments, owner, stage, products, deals] = await Promise.all([
    db().activity.findMany({ where: { contactId: c.id }, orderBy: { createdAt: 'desc' }, take: 100 }),
    db().salesDocument.findMany({
      where: { contactId: c.id, kind: { not: 'opening_balance' } },
      orderBy: { issueDate: 'desc' },
      take: 20,
      select: { id: true, kind: true, number: true, status: true, issueDate: true, totalPaise: true, paidPaise: true },
    }),
    db().appointment.findMany({ where: { contactId: c.id }, orderBy: { startAt: 'desc' }, take: 20, select: { id: true, title: true, startAt: true, status: true } }),
    c.ownerId ? db().user.findUnique({ where: { id: c.ownerId }, select: { id: true, name: true } }) : null,
    c.stageId ? db().crmStage.findUnique({ where: { id: c.stageId } }) : null,
    crm.productsOf(req.ctx!, { contactId: c.id }),
    db().deal.findMany({ where: { contactId: c.id }, orderBy: { createdAt: 'desc' }, take: 20 }),
  ]);
  const userIds = [...new Set(activities.flatMap((a) => [a.createdBy, a.assigneeId]).filter(Boolean))] as string[];
  const users = await db().user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } });
  const names = Object.fromEntries(users.map((u) => [u.id, u.name]));
  const owed = await balances();
  res.json({ ...c, ...owed, owner, stage, products, deals: await crm.decorateDeals(req.ctx!, deals), activities: activities.map((a) => ({ ...a, createdByName: a.createdBy ? names[a.createdBy] : null, assigneeName: a.assigneeId ? names[a.assigneeId] : null })), documents: invoices, appointments });
}));

router.patch('/contacts/:id', validate(IdParam, 'params'), dynamicPermission('edit'), validate(ContactPatch), tx(async (req, res) => {
  const ctx = req.ctx!;
  const c = await loadInScope(req);
  const { version, ...body } = req.body as z.infer<typeof ContactPatch>;
  assertVersion(c.version, version, 'record');
  await checkOwner(body.ownerId);
  if (c.type !== 'supplier') checkContact(c.type as Kind, { phone: body.phone === undefined ? c.phone : body.phone, email: body.email === undefined ? c.email : body.email, gstin: body.gstin === undefined ? c.gstin : body.gstin, stateCode: body.stateCode === undefined ? c.stateCode : body.stateCode, ...(c.type === 'lead' && body.subject !== undefined ? { subject: body.subject } : {}) });
  if (body.phone || body.email) {
    const dup = await findDuplicate(body.phone, body.email, c.id);
    if (dup) throw new AppError('CONFLICT', `${dup.name} already has this phone or email.`, { duplicateId: dup.id });
  }
  const custom = body.custom ? await validateCustom(ctx.tenantId, c.type === 'lead' ? 'lead' : 'contact', body.custom, c.custom as Record<string, unknown>) : undefined;
  const place = c.type === 'lead' && (body.stageId || body.pipelineId) ? await crm.resolveStage(ctx, 'lead', body.pipelineId, body.stageId) : {};
  const { pipelineId: _p, stageId: _s, followUpOn, valuePaise, ...rest } = body;
  const updated = await db().contact.update({
    where: { id: c.id },
    data: { ...rest, ...place, followUpOn: followUpOn === undefined ? undefined : followUpOn ? dateOnly(followUpOn) : null, valuePaise: valuePaise === undefined ? undefined : valuePaise == null ? null : BigInt(valuePaise), address: body.address === null ? undefined : body.address, shippingAddress: body.shippingAddress === undefined ? undefined : (body.shippingAddress ?? Prisma.JsonNull), leadStatus: c.type === 'lead' ? body.leadStatus : undefined, custom: custom as Prisma.InputJsonValue | undefined, version: { increment: 1 } },
  });
  if (body.ownerId && body.ownerId !== c.ownerId && body.ownerId !== ctx.userId) await notify(body.ownerId, `${c.name} was assigned to you`, undefined, `/app/m/crm/${c.id}`);
  res.json(updated);
}));

router.delete('/contacts/:id', validate(IdParam, 'params'), dynamicPermission('delete'), tx(async (req, res) => {
  const c = await loadInScope(req);
  const [invoices, receipts, deals] = await Promise.all([db().salesDocument.count({ where: { contactId: c.id } }), db().payment.count({ where: { contactId: c.id } }), db().deal.count({ where: { contactId: c.id } })]);
  const docs = invoices + receipts + deals;
  if (docs) {
    // Customers with invoices or advances are kept for the records; they are deactivated instead
    await db().contact.update({ where: { id: c.id }, data: { isActive: false, version: { increment: 1 } } });
  } else {
    await db().activity.deleteMany({ where: { contactId: c.id } });
    await db().crmProduct.deleteMany({ where: { contactId: c.id } });
    await db().contact.delete({ where: { id: c.id } });
  }
  await audit({ action: docs ? 'crm.contact.deactivate' : 'crm.contact.delete', entity: 'contact', entityId: c.id, before: { name: c.name, type: c.type } });
  res.status(204).end();
}));

// CRM-02: convert a lead into a customer (keeps the timeline)
router.post('/leads/:id/convert', validate(IdParam, 'params'), requirePermission('crm.contact.create'), tx(async (req, res) => {
  const c = await loadInScope(req, 'lead');
  if (c.leadStatus === 'converted') throw new AppError('CONFLICT', 'This lead is already converted.');
  const updated = await db().contact.update({
    where: { id: c.id },
    data: { type: 'customer', leadStatus: 'converted', convertedAt: new Date(), isActive: true, version: { increment: 1 } },
  });
  await db().activity.create({ data: { tenantId: req.ctx!.tenantId, contactId: c.id, type: 'note', title: 'Converted to customer', createdBy: req.ctx!.userId } });
  await markOnboarding(req.ctx!, 'firstCustomer');
  res.json(updated);
}));

// The prices this customer pays: a discount on everything, and exact prices for some items
router.get('/contacts/:id/prices', validate(IdParam, 'params'), requirePermission('catalog.item.view'), tx(async (req, res) => {
  const c = await db().contact.findUnique({ where: { id: String(req.params.id) }, select: { priceListId: true } });
  if (!c) throw notFound('Customer');
  const list = c.priceListId ? await db().priceList.findUnique({ where: { id: c.priceListId }, include: { items: { select: { itemId: true, pricePaise: true } } } }) : null;
  res.json(list ? { name: list.name, discountBp: list.discountBp, prices: Object.fromEntries(list.items.map((i) => [i.itemId, Number(i.pricePaise)])) } : null);
}));

// ── Timeline (CRM-03) ──

const ActivityInput = z.object({
  type: z.enum(['note', 'call', 'meeting', 'follow_up', 'task', 'email']),
  /** Put it on this deal of the contact */
  dealId: z.string().uuid().optional(),
  title: z.string().trim().max(200).optional(),
  body: z.string().trim().max(4000).optional(),
  dueAt: z.string().datetime({ offset: true }).optional(),
  assigneeId: z.string().uuid().optional(),
});

router.post('/contacts/:id/activities', validate(IdParam, 'params'), requirePermission('crm.activity.create'), validate(ActivityInput), tx(async (req, res) => {
  const ctx = req.ctx!;
  const c = await db().contact.findUnique({ where: { id: String(req.params.id) } });
  if (!c) throw notFound('Customer');
  const body = req.body as z.infer<typeof ActivityInput>;
  if ((body.type === 'follow_up' || body.type === 'task') && !body.dueAt) throw new AppError('VALIDATION_FAILED', 'Choose when it is due.', { fields: { dueAt: 'Choose the due date' } });
  if (body.type === 'task' && !body.title) throw new AppError('VALIDATION_FAILED', 'Enter the task.', { fields: { title: 'Enter the task' } });
  if (body.dealId && !(await db().deal.findFirst({ where: { id: body.dealId, contactId: c.id } }))) throw new AppError('VALIDATION_FAILED', 'This deal is not with this contact.', { fields: { dealId: 'Not this contact' } });
  if (!body.title && !body.body) throw new AppError('VALIDATION_FAILED', 'Add a title or note.', { fields: { body: 'Required' } });
  await checkOwner(body.assigneeId);
  const a = await db().activity.create({
    data: { ...body, dueAt: body.dueAt ? new Date(body.dueAt) : null, tenantId: ctx.tenantId, contactId: c.id, createdBy: ctx.userId, assigneeId: body.assigneeId ?? (body.type === 'follow_up' || body.type === 'task' ? ctx.userId : null) },
  });
  if (body.type === 'follow_up' && c.type === 'lead') await db().contact.update({ where: { id: c.id }, data: { followUpOn: dateOnly(body.dueAt!.slice(0, 10)) } });
  if (c.type === 'lead' && c.leadStatus === 'new' && (body.type === 'call' || body.type === 'meeting')) {
    await db().contact.update({ where: { id: c.id }, data: { leadStatus: 'contacted', version: { increment: 1 } } });
  }
  if (a.assigneeId && a.assigneeId !== ctx.userId) await notify(a.assigneeId, `Follow-up with ${c.name}`, body.title, `/app/m/crm/${c.id}`);
  res.status(201).json(a);
}));

router.patch('/activities/:id', validate(IdParam, 'params'), requirePermission('crm.activity.edit'), validate(z.object({ completed: z.boolean().optional(), dueAt: z.string().datetime({ offset: true }).optional(), assigneeId: z.string().uuid().optional() })), tx(async (req, res) => {
  const a = await db().activity.findUnique({ where: { id: String(req.params.id) } });
  if (!a || !inScope(req.ctx!, a, { owner: ['createdBy', 'assigneeId'] })) throw notFound('Activity');
  await checkOwner(req.body.assigneeId);
  res.json(await db().activity.update({ where: { id: a.id }, data: { completedAt: req.body.completed === undefined ? undefined : req.body.completed ? new Date() : null, dueAt: req.body.dueAt ? new Date(req.body.dueAt) : undefined, assigneeId: req.body.assigneeId } }));
}));
router.delete('/activities/:id', validate(IdParam, 'params'), requirePermission('crm.activity.delete'), tx(async (req, res) => {
  const a = await db().activity.findUnique({ where: { id: String(req.params.id) } });
  if (!a || !inScope(req.ctx!, a, { owner: ['createdBy'] })) throw notFound('Activity');
  await db().activity.delete({ where: { id: a.id } });
  res.status(204).end();
}));

/** Follow-ups due for the current user (dashboard + reminders) */
router.get('/follow-ups', requirePermission('crm.activity.view'), tx(async (req, res) => {
  const rows = await db().activity.findMany({
    where: { type: { in: ['follow_up', 'task'] }, completedAt: req.query.done === 'true' ? { not: null } : null, AND: [scopeWhere(req.ctx!, { owner: ['assigneeId', 'createdBy'] })] },
    orderBy: { dueAt: 'asc' },
    take: 300,
  });
  const [contacts, deals, names] = await Promise.all([
    db().contact.findMany({ where: { id: { in: rows.map((r) => r.contactId) } }, select: { id: true, name: true, phone: true, type: true } }),
    db().deal.findMany({ where: { id: { in: rows.map((r) => r.dealId).filter(Boolean) as string[] } }, select: { id: true, title: true } }),
    crm.userNames(rows.map((r) => r.assigneeId)),
  ]);
  const byId = Object.fromEntries(contacts.map((c) => [c.id, c]));
  const dealOf = Object.fromEntries(deals.map((d) => [d.id, d]));
  res.json({ data: rows.map((r) => ({ ...r, contact: byId[r.contactId] ?? null, deal: r.dealId ? dealOf[r.dealId] ?? null : null, assigneeName: r.assigneeId ? names.get(r.assigneeId) ?? null : null })) });
}));

// ── Leads: filters, board, actions ──

function leadWhere(q: z.infer<typeof ContactList>): Prisma.ContactWhereInput {
  const today = dateOnly(todayIST());
  const week = new Date(today.getTime() + 7 * 86_400_000);
  const status = !q.status || q.status === 'open' ? { leadStatus: { notIn: ['converted', 'lost'] as ('converted' | 'lost')[] } } : q.status === 'all' ? {} : { leadStatus: q.status };
  return {
    AND: [
      status,
      q.pipelineId ? { pipelineId: q.pipelineId } : {},
      q.stageId ? { stageId: q.stageId } : {},
      q.ownerId ? { ownerId: q.ownerId } : {},
      q.source ? { leadSource: q.source } : {},
      q.label ? { labels: { has: q.label } } : {},
      q.followUp === 'today' ? { followUpOn: today } : q.followUp === 'overdue' ? { followUpOn: { lt: today } } : q.followUp === 'week' ? { followUpOn: { gte: today, lte: week } } : q.followUp === 'none' ? { followUpOn: null } : {},
    ],
  };
}

/** Stage, owner and tasks for each lead row */
async function decorateLeads(ctx: TenantCtx, rows: { id: string; stageId: string | null; ownerId: string | null }[]) {
  const [stages, names, tasks] = await Promise.all([
    db().crmStage.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.stageId).filter(Boolean))] as string[] } } }),
    crm.userNames(rows.map((r) => r.ownerId)),
    rows.length ? crm.taskCounts({ tenantId: ctx.tenantId, contactId: { in: rows.map((r) => r.id) }, dealId: null }, 'contactId') : new Map(),
  ]);
  const s = new Map(stages.map((x) => [x.id, x]));
  return rows.map((r) => ({ ...r, stage: r.stageId ? s.get(r.stageId) ?? null : null, owner: r.ownerId ? { id: r.ownerId, name: names.get(r.ownerId) ?? '' } : null, tasks: tasks.get(r.id) ?? { done: 0, total: 0 } }));
}

/** Every open lead of a pipeline, for the board (up to 1,000) */
router.get('/leads/board', requirePermission('crm.lead.view'), validate(ContactList, 'query'), tx(async (req, res) => {
  const q = req.query as unknown as z.infer<typeof ContactList>;
  const pipelineId = q.pipelineId ?? (await crm.ensureSetup(req.ctx!)).id;
  const rows = await db().contact.findMany({
    where: { AND: [{ type: 'lead', pipelineId }, scopeWhere(req.ctx!, OWNER_FIELDS), leadWhere({ ...q, pipelineId }), q.q ? { OR: [{ name: { contains: q.q, mode: 'insensitive' } }, { companyName: { contains: q.q, mode: 'insensitive' } }, { subject: { contains: q.q, mode: 'insensitive' } }, { phone: { contains: q.q } }] } : {}] },
    orderBy: { updatedAt: 'desc' },
    take: 1000,
  });
  res.json({ pipelineId, data: await decorateLeads(req.ctx!, rows) });
}));

router.post('/leads/:id/stage', validate(IdParam, 'params'), requirePermission('crm.lead.edit'), validate(z.object({ stageId: z.string().uuid() })), tx(async (req, res) => {
  res.json(await crm.moveLead(req.ctx!, String(req.params.id), req.body.stageId));
}));
router.post('/leads/:id/lost', validate(IdParam, 'params'), requirePermission('crm.lead.edit'), validate(crm.LostInput), tx(async (req, res) => {
  res.json(await crm.loseLead(req.ctx!, String(req.params.id), req.body));
}));
router.post('/leads/:id/reopen', validate(IdParam, 'params'), requirePermission('crm.lead.edit'), tx(async (req, res) => {
  res.json(await crm.reopenLead(req.ctx!, String(req.params.id)));
}));
router.post('/leads/:id/deal', validate(IdParam, 'params'), requirePermission('crm.deal.create'), validate(crm.ConvertInput), tx(async (req, res) => {
  res.status(201).json(await crm.convertLeadToDeal(req.ctx!, String(req.params.id), req.body));
}));
router.post('/leads/bulk', requirePermission('crm.lead.edit'), validate(crm.BulkInput), tx(async (req, res) => {
  if (req.body.action === 'delete' && !(await getRolePermissions(req.ctx!.roleId)).has('crm.lead.delete')) throw new AppError('PERMISSION_DENIED', 'You do not have permission to delete leads.');
  res.json(await crm.bulkLeads(req.ctx!, req.body));
}));
router.get('/leads/:id/products', validate(IdParam, 'params'), requirePermission('crm.lead.view'), tx(async (req, res) => {
  res.json({ data: await crm.productsOf(req.ctx!, { contactId: String(req.params.id) }) });
}));
router.put('/leads/:id/products', validate(IdParam, 'params'), requirePermission('crm.lead.edit'), validate(crm.ProductsInput), tx(async (req, res) => {
  res.json({ data: await crm.setProducts(req.ctx!, { contactId: String(req.params.id) }, req.body) });
}));

// ── Deals ──
router.get('/deals', requirePermission('crm.deal.view'), validate(crm.DealList, 'query'), tx(async (req, res) => {
  res.json(await crm.listDeals(req.ctx!, req.query as unknown as z.infer<typeof crm.DealList>));
}));
router.get('/deals/:id', validate(IdParam, 'params'), requirePermission('crm.deal.view'), tx(async (req, res) => {
  res.json(await crm.getDeal(req.ctx!, String(req.params.id)));
}));
router.post('/deals', requirePermission('crm.deal.create'), validate(crm.DealInput), tx(async (req, res) => {
  res.status(201).json(await crm.createDeal(req.ctx!, req.body));
}));
router.patch('/deals/:id', validate(IdParam, 'params'), requirePermission('crm.deal.edit'), validate(crm.DealPatch), tx(async (req, res) => {
  res.json(await crm.updateDeal(req.ctx!, String(req.params.id), req.body));
}));
router.post('/deals/:id/stage', validate(IdParam, 'params'), requirePermission('crm.deal.edit'), validate(z.object({ stageId: z.string().uuid() })), tx(async (req, res) => {
  res.json(await crm.moveDeal(req.ctx!, String(req.params.id), req.body.stageId));
}));
router.post('/deals/:id/won', validate(IdParam, 'params'), requirePermission('crm.deal.edit'), tx(async (req, res) => {
  res.json(await crm.closeDeal(req.ctx!, String(req.params.id), 'won'));
}));
router.post('/deals/:id/lost', validate(IdParam, 'params'), requirePermission('crm.deal.edit'), validate(crm.LostInput), tx(async (req, res) => {
  res.json(await crm.closeDeal(req.ctx!, String(req.params.id), 'lost', req.body));
}));
router.post('/deals/:id/reopen', validate(IdParam, 'params'), requirePermission('crm.deal.edit'), tx(async (req, res) => {
  res.json(await crm.reopenDeal(req.ctx!, String(req.params.id)));
}));
router.delete('/deals/:id', validate(IdParam, 'params'), requirePermission('crm.deal.delete'), tx(async (req, res) => {
  await crm.deleteDeal(req.ctx!, String(req.params.id));
  res.status(204).end();
}));
router.put('/deals/:id/products', validate(IdParam, 'params'), requirePermission('crm.deal.edit'), validate(crm.ProductsInput), tx(async (req, res) => {
  res.json({ data: await crm.setProducts(req.ctx!, { dealId: String(req.params.id) }, req.body) });
}));

// ── Setup: pipelines, stages, sources, labels, lost reasons ──
router.get('/crm/setup', requirePermission('crm.lead.view'), tx(async (req, res) => {
  res.json(await crm.getSetup(req.ctx!));
}));
router.post('/crm/pipelines', requirePermission('crm.pipeline.edit'), validate(crm.PipelineInput), tx(async (req, res) => {
  res.status(201).json(await crm.createPipeline(req.ctx!, req.body));
}));
router.patch('/crm/pipelines/:id', validate(IdParam, 'params'), requirePermission('crm.pipeline.edit'), validate(crm.PipelineInput.partial()), tx(async (req, res) => {
  res.json(await crm.updatePipeline(req.ctx!, String(req.params.id), req.body));
}));
router.delete('/crm/pipelines/:id', validate(IdParam, 'params'), requirePermission('crm.pipeline.edit'), tx(async (req, res) => {
  await crm.deletePipeline(req.ctx!, String(req.params.id));
  res.status(204).end();
}));
router.post('/crm/stages', requirePermission('crm.pipeline.edit'), validate(crm.StageInput), tx(async (req, res) => {
  res.status(201).json(await crm.createStage(req.ctx!, req.body));
}));
router.patch('/crm/stages/:id', validate(IdParam, 'params'), requirePermission('crm.pipeline.edit'), validate(crm.StageInput.pick({ name: true, color: true, probability: true }).partial()), tx(async (req, res) => {
  res.json(await crm.updateStage(req.ctx!, String(req.params.id), req.body));
}));
router.post('/crm/stages/order', requirePermission('crm.pipeline.edit'), validate(z.object({ pipelineId: z.string().uuid(), kind: z.enum(['lead', 'deal']), ids: z.array(z.string().uuid()).min(1).max(30) })), tx(async (req, res) => {
  await crm.reorderStages(req.ctx!, req.body.pipelineId, req.body.kind, req.body.ids);
  res.json(await crm.getSetup(req.ctx!));
}));
router.delete('/crm/stages/:id', validate(IdParam, 'params'), requirePermission('crm.pipeline.edit'), tx(async (req, res) => {
  await crm.deleteStage(req.ctx!, String(req.params.id));
  res.status(204).end();
}));
router.post('/crm/options', requirePermission('crm.pipeline.edit'), validate(crm.OptionInput), tx(async (req, res) => {
  res.status(201).json(await crm.createOption(req.ctx!, req.body));
}));
router.patch('/crm/options/:id', validate(IdParam, 'params'), requirePermission('crm.pipeline.edit'), validate(crm.OptionInput.pick({ name: true, color: true }).partial()), tx(async (req, res) => {
  res.json(await crm.updateOption(req.ctx!, String(req.params.id), req.body));
}));
router.delete('/crm/options/:id', validate(IdParam, 'params'), requirePermission('crm.pipeline.edit'), tx(async (req, res) => {
  await crm.deleteOption(req.ctx!, String(req.params.id));
  res.status(204).end();
}));
router.get('/crm/report', requirePermission('crm.lead.view'), validate(z.object({ pipelineId: z.string().uuid().optional() }), 'query'), tx(async (req, res) => {
  res.json(await crm.crmReport(req.ctx!, req.query.pipelineId as string | undefined));
}));

// ── CSV/Excel import (CRM-04): the browser parses the file, the API validates and de-duplicates ──

const ImportRow = z.object({
  name: z.string().trim().min(1).max(160),
  phone: z.string().trim().max(20).optional(),
  email: z.string().trim().max(200).optional(),
  companyName: z.string().trim().max(160).optional(),
  gstin: z.string().trim().max(15).optional(),
  city: z.string().trim().max(80).optional(),
  notes: z.string().trim().max(2000).optional(),
});

router.post(
  '/contacts/import',
  requirePermission('crm.contact.create'),
  validate(
    z.object({
      type: z.enum(['customer', 'lead']).default('customer'),
      rows: z.array(z.record(z.unknown())).min(1).max(1000),
      /** skip = keep the existing record; update = fill it with the file's values */
      onDuplicate: z.enum(['skip', 'update']).default('skip'),
    }),
  ),
  tx(async (req, res) => {
    res.json(await importContacts(req.ctx!, req.body));
  }),
);

/** Import rows for one business (used by the ERP and by the Console's onboarding import). */
export async function importContacts(ctx: Pick<TenantCtx, 'tenantId' | 'userId'>, input: { type: Kind; rows: Record<string, unknown>[]; onDuplicate: 'skip' | 'update' }) {
    const { type, rows, onDuplicate } = input;
    const existing = await db().contact.findMany({ select: { id: true, phone: true, email: true } });
    const byPhone = new Map(existing.filter((e) => e.phone).map((e) => [e.phone!, e.id]));
    const byEmail = new Map(existing.filter((e) => e.email).map((e) => [e.email!, e.id]));
    const phones = new Set(byPhone.keys());
    const emails = new Set(byEmail.keys());
    const result = { created: 0, updated: 0, duplicates: [] as { row: number; name: string; reason: string }[], errors: [] as { row: number; message: string }[] };
    const toCreate: Prisma.ContactCreateManyInput[] = [];
    const toUpdate: { id: string; data: Prisma.ContactUpdateInput }[] = [];

    rows.forEach((raw, i) => {
      const parsed = ImportRow.safeParse(Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, v == null ? undefined : String(v)])));
      if (!parsed.success) return result.errors.push({ row: i + 1, message: parsed.error.issues[0].message });
      const r = parsed.data;
      const problem = (r.phone && rules.phone(r.phone)) || (r.email && rules.email(r.email)) || (r.gstin && rules.gstin(r.gstin));
      if (problem) return result.errors.push({ row: i + 1, message: problem });
      const phone = r.phone ? rules.storedPhone(r.phone) : null;
      const email = r.email ? normaliseEmail(r.email) : null;
      const gstin = r.gstin ? rules.upperNoSpaces(r.gstin) : null;
      const existingId = (phone && byPhone.get(phone)) || (email && byEmail.get(email)) || null;
      if (existingId && onDuplicate === 'update' && !toUpdate.some((u) => u.id === existingId)) {
        toUpdate.push({
          id: existingId,
          data: {
            name: r.name, ...(phone ? { phone } : {}), ...(email ? { email } : {}), ...(r.companyName ? { companyName: r.companyName } : {}),
            ...(gstin ? { gstin, stateCode: gstin.slice(0, 2) } : {}), ...(r.city ? { address: { city: r.city } } : {}), ...(r.notes ? { notes: r.notes } : {}),
            version: { increment: 1 },
          },
        });
        return;
      }
      if ((phone && phones.has(phone)) || (email && emails.has(email))) return result.duplicates.push({ row: i + 1, name: r.name, reason: phone && phones.has(phone) ? 'Phone already exists' : 'Email already exists' });
      if (phone) phones.add(phone);
      if (email) emails.add(email);
      toCreate.push({
        tenantId: ctx.tenantId, type, name: r.name, phone, email, companyName: r.companyName || null,
        gstin,
        stateCode: gstin ? gstin.slice(0, 2) : null,
        address: r.city ? { city: r.city } : undefined, notes: r.notes || null,
        leadStatus: type === 'lead' ? 'new' : null, ownerId: ctx.userId, createdBy: ctx.userId,
      });
    });

    await assertRecordLimit(ctx, 'contacts', async () => (await db().contact.count()) + toCreate.length - 1, 'customers and leads');
    if (type === 'lead' && toCreate.length) {
      const place = await crm.resolveStage(ctx as TenantCtx, 'lead');
      for (const row of toCreate) Object.assign(row, place);
    }
    if (toCreate.length) {
      const r = await db().contact.createMany({ data: toCreate });
      result.created = r.count;
      if (type === 'customer') await markOnboarding(ctx, 'firstCustomer');
    }
    for (const u of toUpdate) await db().contact.update({ where: { id: u.id }, data: u.data });
    result.updated = toUpdate.length;
    await audit({ action: 'crm.contact.import', entity: 'contact', after: { type, onDuplicate, created: result.created, updated: result.updated, duplicates: result.duplicates.length, errors: result.errors.length } });
    return result;
}

export default router;
