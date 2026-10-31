import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { prisma, db, withPlatform } from '../kernel/db';
import type { ConsoleCtx } from '../kernel/context';
import { analytics } from '../modules/console/analytics';
import { dismissEvent, resolveWebhook, retryEvent } from '../modules/console/health';

// Blueprint Phase F: Analytics per role and the System health actions. Writes are rolled back.

class Rollback extends Error {}
async function rolledBack(fn: () => Promise<void>) {
  try {
    await withPlatform(async () => { await fn(); throw new Rollback(); }, { kind: 'platform' }, { timeoutMs: 60_000 });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
}

afterAll(() => prisma.$disconnect());

const ctx = (scope: 'all' | 'own', userId = randomUUID()): ConsoleCtx => ({ kind: 'platform', userId, memberId: randomUUID(), roleId: randomUUID(), sessionId: randomUUID(), scope, partnerId: null });

describe('analytics', () => {
  it('gives one entry per month and hides money without permission', async () => {
    const a = await analytics(ctx('all'), 'team', { income: false }, 6);
    expect(a.series).toHaveLength(6);
    expect(new Set(a.series.map((s) => s.month)).size).toBe(6);
    expect(a.kpis.receivedPaise).toBeNull();
    expect(a.revenueByPlan).toBeNull();
    expect(a.kpis.live).toBeGreaterThanOrEqual(a.kpis.paying + a.kpis.trials);
    if (a.kpis.conversionPercent !== null) expect(a.kpis.conversionPercent).toBeLessThanOrEqual(100);
    expect(a.mine).toBeNull();

    const withMoney = await analytics(ctx('all'), 'team', { income: true }, 3);
    expect(withMoney.series).toHaveLength(3);
    expect(withMoney.kpis.receivedPaise).toBe(withMoney.series.reduce((x, s) => x + (s.receivedPaise ?? 0), 0));
  }, 60_000);

  it('limits a salesperson to their own businesses', async () => {
    const a = await analytics(ctx('own'), 'team', { income: false }, 6);
    expect(a.kpis.live).toBe(0);
    expect(a.mine).toEqual({ trialsEnding: [], linkSignups: 0, discounts: { orders: 0, averagePercent: 0, approved: 0 } });
  }, 60_000);
});

describe('system health actions', () => {
  it('retries and dismisses a failed event, and marks a webhook handled', async () => {
    await rolledBack(async () => {
      const failed = await db().outboxEvent.create({ data: { type: 'trial.reminder_due', payload: {}, actor: { kind: 'system' }, publishedAt: new Date(), attempts: 8, lastError: 'boom' } });
      await retryEvent(failed.id);
      const retried = await db().outboxEvent.findUniqueOrThrow({ where: { id: failed.id } });
      expect(retried.publishedAt).toBeNull();
      expect(retried.attempts).toBe(0);
      await expect(retryEvent(failed.id)).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });

      await dismissEvent(failed.id);
      expect((await db().outboxEvent.findUniqueOrThrow({ where: { id: failed.id } })).lastError).toBeNull();

      const hook = await db().webhookEvent.create({ data: { gateway: 'razorpay', eventId: `test-${randomUUID()}`, type: 'payment_link.paid', payload: {}, processedAt: new Date(), error: 'No order' } });
      const admin = ctx('all');
      await resolveWebhook(admin, hook.id);
      const done = await db().webhookEvent.findUniqueOrThrow({ where: { id: hook.id } });
      expect(done.resolvedAt).not.toBeNull();
      expect(done.resolvedBy).toBe(admin.userId);
    });
  }, 60_000);
});
