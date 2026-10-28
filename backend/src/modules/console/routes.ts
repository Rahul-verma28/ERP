import { Router, type Request } from 'express';
import { z } from 'zod';
import { db } from '../../kernel/db';
import { AppError } from '../../kernel/errors';
import { IdParam, ListQuery } from '../../kernel/query';
import { optionalText, zEmail, zGstin, zMobileIN, zPersonName, zStateCode } from '../../kernel/zodRules';
import { gstinStateMismatch } from '../../contracts/validation';
import { validate } from '../../middleware/request';
import { consoleAuth, consoleTx, requirePlatformPermission } from '../../middleware/auth';
import { SETTINGS, SETTING_KEYS, type SettingKey } from '../../contracts/settings';
import { listSettings, resetSetting, setSetting } from '../settings/service';
import { changeAcquisition } from '../tenancy/acquisition';
import { consoleAccess } from './service';
import { assertClientInScope, clientDetail, extendClient, listClients, vendorView } from './clients';
import { catalogAdmin, createCoupon, endCoupon, setPrice, updatePlan } from './catalogAdmin';
import { addMember, consoleRoles, listMembers, updateMember } from './members';
import { accountHealth, consoleHome, type Audience } from './insights';
import { clientSummary, clientTimeline, clientUsers } from './client360';
import { addNote, closeFollowup, createFollowup, createProspect, FollowupInput, listFollowups, listNotes, listProspects, NoteInput, ProspectInput, ProspectPatch, STAGES, updateProspect } from './sales';
import { changePartnerClientPlan, createPartner, createPartnerClient, listPartners, partnerBill, partnerDetail, PartnerClientInput, PartnerInput, PartnerPatch, updatePartner } from './partners';
import { myReferral } from './referral';
import { approveOrder, cancelOrder, capturePayment, convertClient, createPaidClient, quote } from '../platformBilling/service';
import { invoiceDetail, listOrders, orderDetail } from '../platformBilling/orders';
import { issueCreditNote, sendPaymentLink } from '../platformBilling/online';

// Console API. Every route: Console token + one platform.* permission. Three audiences share it:
// the AHEAD team, vendors (own clients) and partners (their partner's clients only — enforced in
// scopedTenantFilter for every client query).

const router = Router();
router.use(consoleAuth);
const ctx = (req: { console?: unknown }) => req.console as NonNullable<Express.Request['console']>;

/** Short notes kept only where money or access is at stake (extend a trial, cancel, refund). */
const zNote = z.string().trim().min(5, 'Add a short note (5+ characters)').max(300);

router.get('/me', async (req, res) => {
  res.json(await consoleAccess(ctx(req).userId));
});

// ── Home ──
router.get('/home', requirePlatformPermission('platform.dashboard.view'), consoleTx(async (req, res) => {
  const access = await consoleAccess(ctx(req).userId);
  const p = (access?.permissions ?? {}) as Record<string, string>;
  res.json(await consoleHome(ctx(req), (access?.audience ?? 'team') as Audience, {
    discount: !!p['platform.discount.approve'], income: !!p['platform.revenue.view'], payments: !!p['platform.payment.view'], leads: !!p['platform.prospect.view'],
  }));
}));

/** Vendors and salespeople: their referral link and code */
router.get('/referral', requirePlatformPermission('platform.tenant.view'), consoleTx(async (req, res) => {
  res.json(await myReferral(ctx(req)));
}));

// ── Clients ──
const ClientQuery = ListQuery.extend({
  search: z.string().trim().max(80).optional(),
  status: z.enum(['incomplete', 'trialing', 'active', 'past_due', 'free', 'closed', 'purged']).optional(),
  source: z.enum(['direct', 'vendor', 'sales', 'partner']).optional(),
  ownerId: z.string().uuid().optional(),
});

router.get('/tenants', requirePlatformPermission('platform.tenant.view'), validate(ClientQuery, 'query'), consoleTx(async (req, res) => {
  res.json(await listClients(ctx(req), req.query as unknown as z.infer<typeof ClientQuery>));
}));

router.get('/tenants/:id', requirePlatformPermission('platform.tenant.view'), validate(IdParam, 'params'), consoleTx(async (req, res) => {
  const detail = await clientDetail(ctx(req), String(req.params.id));
  res.json((await consoleAccess(ctx(req).userId))?.audience === 'vendor' ? vendorView(detail) : detail);
}));

const inScope = async (req: Request) => assertClientInScope(ctx(req), String(req.params.id));

