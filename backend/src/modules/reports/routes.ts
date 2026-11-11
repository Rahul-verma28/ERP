import { Router } from 'express';
import type { PermissionScope } from '@prisma/client';
import { db } from '../../kernel/db';
import type { TenantCtx } from '../../kernel/context';
import { scopeWhere } from '../../kernel/query';
import { dateOnly, todayIST } from '../../kernel/gst';
import { requirePermission, tenantAuth, tx } from '../../middleware/auth';
import { getRolePermissions } from '../access/service';
import { getEntitlements } from '../subscription/entitlements';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../kernel/db';
import { AppError } from '../../kernel/errors';
import { validate } from '../../middleware/request';
import { DASHBOARD_TABS, DASHBOARD_WIDGETS, dashboardWithDefaults, daysBetween, type DashboardTab } from '../../contracts/dashboard';
import { TAB_HANDLERS, availableTabs, dashboardConfig, scoper } from './dashboard';
import { search } from './search';
import * as sales from './sales';

// Home dashboard (RPT-01): one call, widgets only for modules the role can see,
// every figure filtered by that module's data scope. Totals are computed here, never in the UI.

const router = Router();
router.use(tenantAuth);

const DAY = 86_400_000;

router.get('/dashboard/summary', requirePermission('reports.dashboard.view'), tx(async (req, res) => {
  const ctx = req.ctx!;
  const [perms, ent] = await Promise.all([getRolePermissions(ctx.roleId), getEntitlements(ctx.tenantId)]);
  const scoped = (key: string): TenantCtx | null => {
    const scope = perms.get(key) as PermissionScope | undefined;
    const module = key.split('.')[0] as keyof typeof ent.modules;
    if (!scope || ent.modules[module]?.status === 'inactive') return null;
    return { ...ctx, scope };
  };

  const today = todayIST();
  const monthStart = `${today.slice(0, 8)}01`;
  const weekAgo = new Date(dateOnly(today).getTime() - 6 * DAY);
  const now = new Date();
  const istMidnight = new Date(dateOnly(today).getTime() - 330 * 60_000);
  const out: Record<string, unknown> = { today };

  const inv = scoped('billing.invoice.view');
  if (inv) {
    const scope = scopeWhere(inv, { owner: ['createdBy'], branch: 'branchId' });
    const live = { kind: { in: ['invoice' as const, 'debit_note' as const] }, status: { in: ['issued' as const, 'partially_paid' as const, 'paid' as const] } };
    const [todaySum, monthSum, dues, overdue, recent, week] = await Promise.all([
      db().salesDocument.aggregate({ where: { AND: [scope, live, { issueDate: dateOnly(today) }] }, _sum: { totalPaise: true }, _count: true }),
      db().salesDocument.aggregate({ where: { AND: [scope, live, { issueDate: { gte: dateOnly(monthStart) } }] }, _sum: { totalPaise: true }, _count: true }),
      db().salesDocument.aggregate({ where: { AND: [scope, { kind: { in: ['invoice', 'opening_balance', 'debit_note'] }, status: { in: ['issued', 'partially_paid'] } }] }, _sum: { totalPaise: true, paidPaise: true }, _count: true }),
      db().salesDocument.count({ where: { AND: [scope, { kind: 'invoice', status: { in: ['issued', 'partially_paid'] }, dueDate: { lt: dateOnly(today) } }] } }),
      db().salesDocument.findMany({
        where: { AND: [scope, { kind: 'invoice', status: { not: 'draft' } }] },
        orderBy: { issuedAt: 'desc' },
        take: 5,
        select: { id: true, number: true, buyer: true, totalPaise: true, paidPaise: true, status: true, issueDate: true },
      }),
      db().salesDocument.groupBy({ by: ['issueDate'], where: { AND: [scope, live, { issueDate: { gte: weekAgo } }] }, _sum: { totalPaise: true } }),
    ]);
    // Credit notes take sales back on the day they are issued
    const creditNote = { kind: 'credit_note' as const, status: 'issued' as const };
    const [todayCredit, monthCredit, weekCredit] = await Promise.all([
      db().salesDocument.aggregate({ where: { AND: [scope, creditNote, { issueDate: dateOnly(today) }] }, _sum: { totalPaise: true } }),
      db().salesDocument.aggregate({ where: { AND: [scope, creditNote, { issueDate: { gte: dateOnly(monthStart) } }] }, _sum: { totalPaise: true } }),
      db().salesDocument.groupBy({ by: ['issueDate'], where: { AND: [scope, creditNote, { issueDate: { gte: weekAgo } }] }, _sum: { totalPaise: true } }),
    ]);
    const byDay: Record<string, number> = Object.fromEntries(week.map((w) => [w.issueDate.toISOString().slice(0, 10), Number(w._sum.totalPaise ?? 0)]));
    for (const w of weekCredit) {
      const d = w.issueDate.toISOString().slice(0, 10);
      byDay[d] = (byDay[d] ?? 0) - Number(w._sum.totalPaise ?? 0);
    }
    out.sales = {
      todayPaise: (todaySum._sum.totalPaise ?? 0n) - (todayCredit._sum.totalPaise ?? 0n),
      todayCount: todaySum._count,
      monthPaise: (monthSum._sum.totalPaise ?? 0n) - (monthCredit._sum.totalPaise ?? 0n),
      monthCount: monthSum._count,
      duesPaise: (dues._sum.totalPaise ?? 0n) - (dues._sum.paidPaise ?? 0n),
      duesCount: dues._count,
      overdueCount: overdue,
      last7Days: Array.from({ length: 7 }, (_, i) => {
        const d = new Date(weekAgo.getTime() + i * DAY).toISOString().slice(0, 10);
        return { date: d, totalPaise: byDay[d] ?? 0 };
      }),
      recent,
    };
  }

  const pay = scoped('billing.payment.view');
  if (pay) {
    const scope = scopeWhere(pay, { owner: ['createdBy'] });
    const [t, m] = await Promise.all([
      db().payment.aggregate({ where: { AND: [scope, { paidOn: dateOnly(today) }] }, _sum: { amountPaise: true } }),
      db().payment.aggregate({ where: { AND: [scope, { paidOn: { gte: dateOnly(monthStart) } }] }, _sum: { amountPaise: true } }),
    ]);
    out.collections = { todayPaise: t._sum.amountPaise ?? 0n, monthPaise: m._sum.amountPaise ?? 0n };
  }

  const exp = scoped('finance.expense.view');
  if (exp) {
    const scope = scopeWhere(exp, { owner: ['createdBy'], branch: 'branchId' });
    const [t, m] = await Promise.all([
      db().expense.aggregate({ where: { AND: [scope, { paidOn: dateOnly(today) }] }, _sum: { amountPaise: true } }),
      db().expense.aggregate({ where: { AND: [scope, { paidOn: { gte: dateOnly(monthStart) } }] }, _sum: { amountPaise: true } }),
    ]);
    out.expenses = { todayPaise: t._sum.amountPaise ?? 0n, monthPaise: m._sum.amountPaise ?? 0n };
  }

  const task = scoped('tasks.task.view');
  if (task) {
    const mine = { assigneeId: ctx.userId, status: { in: ['todo' as const, 'in_progress' as const] } };
    const [open, overdue, next] = await Promise.all([
      db().task.count({ where: mine }),
      db().task.count({ where: { ...mine, dueAt: { lt: now } } }),
      db().task.findMany({ where: mine, orderBy: [{ dueAt: { sort: 'asc', nulls: 'last' } }], take: 5, select: { id: true, title: true, dueAt: true, priority: true, status: true } }),
    ]);
    out.tasks = { open, overdue, next };
  }

  const appt = scoped('bookings.appointment.view');
  if (appt) {
    const rows = await db().appointment.findMany({
      where: { AND: [scopeWhere(appt, { owner: ['createdBy', 'staffId'], branch: 'branchId' }), { startAt: { gte: istMidnight, lt: new Date(istMidnight.getTime() + DAY) }, status: { notIn: ['cancelled'] } }] },
      orderBy: { startAt: 'asc' },
      take: 20,
      select: { id: true, title: true, startAt: true, endAt: true, status: true, kind: true },
    });
    out.bookings = { today: rows };
  }

  const fu = scoped('crm.activity.view');
  if (fu) {
    out.followUps = {
      due: await db().activity.count({ where: { AND: [scopeWhere(fu, { owner: ['assigneeId', 'createdBy'] }), { type: 'follow_up', completedAt: null, dueAt: { lt: new Date(istMidnight.getTime() + DAY) } }] } }),
    };
  }

  const cust = scoped('crm.contact.view');
  if (cust) {
    const [customers, leads] = await Promise.all([
      db().contact.count({ where: { type: 'customer', isActive: true } }),
      db().contact.count({ where: { type: 'lead', leadStatus: { notIn: ['converted', 'lost'] } } }),
    ]);
    out.crm = { customers, openLeads: leads };
  }

  res.json(out);
}));

