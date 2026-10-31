import { db, prisma, withPlatform } from '../../kernel/db';
import { AppError, notFound } from '../../kernel/errors';
import type { ConsoleCtx } from '../../kernel/context';
import { audit } from '../audit/service';
import { JOBS, JOB_KEYS, runTracked, type JobKey } from '../system/jobs';

// System health (blueprint Phase F): scheduled jobs, background events that failed, payment
// webhooks that need a person, and which businesses have errors. Admin and Staff see it; an
// Admin can run a job, retry or dismiss an event, and mark a webhook handled. Reads use the
// owner client; the actions below run in the Console transaction.

const DAY = 86_400_000;
const HOUR = 3_600_000;

const EVENT_TEXT: Record<string, string> = {
  'tenant.created': 'Set up a new business',
  'config.applied': 'Apply industry set-up',
  'member.invited': 'Send a team invite',
  'member.activated': 'Activate a team member',
  'member.deactivated': 'Deactivate a team member',
  'role.updated': 'Update a role',
  'subscription.changed': 'Update plan and modules',
  'trial.reminder_due': 'Send a trial reminder',
  'invoice.issued': 'After an invoice is issued',
  'payment.received': 'After a payment is received',
};

export async function healthOverview(now = new Date()) {
  const week = new Date(now.getTime() - 7 * DAY);
  const [runs, waiting, retrying, failed, oldestWaiting, webhooks, errorsByBusiness] = await Promise.all([
    prisma.jobRun.findMany(),
    prisma.outboxEvent.count({ where: { publishedAt: null, lastError: null } }),
    prisma.outboxEvent.count({ where: { publishedAt: null, lastError: { not: null } } }),
    prisma.outboxEvent.findMany({ where: { publishedAt: { not: null }, lastError: { not: null } }, orderBy: { occurredAt: 'desc' }, take: 50 }),
    prisma.outboxEvent.findFirst({ where: { publishedAt: null }, orderBy: { occurredAt: 'asc' }, select: { occurredAt: true } }),
    prisma.webhookEvent.findMany({ where: { error: { not: null }, resolvedAt: null }, orderBy: { receivedAt: 'desc' }, take: 50 }),
    prisma.outboxEvent.groupBy({ by: ['tenantId'], where: { tenantId: { not: null }, lastError: { not: null }, occurredAt: { gte: week } }, _count: true }),
  ]);
  const tenantIds = [...new Set([...failed.map((e) => e.tenantId), ...errorsByBusiness.map((e) => e.tenantId)].filter((x): x is string => !!x))];
  const names = new Map((await prisma.tenant.findMany({ where: { id: { in: tenantIds } }, select: { id: true, name: true } })).map((t) => [t.id, t.name]));

  const jobs = JOB_KEYS.map((key) => {
    const r = runs.find((x) => x.name === key);
    const unfinished = !!r?.lastStartedAt && (!r.lastFinishedAt || r.lastFinishedAt < r.lastStartedAt);
    // Started but never finished for 30 minutes: the server stopped during the run
    const running = unfinished && now.getTime() - r!.lastStartedAt!.getTime() < 30 * 60_000;
    const stopped = unfinished && !running;
    // Hourly jobs: more than 2 hours without a good run means the worker is not running them
    const late = !r?.lastOkAt || now.getTime() - r.lastOkAt.getTime() > 2 * HOUR;
    const status = running ? 'running' : stopped || r?.lastError ? 'failed' : late ? 'late' : 'ok';
    const lastError = stopped ? 'Stopped before finishing (the server restarted during the run)' : r?.lastError ?? null;
    return { key, label: JOBS[key].label, text: JOBS[key].text, status, lastRunAt: r?.lastFinishedAt ?? r?.lastStartedAt ?? null, lastOkAt: r?.lastOkAt ?? null, lastError, runs: r?.runs ?? 0, failures: r?.failures ?? 0 };
  });
  const stuck = !!oldestWaiting && now.getTime() - oldestWaiting.occurredAt.getTime() > 10 * 60_000;

  return {
    summary: {
      jobsFailing: jobs.filter((j) => j.status === 'failed').length,
      jobsLate: jobs.filter((j) => j.status === 'late').length,
      eventsWaiting: waiting,
      eventsRetrying: retrying,
      eventsFailed: failed.length,
      queueStuck: stuck,
      webhooks: webhooks.length,
      businessesWithErrors: errorsByBusiness.length,
    },
    jobs,
    failedEvents: failed.map((e) => ({
      id: e.id, what: EVENT_TEXT[e.type] ?? e.type, type: e.type, tenantId: e.tenantId, business: e.tenantId ? names.get(e.tenantId) ?? null : null,
      attempts: e.attempts, error: e.lastError, at: e.occurredAt,
    })),
    webhooks: webhooks.map((w) => ({ id: w.id, gateway: w.gateway, type: w.type, eventId: w.eventId, error: w.error, at: w.receivedAt })),
    businesses: errorsByBusiness
      .map((e) => ({ tenantId: e.tenantId!, business: names.get(e.tenantId!) ?? '—', errors: e._count }))
      .sort((a, b) => b.errors - a.errors),
  };
}

/** Runs outside a transaction: each job manages its own. */
export async function runJobNow(ctx: ConsoleCtx, key: string) {
  if (!(key in JOBS)) throw notFound('Job');
  const error = await runTracked(key as JobKey);
  await withPlatform(() => audit({ tenantId: null, actorId: ctx.userId, action: 'console.job_run', entity: 'job', entityId: key, after: { ok: !error, error } })).catch(() => undefined);
  return { ok: !error, error };
}

/** Send a failed event through again; the relay picks it up within a second. */
export async function retryEvent(id: string) {
  const e = await db().outboxEvent.findUnique({ where: { id } });
  if (!e) throw notFound('Event');
  if (!e.lastError || !e.publishedAt) throw new AppError('INVALID_TRANSITION', 'This event has not failed.');
  await db().outboxEvent.update({ where: { id }, data: { publishedAt: null, attempts: 0 } });
  await audit({ tenantId: null, action: 'console.event_retried', entity: 'outbox_event', entityId: id, after: { type: e.type } });
}

export async function retryAllEvents() {
  const r = await db().outboxEvent.updateMany({ where: { publishedAt: { not: null }, lastError: { not: null } }, data: { publishedAt: null, attempts: 0 } });
  await audit({ tenantId: null, action: 'console.event_retried', entity: 'outbox_event', entityId: 'all', after: { count: r.count } });
  return r.count;
}

/** Leave a failed event as it is and stop showing it (e.g. it no longer matters). */
export async function dismissEvent(id: string) {
  const e = await db().outboxEvent.findUnique({ where: { id } });
  if (!e) throw notFound('Event');
  await db().outboxEvent.update({ where: { id }, data: { lastError: null } });
  await audit({ tenantId: null, action: 'console.event_dismissed', entity: 'outbox_event', entityId: id, before: { error: e.lastError }, after: { type: e.type } });
}

export async function resolveWebhook(ctx: ConsoleCtx, id: string) {
  const w = await db().webhookEvent.findUnique({ where: { id } });
  if (!w) throw notFound('Webhook');
  await db().webhookEvent.update({ where: { id }, data: { resolvedAt: new Date(), resolvedBy: ctx.userId } });
  await audit({ tenantId: null, action: 'console.webhook_resolved', entity: 'webhook_event', entityId: id, before: { error: w.error } });
}
