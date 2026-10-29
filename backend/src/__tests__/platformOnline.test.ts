import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma, db, withPlatform } from '../kernel/db';
import { cache } from '../kernel/cache';
import type { ConsoleCtx } from '../kernel/context';
import { capturePayment, createClient } from '../modules/platformBilling/service';
import { handleWebhook, issueCreditNote, sendPaymentLink } from '../modules/platformBilling/online';
import { parseRazorpay, testWebhook, verifySignature } from '../modules/platformBilling/gateway';
import { runDunning, runLapseUnpaid, runRenewals, runTrialReminders } from '../modules/platformBilling/jobs';

// Platform design v2, Step 4b: payment links, webhook, renewals, dunning, reminders, credit notes.
// Every database test runs in a rolled-back transaction; AHEAD's billing details are primed into
// the settings cache. Without Razorpay keys the development test gateway is used.

class Rollback extends Error {}
async function rolledBack(fn: () => Promise<void>) {
  try {
    await withPlatform(async () => { await fn(); throw new Rollback(); }, { kind: 'platform' }, { timeoutMs: 240_000 });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
}

const DAY = 86_400_000;
const SELLER = { legalName: 'AHEAD Test', gstin: '', stateCode: '09', address: '', sac: '998314', gstRateBp: 1800 };
beforeEach(() => {
  cache.del('settings:platform');
  return cache.getOrSet('settings:platform', async () => new Map([['ahead.billing', { value: SELLER, version: 1 }]]), 60_000);
});
afterAll(async () => {
  cache.del('settings:platform');
  await prisma.$disconnect();
});

async function superAdmin(): Promise<ConsoleCtx> {
  const n = String(Math.floor(Math.random() * 1e9)).padStart(9, '0');
  const user = await db().user.create({ data: { name: 'Online Boss', email: `online-${n}@example.test`, mobile: `+915${n}` } });
  const role = await db().role.findFirstOrThrow({ where: { tenantId: null, layer: 'platform', key: 'super_admin' } });
  const member = await db().platformMember.create({ data: { userId: user.id, roleId: role.id } });
  return { kind: 'platform', userId: user.id, memberId: member.id, roleId: role.id, sessionId: randomUUID(), scope: 'all' };
}

async function paidClientOrder(boss: ConsoleCtx) {
  const n = String(Math.floor(Math.random() * 1e9)).padStart(9, '0');
  return createClient(boss, {
    business: { name: `Online Client ${n}`, industryKey: 'retail', stateCode: '09' },
    owner: { name: 'Online Owner', email: `oowner-${n}@example.test`, mobile: `+914${n}` },
    start: 'paid',
    order: { planKey: 'starter', cycle: 'monthly', addOns: [], extraUsers: 0, discountPercent: 0 },
  });
}

describe('webhook signatures', () => {
  it('accepts only the exact signed body', () => {
    const hook = testWebhook('plink_test_abc', 1000);
    expect(verifySignature('ahead-dev-test-gateway', hook.body, hook.signature)).toBe(true);
    expect(verifySignature('ahead-dev-test-gateway', hook.body.replace('1000', '9999'), hook.signature)).toBe(false);
    expect(verifySignature('ahead-dev-test-gateway', hook.body, undefined)).toBe(false);
  });

  it('reads a Razorpay payment_link.paid event', () => {
    const evt = parseRazorpay({ event: 'payment_link.paid', payload: { payment_link: { entity: { id: 'plink_1' } }, payment: { entity: { id: 'pay_1', amount: 117882, method: 'upi' } } } }, 'evt_1');
    expect(evt).toEqual({ eventId: 'evt_1', type: 'payment_link.paid', linkId: 'plink_1', paymentId: 'pay_1', amountPaise: 117882, method: 'upi' });
  });
});

describe('payment link → webhook', () => {
  it('a paid link activates the client once; replays and forgeries change nothing', async () => {
    await rolledBack(async () => {
      const boss = await superAdmin();
      const out = await paidClientOrder(boss);
      const link = await sendPaymentLink(out.orderId);
      expect(link.url).toMatch(/\/pay\/test\/plink_test_/);
      const order = await db().platformOrder.findUniqueOrThrow({ where: { id: out.orderId } });

      const hook = testWebhook(order.paymentLinkId!, out.totalPaise);
      await expect(handleWebhook('test', hook.body, 'forged', hook.eventId)).rejects.toMatchObject({ code: 'WEBHOOK_SIGNATURE_INVALID' });
      expect(await handleWebhook('test', hook.body, hook.signature, hook.eventId)).toEqual({ status: 'processed', detail: undefined });
      expect(await handleWebhook('test', hook.body, hook.signature, hook.eventId)).toEqual({ status: 'duplicate' });

      expect(await db().platformPayment.count({ where: { orderId: out.orderId } })).toBe(1);
      expect((await db().subscription.findUniqueOrThrow({ where: { tenantId: out.tenantId } })).status).toBe('active');
      expect(await db().platformInvoice.count({ where: { orderId: out.orderId } })).toBe(1);
    });
  });

  it('a wrong amount is kept for a person to check and does not activate', async () => {
    await rolledBack(async () => {
      const boss = await superAdmin();
      const out = await paidClientOrder(boss);
      await sendPaymentLink(out.orderId);
      const order = await db().platformOrder.findUniqueOrThrow({ where: { id: out.orderId } });
      const hook = testWebhook(order.paymentLinkId!, out.totalPaise - 1);
      const res = await handleWebhook('test', hook.body, hook.signature, hook.eventId);
      expect(res.status).toBe('needs_attention');
      expect((await db().platformOrder.findUniqueOrThrow({ where: { id: out.orderId } })).status).toBe('awaiting_payment');
      expect((await db().webhookEvent.findUniqueOrThrow({ where: { eventId: hook.eventId } })).error).toMatch(/order total/);
    });
  });
});

describe('jobs', () => {
  it('an unpaid order lapses and the never-paid client is closed', async () => {
    await rolledBack(async () => {
      const boss = await superAdmin();
      const out = await paidClientOrder(boss);
      const now = new Date();
      await db().platformOrder.update({ where: { id: out.orderId }, data: { expiresAt: new Date(now.getTime() - 1000) } });
      await runLapseUnpaid(now);
      expect((await db().platformOrder.findUniqueOrThrow({ where: { id: out.orderId } })).status).toBe('cancelled');
      expect((await db().subscription.findUniqueOrThrow({ where: { tenantId: out.tenantId } })).status).toBe('closed');
    });
  });

  it('renewal: one order with a link before the period ends, reminders once, payment extends from the old end', async () => {
    await rolledBack(async () => {
      const boss = await superAdmin();
      const out = await paidClientOrder(boss);
      await capturePayment(out.orderId, { method: 'upi', amountPaise: out.totalPaise, reference: 'UPI1', receivedAt: new Date(), recordedBy: boss.userId });
      const sub = await db().subscription.findUniqueOrThrow({ where: { tenantId: out.tenantId } });
      const end = sub.currentPeriodEnd!;
      const now = new Date(end.getTime() - 3 * DAY + 3600_000);

      await runRenewals(now);
      await runRenewals(now);
      const renewals = await db().platformOrder.findMany({ where: { tenantId: out.tenantId, kind: 'renewal' } });
      expect(renewals).toHaveLength(1);
      expect(renewals[0].paymentLinkUrl).toMatch(/\/pay\/test\//);
      expect(await db().notificationLog.count({ where: { dedupKey: `renewal:${renewals[0].id}:3` } })).toBe(1);

      await capturePayment(renewals[0].id, { method: 'bank_transfer', amountPaise: Number(renewals[0].totalPaise), reference: 'UTR2', receivedAt: now, recordedBy: boss.userId });
      const after = await db().subscription.findUniqueOrThrow({ where: { tenantId: out.tenantId } });
      expect(after.status).toBe('active');
      expect(after.currentPeriodStart!.getTime()).toBe(end.getTime());
      expect(after.currentPeriodEnd!.getTime()).toBeGreaterThan(end.getTime() + 27 * DAY);
    });
  });

  it('dunning: an unpaid period end gives grace, grace end moves to Free', async () => {
    await rolledBack(async () => {
      const boss = await superAdmin();
      const out = await paidClientOrder(boss);
      await capturePayment(out.orderId, { method: 'cash', amountPaise: out.totalPaise, reference: 'RCPT1', receivedAt: new Date(), recordedBy: boss.userId });
      const end = (await db().subscription.findUniqueOrThrow({ where: { tenantId: out.tenantId } })).currentPeriodEnd!;

      await runDunning(new Date(end.getTime() + 3600_000));
      const pastDue = await db().subscription.findUniqueOrThrow({ where: { tenantId: out.tenantId } });
      expect(pastDue.status).toBe('past_due');
      expect(pastDue.graceEndsAt).not.toBeNull();

      await runDunning(new Date(pastDue.graceEndsAt!.getTime() + 3600_000));
      expect((await db().subscription.findUniqueOrThrow({ where: { tenantId: out.tenantId } })).status).toBe('free');
    });
  });

  it('trial reminders go out once at 3 days left', async () => {
    await rolledBack(async () => {
      const sub = await db().subscription.findFirst({ where: { status: 'trialing', trialEndsAt: { not: null } } });
      if (!sub) return;
      const now = new Date(sub.trialEndsAt!.getTime() - 3 * DAY + 3600_000);
      await runTrialReminders(now);
      await runTrialReminders(now);
      expect(await db().notificationLog.count({ where: { dedupKey: `trial:${sub.tenantId}:3` } })).toBe(1);
    });
  });
});

describe('credit notes', () => {
  it('a full refund gets its own number, once, and can end the paid period', async () => {
    await rolledBack(async () => {
      const boss = await superAdmin();
      const out = await paidClientOrder(boss);
      const { invoice } = await capturePayment(out.orderId, { method: 'upi', amountPaise: out.totalPaise, reference: 'UPI9', receivedAt: new Date(), recordedBy: boss.userId });
      const note = await issueCreditNote(boss, invoice.id, { reason: 'Client changed their mind', endSubscription: true });
      expect(note.number).toMatch(/^CN\/\d{2}-\d{2}\/\d{6}$/);
      expect(note.totalPaise).toBe(invoice.totalPaise);
      await expect(issueCreditNote(boss, invoice.id, { reason: 'Again', endSubscription: false })).rejects.toMatchObject({ code: 'CONFLICT' });
      expect((await db().subscription.findUniqueOrThrow({ where: { tenantId: out.tenantId } })).status).toBe('free');
    });
  });
});