router.get('/tenants/:id/summary', requirePlatformPermission('platform.tenant.view'), validate(IdParam, 'params'), consoleTx(async (req, res) => {
  await inScope(req);
  res.json(await clientSummary(String(req.params.id)));
}));

// Account health and the client's users: counts and names only — not for vendors (platform design §1)
router.get('/tenants/:id/health', requirePlatformPermission('platform.tenant.view'), validate(IdParam, 'params'), consoleTx(async (req, res) => {
  await notVendor(req);
  await inScope(req);
  res.json(await accountHealth(String(req.params.id)));
}));

router.get('/tenants/:id/users', requirePlatformPermission('platform.tenant.view'), validate(IdParam, 'params'), consoleTx(async (req, res) => {
  await notVendor(req);
  await inScope(req);
  res.json({ data: await clientUsers(String(req.params.id)) });
}));

router.get('/tenants/:id/timeline', requirePlatformPermission('platform.tenant.view'), validate(IdParam, 'params'), consoleTx(async (req, res) => {
  await inScope(req);
  res.json({ data: await clientTimeline(String(req.params.id)) });
}));

router.get('/tenants/:id/notes', requirePlatformPermission('platform.note.view'), validate(IdParam, 'params'), consoleTx(async (req, res) => {
  await inScope(req);
  res.json({ data: await listNotes(ctx(req), String(req.params.id)) });
}));

router.post('/tenants/:id/notes', requirePlatformPermission('platform.note.create'), validate(IdParam, 'params'), validate(NoteInput), consoleTx(async (req, res) => {
  await inScope(req);
  res.status(201).json(await addNote(ctx(req), String(req.params.id), req.body));
}));

const AcquisitionBody = z.object({
  byType: z.enum(['self', 'vendor', 'sales_user', 'partner_user']),
  byUserId: z.string().uuid().nullish(),
  method: z.enum(['signup', 'referral_link', 'referral_code', 'manual']),
  referralCode: z.string().trim().max(40).nullish(),
  couponCode: z.string().trim().max(20).nullish(),
  reason: zNote,
});

router.patch('/tenants/:id/acquisition', requirePlatformPermission('platform.tenant.edit'), validate(IdParam, 'params'), validate(AcquisitionBody), consoleTx(async (req, res) => {
  if (ctx(req).partnerId) throw new AppError('PERMISSION_DENIED', 'Only AHEAD changes who brought a client in.');
  const id = String(req.params.id);
  await assertClientInScope(ctx(req), id);
  const b = req.body as z.infer<typeof AcquisitionBody>;
  res.json(await changeAcquisition(id, { byType: b.byType, byUserId: b.byUserId ?? undefined, method: b.method, referralCode: b.referralCode ?? undefined, couponCode: b.couponCode ?? undefined }, ctx(req).userId, b.reason));
}));

router.post('/tenants/:id/extend', requirePlatformPermission('platform.grace.create'), validate(IdParam, 'params'), validate(z.object({ days: z.number().int().min(1).max(30), reason: zNote })), consoleTx(async (req, res) => {
  res.status(201).json(await extendClient(ctx(req), String(req.params.id), req.body));
}));

/** Partners: move one of their clients to another plan (on the next monthly bill) */
router.put('/tenants/:id/plan', requirePlatformPermission('platform.tenant.edit'), validate(IdParam, 'params'), validate(z.object({ planKey: z.string().max(40) })), consoleTx(async (req, res) => {
  res.json(await changePartnerClientPlan(ctx(req), String(req.params.id), req.body.planKey));
}));

// ── New client: AHEAD sales and vendors (paid order) or partners (live at once, partner-billed) ──
const OrderInput = z.object({
  planKey: z.string().max(40),
  cycle: z.enum(['monthly', 'yearly']),
  addOns: z.array(z.string().max(40)).max(20).default([]),
  extraUsers: z.number().int().min(0).max(500).default(0),
  discountPercent: z.number().min(0).max(100).default(0),
  couponCode: z.string().trim().max(20).nullish(),
});

router.post('/quote', requirePlatformPermission('platform.tenant.create'), validate(OrderInput.extend({ stateCode: zStateCode })), consoleTx(async (req, res) => {
  const { stateCode, ...order } = req.body as z.infer<typeof OrderInput> & { stateCode: string };
  const role = await db().role.findUniqueOrThrow({ where: { id: ctx(req).roleId }, select: { key: true } });
  res.json(await quote({ ...order, billTo: { name: '', stateCode } }, { actorRoleKey: role.key }));
}));

