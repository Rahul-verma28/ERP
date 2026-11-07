import { Router } from 'express';
import { z } from 'zod';
import { db, withPlatform } from '../../kernel/db';
import { notFound } from '../../kernel/errors';
import { validate } from '../../middleware/request';
import { publicRoute, requirePermission, tenantAuth, tx } from '../../middleware/auth';
import { lookupLimiter, publicLimiter } from '../../middleware/rateLimit';
import { ApplicationInput, submitApplication } from '../console/applications';
import { PERMISSIONS } from '../../contracts/permissions';
import { DEFAULT_TERMS, TEMPLATES, templateByKey } from '../../contracts/templates';
import { getEntitlements } from '../subscription/entitlements';
import { getCatalog } from '../subscription/catalog';
import { visibleRoles } from '../access/service';
import { audit, listAudit } from '../audit/service';
import { listNotifications, markRead } from '../notifications/service';
import { FieldInput, FieldPatch, createField, getTerms, listFields, putTerms, updateField } from '../config/service';
import * as tenancy from './service';
import * as workspace from './workspace';
import * as security from './security';
import * as roles from './roles';
import * as messages from './messages';
import * as data from './data';
import { adminResetMfa } from '../account/service';
import { zReason } from '../../kernel/zodRules';
import { INDUSTRIES, industryTemplateKey } from '../../contracts/workspace';
import { zEmail, zMobileIN } from '../../kernel/zodRules';
import { acceptHandover, handoverForOwner } from '../console/onboarding';

// Platform routes for the signed-in tenant (LLD §10.2, §10.3) plus a few public lookups.

const router = Router();
const id = z.object({ id: z.string().uuid() });

// ── Public lookups ──
router.get('/public/industries', publicRoute, publicLimiter, (_req, res) => {
  const fieldLabels = (t: (typeof TEMPLATES)[number]) => t.fields.map((f) => f.label);
  res.json({
    // Templates with what a new business gets (signup "You'll get" panel)
    data: TEMPLATES.map((t) => ({
      key: t.key, name: t.name, description: t.description, modules: t.modules,
      terms: { ...DEFAULT_TERMS, ...t.terms }, fields: fieldLabels(t), dashboard: t.dashboard, starterItems: t.catalogSeed.length,
    })),
    industries: INDUSTRIES,
  });
});

// Signup step 1: tell people early that they already have an account
router.get(
  '/public/signup/check',
  publicRoute,
  lookupLimiter,
  validate(z.object({ email: zEmail.optional(), mobile: zMobileIN.optional() }), 'query'),
  async (req, res) => {
    const q = req.query as { email?: string; mobile?: string };
    const taken = await withPlatform(async () => ({
      email: q.email ? !!(await db().user.findUnique({ where: { email: q.email }, select: { id: true } })) : false,
      mobile: q.mobile ? !!(await db().user.findUnique({ where: { mobile: q.mobile }, select: { id: true } })) : false,
    }));
    res.json(taken);
  },
);

// Signup step 4: live check of a referral/coupon code (what it gives, never who owns it)
/** Website: apply to become an AHEAD vendor or partner (an Admin decides in the Console) */
router.post('/public/applications', publicRoute, lookupLimiter, validate(ApplicationInput), async (req, res) => {
  res.status(201).json(await withPlatform(() => submitApplication(req.body)));
});

router.get('/public/coupons/:code', publicRoute, lookupLimiter, validate(z.object({ code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{2,20}$/, 'Use letters and digits') }), 'params'), async (req, res) => {
  const code = String(req.params.code);
  const c = await withPlatform(() => db().coupon.findUnique({ where: { code } }));
  const now = new Date();
  const valid = !!c && (!c.validFrom || c.validFrom <= now) && (!c.validTo || c.validTo > now) && (c.maxRedemptions === null || c.redeemed < c.maxRedemptions);
  if (!c || !valid) return res.json({ valid: false, message: c ? 'This code has expired' : "We couldn't find this code" });
  const off = c.type === 'percent' ? `${c.value}% off` : `₹${(c.value / 100).toLocaleString('en-IN')} off`;
  res.json({ valid: true, message: `${off} your first paid ${c.appliesTo === 'all' ? 'plan' : `${c.appliesTo} plan`}` });
});

