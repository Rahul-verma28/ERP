import { db, withPlatform } from '../../kernel/db';
import { cache } from '../../kernel/cache';
import { sendMessage } from '../notifications/service';
import { getSetting } from '../settings/service';
import { transition } from '../subscription/stateMachine';
import { quote, saveOrder } from './service';
import { sendPaymentLink } from './online';

// design v2 Step 4b — hourly billing jobs. Each job scans in one platform transaction and
// handles every item in its own (so one bad tenant never blocks the rest). Called with a
// fixed `now` in tests, where the nested withPlatform calls share the test's transaction.

const DAY = 86_400_000;
/** Orders, events and logs written by the system rather than a person */
export const SYSTEM_USER = '00000000-0000-0000-0000-000000000000';
const RENEW_AHEAD_DAYS = 7;
const REMIND_AT = [7, 3, 1];

const rupees = (paise: bigint | number) => `₹${(Number(paise) / 100).toFixed(2)}`;
const daysLeft = (end: Date, now: Date) => Math.ceil((end.getTime() - now.getTime()) / DAY);

async function each<T>(label: string, items: T[], fn: (item: T) => Promise<void>) {
  let done = 0;
  for (const item of items) {
    try {
      await withPlatform(() => fn(item));
      done++;
    } catch (e) {
      console.error(`[billing:${label}]`, e instanceof Error ? e.message.split('\n').pop() : e);
    }
  }
  return done;
}

/** Send a message once per dedup key (notification_log). Returns false if it was already sent. */
async function once(dedupKey: string, tenantId: string, msg: { to: string; channel: 'email' | 'sms'; template: string; subject?: string; text: string }) {
  const tx = db();
  if (await tx.notificationLog.findUnique({ where: { dedupKey } })) return false;
  await tx.notificationLog.create({ data: { tenantId, template: msg.template, channel: msg.channel, dedupKey, target: msg.to } });
  await sendMessage(msg);
  return true;
}

async function owner(tenantId: string) {
  const t = await db().tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { name: true, ownerUserId: true, gstin: true, billingStateCode: true } });
  const u = await db().user.findUniqueOrThrow({ where: { id: t.ownerUserId }, select: { name: true, email: true, mobile: true } });
  return { tenant: t, user: u };
}

/** Unpaid orders past their date are cancelled; a sales-created client that never paid is closed. */
export async function runLapseUnpaid(now = new Date()) {
  const due = await withPlatform(() => db().platformOrder.findMany({ where: { status: { in: ['awaiting_payment', 'pending_approval'] }, expiresAt: { lte: now } }, select: { id: true, tenantId: true } }));
  return each('lapse', due, async (o) => {
    const tx = db();
    await tx.platformOrder.update({ where: { id: o.id }, data: { status: 'cancelled', cancelledReason: 'Lapsed: not paid in time' } });
    const sub = await tx.subscription.findUnique({ where: { tenantId: o.tenantId } });
    const open = await tx.platformOrder.count({ where: { tenantId: o.tenantId, status: { in: ['awaiting_payment', 'pending_approval', 'paid'] } } });
    if (sub?.status === 'incomplete' && open === 0) await transition(o.tenantId, 'unpaid_cancelled', { now });
  });
}

