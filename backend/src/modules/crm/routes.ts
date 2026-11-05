import type { TenantCtx } from '../../kernel/context';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { db, withTenant } from '../../kernel/db';
import { AppError, notFound } from '../../kernel/errors';
import { normaliseEmail } from '../../kernel/crypto';
import { optionalText, zEmail, zGstin, zPhone, zPincode, zStateCode } from '../../kernel/zodRules';
import * as rules from '../../contracts/validation';
import { IdParam, ListQuery, assertRecordLimit, assertVersion, inScope, markOnboarding, page, pageArgs, scopeWhere } from '../../kernel/query';
import { validate } from '../../middleware/request';
import { requirePermission, tenantAuth, tx } from '../../middleware/auth';
import { validateCustom } from '../config/service';
import { audit } from '../audit/service';
import { notify } from '../notifications/service';

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
  address: z.object({ line1: z.string().max(200).optional(), city: z.string().max(80).optional(), pincode: zPincode.optional().or(z.literal('')) }).optional().nullable(),
  leadStatus: z.enum(['new', 'contacted', 'qualified', 'lost']).optional(),
  leadSource: optional(z.string().trim().max(60)),
  ownerId: optional(z.string().uuid()),
  branchId: optional(z.string().uuid()),
  isActive: z.boolean().optional(),
  notes: optional(z.string().max(4000)),
  custom: z.record(z.unknown()).optional(),
});
const ContactPatch = ContactInput.partial().extend({ version: z.number().int() });

const ContactList = ListQuery.extend({
  status: z.enum(['new', 'contacted', 'qualified', 'lost', 'converted']).optional(),
  active: z.enum(['true', 'false', 'all']).default('true'),
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
    const where: Prisma.ContactWhereInput = {
      AND: [
        { type: kind },
        scopeWhere(req.ctx!, OWNER_FIELDS),
        kind === 'lead' ? { leadStatus: q.status ?? { not: 'converted' } } : { isActive: q.active === 'all' ? undefined : q.active === 'true' },
        q.q
          ? { OR: [{ name: { contains: q.q, mode: 'insensitive' } }, { companyName: { contains: q.q, mode: 'insensitive' } }, { phone: { contains: q.q } }, { email: { contains: q.q, mode: 'insensitive' } }] }
          : {},
      ],
    };
    const rows = await db().contact.findMany({ where, ...pageArgs(q) });
    res.json(page(rows, q.limit));
  }));

  router.post(base, requirePermission(perm(kind, 'create')), validate(ContactInput.extend({ allowDuplicate: z.boolean().default(false) })), tx(async (req, res) => {
    const ctx = req.ctx!;
    const { allowDuplicate, ...body } = req.body as z.infer<typeof ContactInput> & { allowDuplicate: boolean };
    await assertRecordLimit(ctx, 'contacts', () => db().contact.count(), 'customers and leads');
    await checkOwner(body.ownerId);
    if (!allowDuplicate) {
      const dup = await findDuplicate(body.phone, body.email);
      if (dup) throw new AppError('CONFLICT', `${dup.name} already has this phone or email.`, { duplicateId: dup.id, duplicateType: dup.type });
    }
    const custom = await validateCustom(ctx.tenantId, kind === 'lead' ? 'lead' : 'contact', body.custom);
    const contact = await db().contact.create({
      data: {
        ...body,
        address: body.address ?? undefined,
        tenantId: ctx.tenantId,
        type: kind,
        leadStatus: kind === 'lead' ? (body.leadStatus ?? 'new') : null,
        ownerId: body.ownerId ?? ctx.userId,
        createdBy: ctx.userId,
        custom: custom as Prisma.InputJsonValue,
      },
    });
    if (kind === 'customer') await markOnboarding(ctx, 'firstCustomer');
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
  const [activities, invoices, appointments, owner] = await Promise.all([
    db().activity.findMany({ where: { contactId: c.id }, orderBy: { createdAt: 'desc' }, take: 100 }),
    db().salesDocument.findMany({
      where: { contactId: c.id, kind: { not: 'opening_balance' } },
      orderBy: { issueDate: 'desc' },
      take: 20,
      select: { id: true, kind: true, number: true, status: true, issueDate: true, totalPaise: true, paidPaise: true },
    }),
    db().appointment.findMany({ where: { contactId: c.id }, orderBy: { startAt: 'desc' }, take: 20, select: { id: true, title: true, startAt: true, status: true } }),
    c.ownerId ? db().user.findUnique({ where: { id: c.ownerId }, select: { id: true, name: true } }) : null,
  ]);
  const userIds = [...new Set(activities.flatMap((a) => [a.createdBy, a.assigneeId]).filter(Boolean))] as string[];
  const users = await db().user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } });
  const names = Object.fromEntries(users.map((u) => [u.id, u.name]));
  res.json({ ...c, owner, activities: activities.map((a) => ({ ...a, createdByName: a.createdBy ? names[a.createdBy] : null, assigneeName: a.assigneeId ? names[a.assigneeId] : null })), documents: invoices, appointments });
}));