router.get('/billing/plans', publicRoute, publicLimiter, async (_req, res) => {
  const catalog = await getCatalog();
  res.json({
    plans: catalog.plans.filter((p) => p.isPublic).map(({ isPublic: _, ...p }) => p),
    modules: catalog.modules,
    extraUserMonthlyPaise: catalog.extraUserMonthlyPaise,
    currency: 'INR',
  });
});

router.get('/invitations/:token', publicRoute, publicLimiter, async (req, res) => {
  res.json(await tenancy.invitationPreview(String(req.params.token)));
});

router.post('/invitations/:token/accept', publicRoute, publicLimiter, validate(tenancy.AcceptInput), async (req, res) => {
  res.json(await tenancy.acceptInvitation(String(req.params.token), req.body));
});

// Everything below needs a signed-in member of the tenant
router.use(tenantAuth);

// ── Directory: names of active users for assignee/owner pickers (any member) ──
router.get('/directory/users', tx(async (_req, res) => {
  const members = await db().tenantMember.findMany({ where: { status: 'active' }, include: { user: { select: { id: true, name: true } }, role: { select: { key: true, name: true } } } });
  res.json({ data: members.map((m) => ({ id: m.user.id, name: m.user.name, roleKey: m.role.key, roleName: m.role.name })).sort((a, b) => a.name.localeCompare(b.name)) });
}));

// Active custom field definitions for data-entry forms (definitions are not sensitive; values are)
router.get('/forms/fields', validate(z.object({ entity: z.string().max(40) }), 'query'), tx(async (req, res) => {
  const rows = await listFields((req.query as { entity: string }).entity);
  res.json({ data: rows.filter((f) => !f.archivedAt) });
}));

// ── Tenant profile ──
router.get('/tenant', requirePermission('tenant.settings.view'), tx(async (req, res) => {
  const [t, issued, last] = await Promise.all([
    tenancy.getTenant(req.ctx!.tenantId),
    db().salesDocument.count({ where: { kind: 'invoice', number: { not: null } } }),
    db().auditLog.findFirst({ where: { action: { in: ['tenant.update', 'tenant.profile.update'] } }, orderBy: { at: 'desc' }, select: { at: true, actorId: true } }),
  ]);
  const by = last?.actorId ? await withPlatform(() => db().user.findUnique({ where: { id: last.actorId! }, select: { name: true } })) : null;
  // The financial year can't change once an invoice is numbered
  res.json({ ...t, fyLocked: issued > 0, lastChange: last ? { at: last.at, by: by?.name ?? null } : null });
}));
router.patch('/tenant', requirePermission('tenant.settings.edit'), validate(tenancy.TenantPatch), tx(async (req, res) => {
  res.json(await tenancy.updateTenant(req.ctx!.tenantId, req.body));
}));
// Console handover (blueprint Phase B): the owner sees "your workspace is ready" and accepts it
router.get('/tenant/handover', tx(async (req, res) => {
  res.json({ handover: await handoverForOwner(req.ctx!.tenantId, req.ctx!.userId) });
}));
router.post('/tenant/handover/accept', tx(async (req, res) => {
  res.json(await acceptHandover(req.ctx!.tenantId, req.ctx!.userId));
}));
router.get('/tenant/onboarding', requirePermission('tenant.settings.view'), tx(async (req, res) => {
  res.json(await tenancy.onboardingStatus(req.ctx!.tenantId));
}));