// ── Dashboard v2 (Phase 3) ──

const TAB_KEYS = DASHBOARD_TABS.map((t) => t.key) as [DashboardTab, ...DashboardTab[]];
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

async function readDashboardPrefs(userId: string, tenantId: string) {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { preferences: true } });
  const all = ((u?.preferences ?? {}) as { dashboard?: Record<string, unknown> }).dashboard ?? {};
  return dashboardWithDefaults(all[tenantId]);
}

// Tabs are checked one by one (a stylist with no dashboard permission still gets My day)
// ── Sales reports and the GST working sheet ──
router.get('/reports/sales', requirePermission('reports.report.view'), validate(sales.ReportPeriod.extend({ by: z.enum(['day', 'month', 'customer', 'item']) }), 'query'), tx(async (req, res) => {
  const { by, from, to } = req.query as unknown as z.infer<typeof sales.ReportPeriod> & { by: 'day' | 'month' | 'customer' | 'item' };
  res.json(by === 'item' ? await sales.itemReport(req.ctx!, { from, to }) : await sales.salesReport(req.ctx!, by, { from, to }));
}));
router.get('/reports/receivables', requirePermission('reports.report.view'), tx(async (req, res) => {
  res.json(await sales.receivables(req.ctx!, dateOnly(todayIST())));
}));
router.get('/reports/sales-register', requirePermission('reports.report.view'), validate(sales.ReportPeriod, 'query'), tx(async (req, res) => {
  res.json(await sales.salesRegister(req.ctx!, req.query as unknown as z.infer<typeof sales.ReportPeriod>));
}));
router.get('/reports/pending-orders', requirePermission('reports.report.view'), tx(async (req, res) => {
  res.json(await sales.pendingOrders(req.ctx!));
}));
router.get('/reports/collection', requirePermission('reports.report.view'), validate(sales.ReportPeriod, 'query'), tx(async (req, res) => {
  res.json(await sales.collectionReport(req.ctx!, req.query as unknown as z.infer<typeof sales.ReportPeriod>));
}));
router.get('/reports/gst', requirePermission('reports.report.view'), validate(sales.ReportPeriod, 'query'), tx(async (req, res) => {
  res.json(await sales.gstReport(req.ctx!, req.query as unknown as z.infer<typeof sales.ReportPeriod>));
}));
router.get('/reports/gst/download', requirePermission('reports.report.export'), validate(sales.ReportPeriod, 'query'), tx(async (req, res) => {
  const file = await sales.gstWorkbook(req.ctx!, req.query as unknown as z.infer<typeof sales.ReportPeriod>);
  res.setHeader('Content-Type', file.type);
  res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
  res.send(file.body);
}));