router.patch('/contacts/:id', validate(IdParam, 'params'), dynamicPermission('edit'), validate(ContactPatch), tx(async (req, res) => {
  const ctx = req.ctx!;
  const c = await loadInScope(req);
  const { version, ...body } = req.body as z.infer<typeof ContactPatch>;
  assertVersion(c.version, version, 'record');
  await checkOwner(body.ownerId);
  if (body.phone || body.email) {
    const dup = await findDuplicate(body.phone, body.email, c.id);
    if (dup) throw new AppError('CONFLICT', `${dup.name} already has this phone or email.`, { duplicateId: dup.id });
  }
  const custom = body.custom ? await validateCustom(ctx.tenantId, c.type === 'lead' ? 'lead' : 'contact', body.custom, c.custom as Record<string, unknown>) : undefined;
  const updated = await db().contact.update({
    where: { id: c.id },
    data: { ...body, address: body.address === null ? undefined : body.address, leadStatus: c.type === 'lead' ? body.leadStatus : undefined, custom: custom as Prisma.InputJsonValue | undefined, version: { increment: 1 } },
  });
  if (body.ownerId && body.ownerId !== c.ownerId && body.ownerId !== ctx.userId) await notify(body.ownerId, `${c.name} was assigned to you`, undefined, `/app/m/crm/${c.id}`);
  res.json(updated);
}));

router.delete('/contacts/:id', validate(IdParam, 'params'), dynamicPermission('delete'), tx(async (req, res) => {
  const c = await loadInScope(req);
  const [invoices, receipts] = await Promise.all([db().salesDocument.count({ where: { contactId: c.id } }), db().payment.count({ where: { contactId: c.id } })]);
  const docs = invoices + receipts;
  if (docs) {
    // Customers with invoices or advances are kept for the records; they are deactivated instead
    await db().contact.update({ where: { id: c.id }, data: { isActive: false, version: { increment: 1 } } });
  } else {
    await db().activity.deleteMany({ where: { contactId: c.id } });
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

// ── Timeline (CRM-03) ──

const ActivityInput = z.object({
  type: z.enum(['note', 'call', 'meeting', 'follow_up']),
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
  if (body.type === 'follow_up' && !body.dueAt) throw new AppError('VALIDATION_FAILED', 'Follow-ups need a date.', { fields: { dueAt: 'Required' } });
  if (!body.title && !body.body) throw new AppError('VALIDATION_FAILED', 'Add a title or note.', { fields: { body: 'Required' } });
  await checkOwner(body.assigneeId);
  const a = await db().activity.create({
    data: { ...body, dueAt: body.dueAt ? new Date(body.dueAt) : null, tenantId: ctx.tenantId, contactId: c.id, createdBy: ctx.userId, assigneeId: body.assigneeId ?? (body.type === 'follow_up' ? ctx.userId : null) },
  });
  if (c.type === 'lead' && c.leadStatus === 'new' && (body.type === 'call' || body.type === 'meeting')) {
    await db().contact.update({ where: { id: c.id }, data: { leadStatus: 'contacted', version: { increment: 1 } } });
  }
  if (a.assigneeId && a.assigneeId !== ctx.userId) await notify(a.assigneeId, `Follow-up with ${c.name}`, body.title, `/app/m/crm/${c.id}`);
  res.status(201).json(a);
}));

router.patch('/activities/:id', validate(IdParam, 'params'), requirePermission('crm.activity.edit'), validate(z.object({ completed: z.boolean() })), tx(async (req, res) => {
  const a = await db().activity.findUnique({ where: { id: String(req.params.id) } });
  if (!a || !inScope(req.ctx!, a, { owner: ['createdBy', 'assigneeId'] })) throw notFound('Activity');
  res.json(await db().activity.update({ where: { id: a.id }, data: { completedAt: req.body.completed ? new Date() : null } }));
}));

/** Follow-ups due for the current user (dashboard + reminders) */
router.get('/follow-ups', requirePermission('crm.activity.view'), tx(async (req, res) => {
  const rows = await db().activity.findMany({
    where: { type: 'follow_up', completedAt: null, AND: [scopeWhere(req.ctx!, { owner: ['assigneeId', 'createdBy'] })] },
    orderBy: { dueAt: 'asc' },
    take: 50,
  });
  const contacts = await db().contact.findMany({ where: { id: { in: rows.map((r) => r.contactId) } }, select: { id: true, name: true, phone: true } });
  const byId = Object.fromEntries(contacts.map((c) => [c.id, c]));
  res.json({ data: rows.map((r) => ({ ...r, contact: byId[r.contactId] ?? null })) });
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