// ── Workspace: signup answers, preferences, setup wizard (Phase 1) ──
router.get('/tenant/workspace', requirePermission('tenant.settings.view'), tx(async (req, res) => {
  res.json(await workspace.getWorkspace(req.ctx!.tenantId));
}));
router.patch('/tenant/profile', requirePermission('tenant.settings.edit'), validate(workspace.ProfileInput), tx(async (req, res) => {
  res.json(await workspace.updateProfile(req.ctx!.tenantId, req.body));
}));
router.put(
  '/tenant/preferences/:section',
  requirePermission('tenant.settings.edit'),
  validate(z.object({ section: z.enum(['documents', 'payments', 'taxes', 'inventory', 'branding']) }), 'params'),
  tx(async (req, res) => {
    res.json(await workspace.updatePreferences(req.ctx!.tenantId, req.params.section as workspace.PreferenceSection, req.body));
  }),
);
router.post('/tenant/sequences/invoice-start', requirePermission('tenant.settings.edit'), validate(z.object({ startAt: z.number().int().min(1, 'Start at 1 or more').max(9_999_999) })), tx(async (req, res) => {
  await workspace.setInvoiceStart(req.ctx!.tenantId, req.body.startAt);
  res.status(204).end();
}));
router.get('/tenant/sequences', requirePermission('tenant.settings.view'), tx(async (req, res) => {
  res.json(await workspace.listSequences(req.ctx!.tenantId));
}));
router.put(
  '/tenant/sequences/:docType',
  requirePermission('tenant.settings.edit'),
  validate(z.object({ docType: z.enum(['invoice', 'quotation', 'receipt']) }), 'params'),
  validate(z.object({ nextNo: z.number().int().min(1, 'Use 1 or more').max(9_999_999) })),
  tx(async (req, res) => {
    res.json(await workspace.setNextNumber(req.ctx!.tenantId, req.params.docType as workspace.SeriesType, req.body.nextNo));
  }),
);
router.patch('/tenant/setup', requirePermission('tenant.settings.edit'), validate(workspace.SetupPatch), tx(async (req, res) => {
  res.json(await workspace.updateSetup(req.ctx!.tenantId, req.body));
}));

router.get('/tenant/sample-data', requirePermission('tenant.settings.view'), tx(async (_req, res) => {
  res.json(await workspace.sampleDataStatus());
}));
router.post('/tenant/sample-data', requirePermission('tenant.settings.edit'), tx(async (req, res) => {
  res.json(await workspace.addSampleData(req.ctx!.tenantId, req.ctx!.userId));
}));
router.delete('/tenant/sample-data', requirePermission('tenant.settings.edit'), tx(async (req, res) => {
  res.json(await workspace.removeSampleData(req.ctx!.tenantId));
}));

// Loading screen right after signup: real progress of the tenant.created consumers
router.get('/tenant/provisioning', tx(async (req, res) => {
  const t = await tenancy.getTenant(req.ctx!.tenantId);
  const template = templateByKey(industryTemplateKey(t.industryKey) ?? '');
  const n = template?.catalogSeed.length ?? 0;
  res.json(await workspace.provisioningStatus(req.ctx!.tenantId, {
    template: `Applying the ${template?.name ?? 'business'} setup`,
    catalog: n ? `Adding ${n} starter ${template?.catalogSeed.every((s) => s.type === 'service') ? 'services' : 'items'}` : 'Preparing your catalogue',
  }));
}));
router.post('/tenant/provisioning/retry', tx(async (req, res) => {
  res.json(await workspace.retryProvisioning(req.ctx!.tenantId));
}));

// ── Branches ──
router.get('/branches', requirePermission('tenant.branch.view'), tx(async (_req, res) => {
  res.json({ data: await tenancy.listBranches() });
}));
router.post('/branches', requirePermission('tenant.branch.create'), validate(tenancy.BranchInput), tx(async (req, res) => {
  res.status(201).json(await tenancy.createBranch(req.ctx!.tenantId, req.body));
}));
router.patch('/branches/:id', requirePermission('tenant.branch.edit'), validate(id, 'params'), validate(tenancy.BranchInput.partial()), tx(async (req, res) => {
  res.json(await tenancy.updateBranch(String(req.params.id), req.body));
}));

// ── Members & invitations ──
router.get('/members', requirePermission('tenant.member.view'), tx(async (_req, res) => {
  res.json(await tenancy.listMembers());
}));
router.post('/invitations', requirePermission('tenant.member.create'), validate(tenancy.InviteInput), tx(async (req, res) => {
  res.status(201).json(await tenancy.invite(req.ctx!, req.body));
}));
router.delete('/invitations/:id', requirePermission('tenant.member.create'), validate(id, 'params'), tx(async (req, res) => {
  await tenancy.revokeInvitation(String(req.params.id));
  res.status(204).end();
}));
router.patch('/members/:id', requirePermission('tenant.member.edit'), validate(id, 'params'), validate(tenancy.MemberPatch), tx(async (req, res) => {
  res.json(await tenancy.updateMember(req.ctx!, String(req.params.id), req.body));
}));