/** Seven days before the period ends: a renewal order at today's prices, a payment link, and reminders at 7/3/1 days. */
export async function runRenewals(now = new Date()) {
  const subs = await withPlatform(() =>
    db().subscription.findMany({
      // Partner clients are on the partner's monthly bill, never on AHEAD renewals
      where: { status: 'active', cycle: { in: ['monthly', 'yearly'] }, currentPeriodEnd: { gt: now, lte: new Date(now.getTime() + RENEW_AHEAD_DAYS * DAY) }, tenant: { billingOwner: 'self' } },
      include: { items: true },
    }),
  );
  return each('renewal', subs, async (sub) => {
    const tx = db();
    const end = sub.currentPeriodEnd!;
    let order = await tx.platformOrder.findFirst({ where: { tenantId: sub.tenantId, kind: 'renewal', createdAt: { gte: new Date(end.getTime() - 35 * DAY) }, status: { in: ['awaiting_payment', 'paid'] } }, orderBy: { createdAt: 'desc' } });
    if (order?.status === 'paid') return;
    const { tenant, user } = await owner(sub.tenantId);

    if (!order) {
      const plan = await tx.plan.findUniqueOrThrow({ where: { id: sub.planId } });
      const prices = await tx.price.findMany({ where: { id: { in: sub.items.map((i) => i.priceId) } } });
      const kind = (id: string) => prices.find((p) => p.id === id);
      const seller = await getSetting('ahead.billing');
      const billTo = { name: tenant.name, gstin: tenant.gstin, stateCode: tenant.billingStateCode ?? seller.stateCode, address: null };
      const q = await quote({
        planKey: plan.key,
        cycle: sub.cycle as 'monthly' | 'yearly',
        addOns: sub.items.filter((i) => kind(i.priceId)?.itemType === 'addon_module').map((i) => kind(i.priceId)!.itemRef),
        extraUsers: sub.items.filter((i) => kind(i.priceId)?.itemType === 'extra_user').reduce((n, i) => n + i.quantity, 0),
        discountPercent: 0,
        billTo,
      });
      const graceDays = await getSetting(sub.cycle === 'yearly' ? 'grace.days_yearly' : 'grace.days_monthly');
      order = await saveOrder({ ...q, needsApproval: false }, { tenantId: sub.tenantId, kind: 'renewal', billTo, createdBy: SYSTEM_USER, expiresAt: new Date(end.getTime() + graceDays * DAY) });
      try {
        await sendPaymentLink(order.id);
        order = await tx.platformOrder.findUniqueOrThrow({ where: { id: order.id } });
      } catch (e) {
        console.error('[billing:renewal] no payment link:', e instanceof Error ? e.message : e);
      }
    }

    const left = daysLeft(end, now);
    const step = REMIND_AT.find((d) => left <= d && left > (REMIND_AT[REMIND_AT.indexOf(d) + 1] ?? 0));
    if (step) {
      await once(`renewal:${order.id}:${step}`, sub.tenantId, {
        channel: 'email', to: user.email, template: 'billing.renewal_reminder',
        subject: `Your AHEAD plan renews in ${left} day${left === 1 ? '' : 's'}`,
        text: `Hi ${user.name}, ${tenant.name}'s AHEAD plan ends on ${end.toDateString()}. Pay ${rupees(order.totalPaise)} to continue${order.paymentLinkUrl ? `: ${order.paymentLinkUrl}` : ' — your AHEAD contact will share the payment details'}.`,
      });
    }
  });
}

/** Period over without payment → past_due with grace; grace over → Free plan (paid modules read-only). */
export async function runDunning(now = new Date()) {
  const lapsed = await withPlatform(() => db().subscription.findMany({ where: { status: 'active', currentPeriodEnd: { lte: now }, tenant: { billingOwner: 'self' } }, select: { tenantId: true } }));
  const failed = await each('renewal-failed', lapsed, async (s) => {
    await transition(s.tenantId, 'renewal_failed', { now });
    const { tenant, user } = await owner(s.tenantId);
    await once(`dunning:${s.tenantId}:${now.toISOString().slice(0, 10)}`, s.tenantId, {
      channel: 'email', to: user.email, template: 'billing.payment_failed',
      subject: 'Your AHEAD payment is due',
      text: `Hi ${user.name}, ${tenant.name}'s AHEAD plan has ended and the renewal is unpaid. Everything keeps working during the grace period — please pay to avoid moving to the Free plan.`,
    });
  });
  const expired = await withPlatform(() => db().subscription.findMany({ where: { status: 'past_due', graceEndsAt: { lte: now } }, select: { tenantId: true } }));
  const freed = await each('grace-expired', expired, (s) => transition(s.tenantId, 'grace_expired', { now }).then(() => undefined));
  return { failed, freed };
}

/** Trial reminders at 7, 3 and 1 days left — once each (notification_log). */
export async function runTrialReminders(now = new Date()) {
  const trials = await withPlatform(() => db().subscription.findMany({ where: { status: 'trialing', trialEndsAt: { gt: now, lte: new Date(now.getTime() + 8 * DAY) } }, select: { tenantId: true, trialEndsAt: true } }));
  let sent = 0;
  await each('trial-reminder', trials, async (t) => {
    const left = daysLeft(t.trialEndsAt!, now);
    if (!REMIND_AT.includes(left)) return;
    const { tenant, user } = await owner(t.tenantId);
    const text = left === 1
      ? `Hi ${user.name}, ${tenant.name}'s AHEAD trial ends tomorrow. Paid features stop then; your data stays safe on the Free plan.`
      : `Hi ${user.name}, ${left} days left in ${tenant.name}'s AHEAD trial. See the plans under Plan & billing to keep every module.`;
    if (await once(`trial:${t.tenantId}:${left}`, t.tenantId, { channel: 'email', to: user.email, template: `trial.reminder_${left}`, subject: `${left} day${left === 1 ? '' : 's'} left in your AHEAD trial`, text })) sent++;
  });
  return sent;
}

/** Everything billing does on the hour. */
export async function runBillingJobs(now = new Date()) {
  const lapsed = await runLapseUnpaid(now);
  const renewals = await runRenewals(now);
  const dunning = await runDunning(now);
  const reminders = await runTrialReminders(now);
  if (lapsed || renewals || dunning.failed || dunning.freed || reminders) {
    console.log(`[billing] lapsed ${lapsed}, renewals checked ${renewals}, payment failed ${dunning.failed}, moved to Free ${dunning.freed}, trial reminders ${reminders}`);
  }
  cache.delPrefix('ent:tenant:');
}