const NewClientBody = z.object({
  business: z.object({
    name: z.string().trim().min(2).max(120),
    industryKey: z.string().max(40),
    gstin: optionalText(zGstin),
    stateCode: zStateCode,
    address: z.string().trim().max(300).nullish(),
  }),
  owner: z.object({ name: zPersonName, email: zEmail, mobile: zMobileIN }),
  order: OrderInput,
}).superRefine((b, c) => {
  const mismatch = gstinStateMismatch(b.business.gstin, b.business.stateCode);
  if (mismatch) c.addIssue({ code: z.ZodIssueCode.custom, path: ['business', 'gstin'], message: mismatch });
});

router.post('/clients', requirePlatformPermission('platform.tenant.create'), validate(NewClientBody), consoleTx(async (req, res) => {
  if (ctx(req).partnerId) throw new AppError('PERMISSION_DENIED', 'Partners add clients from their own panel.');
  res.status(201).json(await createPaidClient(ctx(req), req.body));
}));

router.post('/partner-clients', requirePlatformPermission('platform.tenant.create'), validate(PartnerClientInput), consoleTx(async (req, res) => {
  res.status(201).json(await createPartnerClient(ctx(req), req.body));
}));

router.post('/tenants/:id/convert', requirePlatformPermission('platform.tenant.create'), validate(IdParam, 'params'), validate(OrderInput), consoleTx(async (req, res) => {
  await inScope(req);
  res.status(201).json(await convertClient(ctx(req), String(req.params.id), req.body));
}));

// ── Partners (AHEAD) and the partner's own bill ──
const aheadOnly = (req: Request) => {
  if (ctx(req).partnerId) throw new AppError('PERMISSION_DENIED', 'This is for the AHEAD team.');
};

router.get('/partners', requirePlatformPermission('platform.partner.view'), consoleTx(async (req, res) => {
  aheadOnly(req);
  res.json({ data: await listPartners() });
}));

router.post('/partners', requirePlatformPermission('platform.partner.create'), validate(PartnerInput), consoleTx(async (req, res) => {
  aheadOnly(req);
  res.status(201).json(await createPartner(ctx(req), req.body));
}));

router.get('/partners/:id', requirePlatformPermission('platform.partner.view'), validate(IdParam, 'params'), consoleTx(async (req, res) => {
  aheadOnly(req);
  res.json(await partnerDetail(String(req.params.id)));
}));

router.patch('/partners/:id', requirePlatformPermission('platform.partner.edit'), validate(IdParam, 'params'), validate(PartnerPatch), consoleTx(async (req, res) => {
  aheadOnly(req);
  res.json(await updatePartner(String(req.params.id), req.body));
}));

router.get('/billing', requirePlatformPermission('platform.partner.view'), consoleTx(async (req, res) => {
  const partnerId = ctx(req).partnerId;
  if (!partnerId) throw new AppError('PERMISSION_DENIED', 'The monthly bill is for partners.');
  res.json(await partnerBill(partnerId));
}));

// ── Plans, prices, coupons ──
router.get('/catalog', requirePlatformPermission('platform.plan.view'), consoleTx(async (_req, res) => {
  res.json(await catalogAdmin());
}));

const PlanBody = z.object({
  name: z.string().trim().min(2).max(40).optional(),
  tagline: z.string().trim().max(120).nullish(),
  limits: SETTINGS['trial.limits'].schema.optional(),
  isPublic: z.boolean().optional(),
  fullModules: z.array(z.string()).max(20).optional(),
});

router.patch('/plans/:key', requirePlatformPermission('platform.plan.edit'), validate(z.object({ key: z.string().max(40) }), 'params'), validate(PlanBody), consoleTx(async (req, res) => {
  res.json(await updatePlan(String(req.params.key), req.body));
}));

const PriceBody = z.object({
  itemType: z.enum(['plan', 'addon_module', 'extra_user']),
  itemRef: z.string().max(40),
  cycle: z.enum(['monthly', 'yearly']),
  amountPaise: z.number().int().min(0).max(1e10),
});

router.put('/prices', requirePlatformPermission('platform.plan.edit'), validate(PriceBody), consoleTx(async (req, res) => {
  res.json(await setPrice(req.body));
}));