router.get('/dashboard/config', tx(async (req, res) => {
  const ctx = req.ctx!;
  const { scoped, readOnly } = await scoper(ctx);
  const role = await db().role.findUniqueOrThrow({ where: { id: ctx.roleId }, select: { key: true, roleType: true } });
  const [config, prefs] = await Promise.all([dashboardConfig(ctx, scoped, readOnly, role), readDashboardPrefs(ctx.userId, ctx.tenantId)]);
  res.json({ ...config, prefs, widgets: DASHBOARD_WIDGETS, today: todayIST() });
}));

router.get(
  '/dashboard/tab/:tab',
  validate(z.object({ tab: z.enum(TAB_KEYS) }), 'params'),
  validate(z.object({ from: Day, to: Day, compare: z.enum(['0', '1']).default('1'), branchId: z.string().uuid().optional() }), 'query'),
  // No request transaction: each widget opens its own so they run side by side
  async (req, res) => {
    const ctx = req.ctx!;
    const tab = req.params.tab as DashboardTab;
    const q = req.query as unknown as { from: string; to: string; compare: '0' | '1'; branchId?: string };
    if (q.from > q.to) throw new AppError('VALIDATION_FAILED', 'The start date is after the end date.', { fields: { from: 'Start is after the end' } });
    if (daysBetween(q.from, q.to) > 731) throw new AppError('VALIDATION_FAILED', 'Choose up to 2 years.', { fields: { from: 'Choose up to 2 years' } });
    if (q.branchId && ctx.branchIds.length && !ctx.branchIds.includes(q.branchId)) throw new AppError('PERMISSION_DENIED', "You don't work in this branch.");
    const { scoped, readOnly } = await scoper(ctx);
    if (!availableTabs(scoped, readOnly).some((t) => t.key === tab)) throw new AppError('PERMISSION_DENIED', 'This dashboard tab is not available to your role.');
    const data = await TAB_HANDLERS[tab](ctx, scoped, { range: { from: q.from, to: q.to }, compare: q.compare === '1', branchId: q.branchId ?? null });
    res.json({ tab, range: { from: q.from, to: q.to }, data });
  },
);