// ── Roles & permissions (ROL-01, ROL-02) ──
router.get('/roles', requirePermission('tenant.role.view'), tx(async (req, res) => {
  res.json({ data: await visibleRoles(req.ctx!.tenantId) });
}));
router.get('/roles/:id', requirePermission('tenant.role.view'), validate(id, 'params'), tx(async (req, res) => {
  res.json(await roles.roleDetail(req.ctx!.tenantId, String(req.params.id)));
}));
router.post('/roles', requirePermission('tenant.role.create'), validate(roles.CloneInput), tx(async (req, res) => {
  res.status(201).json(await roles.createRole(req.ctx!, req.body));
}));
router.patch('/roles/:id', requirePermission('tenant.role.edit'), validate(id, 'params'), validate(roles.RolePatch), tx(async (req, res) => {
  res.json(await roles.updateRole(req.ctx!, String(req.params.id), req.body));
}));
router.delete('/roles/:id', requirePermission('tenant.role.delete'), validate(id, 'params'), tx(async (req, res) => {
  await roles.deleteRole(req.ctx!, String(req.params.id));
  res.status(204).end();
}));
router.get('/permissions', requirePermission('tenant.role.view'), async (req, res) => {
  const ent = await getEntitlements(req.ctx!.tenantId);
  // Only modules the tenant has (hidden, not greyed out — Roles doc)
  const data = PERMISSIONS.filter((p) => p.moduleKey === 'tenant' || (p.moduleKey !== 'platform' && ent.modules[p.moduleKey].status !== 'inactive'));
  res.json({ data });
});

// ── Users & security (Phase 2) ──
router.get('/tenant/security', requirePermission('tenant.settings.view'), tx(async (req, res) => {
  res.json(await security.getSecurity(req.ctx!.tenantId, req.ctx!.userId, req.ip));
}));
router.put('/tenant/security', requirePermission('tenant.settings.edit'), validate(security.SecurityInput), tx(async (req, res) => {
  res.json({ policy: await security.updateSecurity(req.ctx!, req.body) });
}));
router.get('/tenant/sessions', requirePermission('tenant.member.view'), tx(async (req, res) => {
  res.json({ data: await security.teamSessions(req.ctx!) });
}));
router.delete('/tenant/sessions/:familyId', requirePermission('tenant.member.edit'), validate(z.object({ familyId: z.string().uuid() }), 'params'), tx(async (req, res) => {
  await security.signOutTeamSession(req.ctx!, String(req.params.familyId));
  res.status(204).end();
}));
router.post('/tenant/sessions/sign-out-others', requirePermission('tenant.member.edit'), tx(async (req, res) => {
  res.json({ signedOut: await security.signOutEveryoneElse(req.ctx!) });
}));
router.get(
  '/tenant/sign-ins',
  requirePermission('tenant.audit.view'),
  validate(z.object({ failed: z.enum(['1', '0']).optional(), days: z.coerce.number().int().min(1).max(90).default(30), format: z.enum(['json', 'csv']).default('json') }), 'query'),
  tx(async (req, res) => {
    const q = req.query as unknown as { failed?: string; days: number; format: 'json' | 'csv' };
    const rows = await security.teamSignIns(req.ctx!.tenantId, { failedOnly: q.failed === '1', days: q.days });
    if (q.format === 'csv') {
      await audit({ action: 'tenant.sign_ins.export', entity: 'tenant', entityId: req.ctx!.tenantId, after: { rows: rows.length } });
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="sign-in-history.csv"');
      res.send(security.signInsCsv(rows));
      return;
    }
    res.json({ data: rows });
  }),
);
router.post(
  '/members/:id/mfa-reset',
  requirePermission('tenant.member.edit'),
  validate(id, 'params'),
  validate(z.object({ reason: zReason })),
  tx(async (req, res) => {
    const m = await db().tenantMember.findUnique({ where: { id: String(req.params.id) } });
    if (!m) throw notFound('User');
    await adminResetMfa(req.ctx!.tenantId, req.ctx!.userId, m.userId, req.body.reason);
    res.json({ reset: true });
  }),
);