const CouponBody = z.object({
  code: z.string().trim().regex(/^[A-Za-z0-9_-]{3,20}$/, '3–20 letters, digits, - or _'),
  type: z.enum(['percent', 'flat']),
  value: z.number().int().positive(),
  appliesTo: z.string().trim().max(40).default('all'),
  validFrom: z.string().datetime().nullish(),
  validTo: z.string().datetime().nullish(),
  maxRedemptions: z.number().int().positive().nullish(),
});

router.post('/coupons', requirePlatformPermission('platform.plan.edit'), validate(CouponBody), consoleTx(async (req, res) => {
  res.status(201).json(await createCoupon(req.body));
}));

router.post('/coupons/:code/end', requirePlatformPermission('platform.plan.edit'), validate(z.object({ code: z.string().max(20) }), 'params'), consoleTx(async (req, res) => {
  res.json(await endCoupon(String(req.params.code)));
}));

// ── Settings ──
router.get('/settings', requirePlatformPermission('platform.setting.view'), async (_req, res) => {
  res.json({ data: await listSettings() });
});

const SettingParam = z.object({ key: z.enum(SETTING_KEYS as [SettingKey, ...SettingKey[]]) });

router.put('/settings/:key', requirePlatformPermission('platform.setting.edit'), validate(SettingParam, 'params'), validate(z.object({ value: z.unknown() })), consoleTx(async (req, res) => {
  res.json(await setSetting(req.params.key as SettingKey, req.body.value, ctx(req).userId));
}));

router.delete('/settings/:key', requirePlatformPermission('platform.setting.edit'), validate(SettingParam, 'params'), consoleTx(async (req, res) => {
  await resetSetting(req.params.key as SettingKey, ctx(req).userId);
  res.status(204).end();
}));

// ── Team (AHEAD's, or a partner's own) ──
router.get('/roles', requirePlatformPermission('platform.member.view'), consoleTx(async (req, res) => {
  res.json({ data: await consoleRoles(ctx(req)) });
}));

router.get('/members', requirePlatformPermission('platform.member.view'), consoleTx(async (req, res) => {
  res.json({ data: await listMembers(ctx(req)) });
}));

const MemberBody = z.object({
  email: z.string().trim().email(),
  name: z.string().trim().min(2).max(100).optional(),
  mobile: z.string().trim().min(8).max(20).optional(),
  roleKey: z.string().max(40),
  reportsTo: z.string().uuid().nullish(),
});

router.post('/members', requirePlatformPermission('platform.member.create'), validate(MemberBody), consoleTx(async (req, res) => {
  res.status(201).json(await addMember(ctx(req), req.body));
}));

const MemberPatch = z.object({
  roleKey: z.string().max(40).optional(),
  reportsTo: z.string().uuid().nullable().optional(),
  status: z.enum(['active', 'deactivated']).optional(),
});

router.patch('/members/:id', requirePlatformPermission('platform.member.edit'), validate(IdParam, 'params'), validate(MemberPatch), consoleTx(async (req, res) => {
  res.json(await updateMember(ctx(req), String(req.params.id), req.body));
}));

// ── Orders, payments and AHEAD invoices ──
const OrderQuery = ListQuery.extend({
  status: z.enum(['pending_approval', 'awaiting_payment', 'paid', 'cancelled']).optional(),
  tenantId: z.string().uuid().optional(),
});

router.get('/orders', requirePlatformPermission('platform.payment.view'), validate(OrderQuery, 'query'), consoleTx(async (req, res) => {
  res.json(await listOrders(ctx(req), req.query as unknown as z.infer<typeof OrderQuery>));
}));

router.get('/orders/:id', requirePlatformPermission('platform.payment.view'), validate(IdParam, 'params'), consoleTx(async (req, res) => {
  res.json(await orderDetail(ctx(req), String(req.params.id)));
}));

router.post('/orders/:id/approve', requirePlatformPermission('platform.discount.approve'), validate(IdParam, 'params'), consoleTx(async (req, res) => {
  await approveOrder(ctx(req), String(req.params.id));
  res.json(await orderDetail(ctx(req), String(req.params.id)));
}));

router.post('/orders/:id/cancel', requirePlatformPermission('platform.payment.approve'), validate(IdParam, 'params'), validate(z.object({ reason: zNote })), consoleTx(async (req, res) => {
  await cancelOrder(String(req.params.id), req.body.reason);
  res.json(await orderDetail(ctx(req), String(req.params.id)));
}));

const OfflinePayment = z.object({
  method: z.enum(['bank_transfer', 'upi', 'cheque', 'cash']),
  amountPaise: z.number().int().positive(),
  reference: z.string().trim().min(3, 'UTR, cheque or receipt number').max(80),
  receivedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'),
});