const Layout = z.object({ order: z.array(z.string().max(30)).max(20), hidden: z.array(z.string().max(30)).max(20) });
const PrefsPatch = z.object({
  lastTab: z.enum(TAB_KEYS).nullable().optional(),
  range: z.enum(['today', 'week', 'month', 'custom']).optional(),
  from: Day.nullable().optional(),
  to: Day.nullable().optional(),
  compare: z.boolean().optional(),
  branchId: z.string().uuid().nullable().optional(),
  layouts: z.record(z.enum(TAB_KEYS), Layout).optional(),
  hiddenTabs: z.array(z.enum(TAB_KEYS).refine((t) => t !== 'overview', "The Overview tab can't be hidden")).max(8).optional(),
});

// Saved per person and per business, in the person's preferences
router.put('/dashboard/preferences', validate(PrefsPatch), async (req, res) => {
  const ctx = req.ctx!;
  const u = await prisma.user.findUniqueOrThrow({ where: { id: ctx.userId }, select: { preferences: true } });
  const prefs = (u.preferences ?? {}) as Record<string, unknown> & { dashboard?: Record<string, unknown> };
  const mine = { ...dashboardWithDefaults(prefs.dashboard?.[ctx.tenantId]), ...req.body };
  await prisma.user.update({ where: { id: ctx.userId }, data: { preferences: { ...prefs, dashboard: { ...(prefs.dashboard ?? {}), [ctx.tenantId]: mine } } as Prisma.InputJsonValue } });
  res.json({ prefs: mine });
});

// ── Ctrl+K search ──
router.get('/search', validate(z.object({ q: z.string().trim().min(2, 'Type at least 2 characters').max(60) }), 'query'), tx(async (req, res) => {
  res.json(await search(req.ctx!, String((req.query as { q: string }).q)));
}));

export default router;