// ── Notifications (Phase 2) ──
router.get('/tenant/notifications', requirePermission('tenant.settings.view'), tx(async (req, res) => {
  res.json(await messages.getNotifications(req.ctx!.tenantId));
}));
router.put('/tenant/notifications', requirePermission('tenant.settings.edit'), validate(messages.NotificationsInput), tx(async (req, res) => {
  res.json({ settings: await messages.updateNotifications(req.ctx!.tenantId, req.body) });
}));
router.post(
  '/tenant/notifications/test',
  requirePermission('tenant.settings.edit'),
  validate(z.object({ event: z.enum(['invoice_issued', 'payment_received', 'invoice_overdue', 'appointment_booked', 'appointment_reminder']), subject: z.string().max(150), body: z.string().max(1000) })),
  tx(async (req, res) => {
    const me = await withPlatform(() => db().user.findUniqueOrThrow({ where: { id: req.ctx!.userId }, select: { email: true } }));
    await messages.sendTest(req.ctx!.tenantId, me.email, req.body.event, req.body);
    res.json({ sentTo: me.email });
  }),
);

// ── Data (Phase 2) ──
router.get('/tenant/imports', requirePermission('tenant.settings.view'), tx(async (_req, res) => {
  res.json({ data: await data.importHistory() });
}));
router.get('/tenant/export', requirePermission('tenant.data.export'), validate(data.ExportQuery, 'query'), tx(async (req, res) => {
  const file = await data.buildExport(req.ctx!, req.query as unknown as z.infer<typeof data.ExportQuery>);
  res.setHeader('Content-Type', file.type);
  res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
  res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
  res.send(file.body);
}));
router.post('/tenant/close/start', requirePermission('tenant.account.delete'), tx(async (req, res) => {
  res.json(await data.startClose(req.ctx!));
}));
router.post('/tenant/close', requirePermission('tenant.account.delete'), validate(data.CloseInput), tx(async (req, res) => {
  res.json(await data.closeBusiness(req.ctx!, req.body));
}));
router.post('/tenant/reopen', requirePermission('tenant.account.delete'), tx(async (req, res) => {
  res.json(await data.reopenBusiness(req.ctx!));
}));

// ── Configuration ──
router.get('/config/terms', requirePermission('tenant.config.view'), tx(async (req, res) => {
  res.json({ terms: await getTerms(req.ctx!.tenantId) });
}));
router.put('/config/terms', requirePermission('tenant.config.edit'), validate(z.object({ terms: z.record(z.string().trim().min(1).max(40)) })), tx(async (req, res) => {
  res.json({ terms: await putTerms(req.ctx!.tenantId, req.body.terms) });
}));
router.get('/config/fields', requirePermission('tenant.config.view'), validate(z.object({ entity: z.string().optional() }), 'query'), tx(async (req, res) => {
  res.json({ data: await listFields((req.query as { entity?: string }).entity) });
}));
router.post('/config/fields', requirePermission('tenant.config.edit'), validate(FieldInput), tx(async (req, res) => {
  res.status(201).json(await createField(req.ctx!.tenantId, req.body));
}));
router.patch('/config/fields/:id', requirePermission('tenant.config.edit'), validate(id, 'params'), validate(FieldPatch), tx(async (req, res) => {
  res.json(await updateField(req.ctx!.tenantId, String(req.params.id), req.body));
}));

// ── Audit log ──
router.get(
  '/audit-log',
  requirePermission('tenant.audit.view'),
  validate(z.object({ limit: z.coerce.number().int().min(1).max(100).default(50), cursor: z.string().uuid().optional(), action: z.string().max(60).optional() }), 'query'),
  tx(async (req, res) => {
    res.json(await listAudit(req.query as unknown as { limit: number; cursor?: string; action?: string }));
  }),
);

// ── Subscription (read side; checkout arrives with billing-platform) ──
router.get('/billing/subscription', requirePermission('tenant.billing.view'), tx(async (req, res) => {
  const ent = await getEntitlements(req.ctx!.tenantId);
  const [activeUsers, branches] = await Promise.all([db().tenantMember.count({ where: { status: 'active' } }), db().branch.count()]);
  res.json({ status: ent.status, planKey: ent.planKey, trialEndsAt: ent.trialEndsAt, currentPeriodEnd: ent.currentPeriodEnd, limits: ent.limits, modules: ent.modules, usage: { users: activeUsers, branches } });
}));

// ── In-app notifications (no permission: every member sees their own) ──
router.get('/notifications', tx(async (req, res) => {
  res.json(await listNotifications(req.ctx!.userId));
}));
router.post('/notifications/read', validate(z.object({ id: z.string().uuid().optional() })), tx(async (req, res) => {
  await markRead(req.ctx!.userId, req.body.id);
  res.status(204).end();
}));

export default router;
