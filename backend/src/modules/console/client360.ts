import { prisma } from '../../kernel/db';
import { accountHealth, healthFor } from './insights';

// Client 360 (wireframes 6.3, 6.4): the client's users (names, roles, two-step, last sign-in —
// no contact details), a timeline of AHEAD-side events, the next follow-up and MRR.
// Callers check scope first (assertClientInScope).

const DAY = 86_400_000;
const n = (v: bigint | number | null | undefined) => Number(v ?? 0);

export async function clientUsers(tenantId: string) {
  const members = await prisma.tenantMember.findMany({
    where: { tenantId },
    orderBy: { createdAt: 'asc' },
    select: { id: true, status: true, role: { select: { key: true, name: true } }, user: { select: { id: true, name: true, mfaEnabled: true, lastLoginAt: true } } },
  });
  return members.map((m) => ({ id: m.id, name: m.user.name, role: m.role.name, roleKey: m.role.key, status: m.status, twoStep: m.user.mfaEnabled, lastSignIn: m.user.lastLoginAt }));
}

const ACTION_TEXT: Record<string, string> = {
  'tenant.created': 'Signed up',
  'subscription.transition': 'Subscription changed',
  'console.trial_extended': 'Trial extended',
  'console.grace_extended': 'Payment grace extended',
  'console.acquisition_changed': 'Source changed',
  'tenant.close': 'Business closed by the owner',
  'tenant.reopen': 'Business reopened',
  'config.applied': 'Industry template applied',
  'console.client_created': 'Client created by the AHEAD team',
  'console.client_converted': 'Paid order created',
  'console.partner_client_created': 'Added by the partner',
  'console.partner_plan_changed': 'Plan changed by the partner',
  'console.order_approved': 'Discount approved',
  'console.order_cancelled': 'Order cancelled',
  'console.payment_recorded': 'Payment recorded',
};

/** What a subscription change means for the client, in plain words */
const STATUS_NEWS: Record<string, string> = {
  active: 'Started paying', trialing: 'Free trial started', past_due: 'Payment is overdue', free: 'Moved to the Free plan',
  incomplete: 'Waiting for the first payment', closed: 'Business closed', purged: 'Account deleted',
};
const METHOD_TEXT: Record<string, string> = { bank_transfer: 'bank transfer', upi: 'UPI', cheque: 'cheque', cash: 'cash', razorpay: 'online' };

export async function clientTimeline(tenantId: string, filter?: string) {
  const [tenant, audits, payments, notes, followups, reminders] = await Promise.all([
    prisma.tenant.findUnique({ where: { id: tenantId }, select: { billingOwner: true } }),
    prisma.auditLog.findMany({
      where: { OR: [{ tenantId, action: { in: Object.keys(ACTION_TEXT) } }, { tenantId: null, entityId: tenantId, action: { not: 'console.note.add' } }] }, // notes show as their own rows
      orderBy: { at: 'desc' },
      take: 60,
    }),
    prisma.platformPayment.findMany({ where: { tenantId }, orderBy: { receivedAt: 'desc' }, take: 30, select: { id: true, amountPaise: true, method: true, receivedAt: true } }),
    prisma.consoleNote.findMany({ where: { tenantId, privateToTeam: false }, orderBy: { createdAt: 'desc' }, take: 30 }),
    prisma.consoleFollowup.findMany({ where: { tenantId, doneAt: { not: null } }, orderBy: { doneAt: 'desc' }, take: 30 }),
    prisma.notificationLog.findMany({ where: { tenantId, template: { startsWith: 'trial.' } }, orderBy: { sentAt: 'desc' }, take: 20 }),
  ]);
  const people = await prisma.user.findMany({ where: { id: { in: [...new Set([...audits.map((a) => a.actorId), ...notes.map((x) => x.authorId), ...followups.map((f) => f.ownerUserId)].filter((x): x is string => !!x))] } }, select: { id: true, name: true } });
  const by = new Map(people.map((u) => [u.id, u.name]));
  type Ev = { id: string; at: Date; kind: 'plan' | 'payment' | 'note' | 'followup' | 'reminder' | 'account'; text: string; who: string | null };
  const rows: Ev[] = [
    ...audits.map((a) => {
      const after = (a.after ?? {}) as Record<string, unknown>;
      const base = ACTION_TEXT[a.action] ?? a.action.replace(/^console\./, '').replace(/[._]/g, ' ');
      // A partner's client doesn't pay AHEAD: "active" just means its plan is live
      const news = tenant?.billingOwner === 'partner' && after.status === 'active' ? 'Plan is live' : STATUS_NEWS[String(after.status)];
      const text = a.action === 'subscription.transition' ? news ?? 'Plan changed' : after.reason ? `${base} — ${String(after.reason)}` : base;
      return { id: a.id, at: a.at, kind: (a.action.startsWith('subscription') ? 'plan' : 'account') as Ev['kind'], text, who: a.actorId ? by.get(a.actorId) ?? null : null };
    }),
    ...payments.map((p) => ({ id: p.id, at: p.receivedAt, kind: 'payment' as const, text: `Paid ₹${(n(p.amountPaise) / 100).toLocaleString('en-IN')} by ${METHOD_TEXT[p.method] ?? p.method}`, who: null })),
    ...notes.map((x) => ({ id: x.id, at: x.createdAt, kind: 'note' as const, text: x.body.length > 140 ? `${x.body.slice(0, 140)}…` : x.body, who: by.get(x.authorId) ?? null })),
    ...followups.map((f) => ({ id: f.id, at: f.doneAt!, kind: 'followup' as const, text: `Done: ${f.title}`, who: by.get(f.ownerUserId) ?? null })),
    ...reminders.map((r) => ({ id: r.id, at: r.sentAt, kind: 'reminder' as const, text: `Reminder sent (${r.template.replace('trial.', '').replace(/_/g, ' ')})`, who: null })),
  ];
  return rows.filter((r) => !filter || r.kind === filter).sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, 80);
}

/** Header strip of the Client 360: plan, users, setup, health, MRR, next follow-up. */
export async function clientSummary(tenantId: string) {
  const [health, next, lastPaid, users, h, activeWeek] = await Promise.all([
    healthFor([tenantId]),
    prisma.consoleFollowup.findFirst({ where: { tenantId, doneAt: null }, orderBy: { dueAt: 'asc' } }),
    prisma.platformOrder.findFirst({ where: { tenantId, status: 'paid' }, orderBy: { paidAt: 'desc' }, select: { taxablePaise: true, cycle: true } }),
    prisma.tenantMember.count({ where: { tenantId, status: 'active' } }),
    accountHealth(tenantId),
    prisma.userSession.groupBy({ by: ['userId'], where: { tenantId, createdAt: { gte: new Date(Date.now() - 7 * DAY) } } }),
  ]);
  const owner = next ? await prisma.user.findUnique({ where: { id: next.ownerUserId }, select: { name: true } }) : null;
  return {
    health: health.get(tenantId) ?? { flag: 'good', label: 'Good' },
    mrr: lastPaid ? Math.round(n(lastPaid.taxablePaise) / (lastPaid.cycle === 'yearly' ? 12 : 1)) : null,
    users: { active: users, max: h.limits.users.max, activeThisWeek: activeWeek.length },
    setup: { done: h.setup.filter((s) => s.state === 'done').length, total: h.setup.length, missing: h.setup.filter((s) => !s.state).map((s) => s.label) },
    next: next && { id: next.id, title: next.title, dueAt: next.dueAt, owner: owner?.name ?? null },
  };
}