router.post('/orders/:id/payments', requirePlatformPermission('platform.payment.create'), validate(IdParam, 'params'), validate(OfflinePayment), consoleTx(async (req, res) => {
  const b = req.body as z.infer<typeof OfflinePayment>;
  const out = await capturePayment(String(req.params.id), { method: b.method, amountPaise: b.amountPaise, reference: b.reference, receivedAt: new Date(`${b.receivedOn}T12:00:00+05:30`), recordedBy: ctx(req).userId });
  res.status(201).json({ invoiceId: out.invoice.id, invoiceNumber: out.invoice.number });
}));

router.get('/invoices/:id', requirePlatformPermission('platform.payment.view'), validate(IdParam, 'params'), consoleTx(async (req, res) => {
  const invoice = await invoiceDetail(ctx(req), String(req.params.id));
  const creditNote = await db().platformCreditNote.findUnique({ where: { invoiceId: invoice.id } });
  res.json({ ...invoice, creditNote: creditNote && { id: creditNote.id, number: creditNote.number, reason: creditNote.reason, totalPaise: Number(creditNote.totalPaise), issuedAt: creditNote.issuedAt } });
}));

router.post('/orders/:id/payment-link', requirePlatformPermission('platform.payment.view'), validate(IdParam, 'params'), validate(z.object({ resend: z.boolean().default(false) })), consoleTx(async (req, res) => {
  await orderDetail(ctx(req), String(req.params.id)); // scope check
  res.json(await sendPaymentLink(String(req.params.id), { resend: req.body.resend }));
}));

router.post('/invoices/:id/credit-note', requirePlatformPermission('platform.payment.approve'), validate(IdParam, 'params'), validate(z.object({ reason: zNote, endSubscription: z.boolean().default(false) })), consoleTx(async (req, res) => {
  await invoiceDetail(ctx(req), String(req.params.id)); // scope check
  const note = await issueCreditNote(ctx(req), String(req.params.id), req.body);
  res.status(201).json({ id: note.id, number: note.number });
}));

// ── Leads: prospects and follow-ups ──
const ProspectQuery = z.object({ stage: z.enum(STAGES).optional(), search: z.string().trim().max(80).optional() });

router.get('/prospects', requirePlatformPermission('platform.prospect.view'), validate(ProspectQuery, 'query'), consoleTx(async (req, res) => {
  res.json({ data: await listProspects(ctx(req), req.query as z.infer<typeof ProspectQuery>) });
}));

router.post('/prospects', requirePlatformPermission('platform.prospect.create'), validate(ProspectInput), consoleTx(async (req, res) => {
  res.status(201).json(await createProspect(ctx(req), req.body));
}));

router.patch('/prospects/:id', requirePlatformPermission('platform.prospect.edit'), validate(IdParam, 'params'), validate(ProspectPatch), consoleTx(async (req, res) => {
  res.json(await updateProspect(ctx(req), String(req.params.id), req.body));
}));

const FollowupQuery = z.object({ mine: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'), days: z.coerce.number().int().min(1).max(90).default(7) });

router.get('/followups', requirePlatformPermission('platform.prospect.view'), validate(FollowupQuery, 'query'), consoleTx(async (req, res) => {
  res.json({ data: await listFollowups(ctx(req), req.query as unknown as z.infer<typeof FollowupQuery>) });
}));

router.post('/followups', requirePlatformPermission('platform.prospect.create'), validate(FollowupInput), consoleTx(async (req, res) => {
  const b = req.body as z.infer<typeof FollowupInput>;
  if (b.tenantId) await assertClientInScope(ctx(req), b.tenantId);
  res.status(201).json(await createFollowup(ctx(req), b));
}));

const CloseFollowup = z.object({ done: z.boolean().optional(), snoozeDays: z.number().int().min(1).max(30).optional() }).refine((b) => b.done || b.snoozeDays, 'Mark it done or pick a snooze');

router.post('/followups/:id/close', requirePlatformPermission('platform.prospect.edit'), validate(IdParam, 'params'), validate(CloseFollowup), consoleTx(async (req, res) => {
  res.json(await closeFollowup(ctx(req), String(req.params.id), req.body));
}));

async function notVendor(req: Request) {
  if ((await consoleAccess(ctx(req).userId))?.audience === 'vendor') throw new AppError('PERMISSION_DENIED', 'Vendors see a client’s name, plan and status only.');
}

export default router;
