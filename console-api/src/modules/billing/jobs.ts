import { prisma } from '../../kernel/db';
import { JobTally } from '../../kernel/jobs';
import { audit } from '../../kernel/audit';
import { getSetting } from '../system/settings';
import { issueLicence } from '../licences/service';
import { createOrder } from './service';

// Hourly billing housekeeping, each business on its own:
//   1. renewal orders (with a payment link) a few days before a paid period ends
//   2. a period that ended unpaid: past due, paid modules open through the grace days
//   3. grace over, or the plan was set to stop at the period end: on to Free (data kept)
//   4. unpaid orders past their date: expired; a business still waiting for its first payment then closes

const DAY = 86_400_000;
const SYSTEM = { id: 'system', role: 'admin' as const, partnerId: null };

export async function runBillingJobs(now = new Date()) {
  const tally = new JobTally();
  const [noticeDays, graceDays] = await Promise.all([getSetting<number>('renewal.notice_days'), getSetting<number>('renewal.grace_days')]);
  const free = await prisma.plan.findFirstOrThrow({ where: { isFree: true }, select: { key: true } });

  // 1. Renewals
  const soon = new Date(now.getTime() + (noticeDays ?? 7) * DAY);
  const due = await prisma.subscription.findMany({
    where: { status: { in: ['active', 'past_due'] }, cancelAtPeriodEnd: false, periodEnd: { lte: soon }, business: { orders: { none: { status: { in: ['awaiting_payment', 'pending_approval'] } } } } },
    select: { businessId: true, planKey: true, cycle: true, extraUsers: true, periodEnd: true },
  });
  let renewals = 0;
  for (const s of due) {
    // Already renewed for the period that follows (paid early)
    const paid = await prisma.order.findFirst({ where: { businessId: s.businessId, status: 'paid', kind: 'renewal', paidAt: { gte: new Date((s.periodEnd ?? now).getTime() - 40 * DAY) } }, select: { id: true } });
    if (paid) continue;
    await tally.item(`renewal · ${s.businessId}`, async () => {
      await createOrder(SYSTEM, s.businessId, { planKey: s.planKey, cycle: s.cycle as 'monthly' | 'yearly', extraUsers: s.extraUsers }, { kind: 'renewal' });
      renewals++;
    });
  }
  tally.note(renewals > 0 && `${renewals} renewal order${renewals === 1 ? '' : 's'} sent`);

  // 2. Ended unpaid → past due with grace
  const lapsed = await prisma.subscription.findMany({ where: { status: 'active', periodEnd: { lt: now }, cancelAtPeriodEnd: false }, select: { businessId: true } });
  for (const s of lapsed) {
    await tally.item(`past due · ${s.businessId}`, () =>
      prisma.$transaction(async (tx) => {
        await tx.subscription.update({ where: { businessId: s.businessId }, data: { status: 'past_due', graceEndsAt: new Date(now.getTime() + (graceDays ?? 7) * DAY), version: { increment: 1 } } });
        await issueLicence(tx, s.businessId);
        await audit({ action: 'business.past_due', entity: 'business', entityId: s.businessId }, tx);
      }),
    );
  }
  tally.note(lapsed.length > 0 && `${lapsed.length} now past due`);

  // 3. Grace over, or stopping at the period end → Free
  const toFree = await prisma.subscription.findMany({
    where: { OR: [{ status: 'past_due', graceEndsAt: { lt: now } }, { status: 'active', cancelAtPeriodEnd: true, periodEnd: { lt: now } }] },
    select: { businessId: true, status: true },
  });
  for (const s of toFree) {
    await tally.item(`to Free · ${s.businessId}`, () =>
      prisma.$transaction(async (tx) => {
        await tx.subscription.update({ where: { businessId: s.businessId }, data: { status: 'free', planKey: free.key, periodStart: null, periodEnd: null, graceEndsAt: null, cancelAtPeriodEnd: false, version: { increment: 1 } } });
        await tx.order.updateMany({ where: { businessId: s.businessId, status: { in: ['awaiting_payment', 'pending_approval'] } }, data: { status: 'cancelled', cancelReason: 'The plan moved to Free' } });
        await issueLicence(tx, s.businessId);
        await audit({ action: s.status === 'past_due' ? 'business.unpaid_to_free' : 'business.ended_to_free', entity: 'business', entityId: s.businessId }, tx);
      }),
    );
  }
  tally.note(toFree.length > 0 && `${toFree.length} moved to Free`);

  // 4. Unpaid orders past their date; a business that never paid its first order closes
  const expired = await prisma.order.updateMany({ where: { status: { in: ['awaiting_payment', 'pending_approval'] }, expiresAt: { lt: now } }, data: { status: 'expired' } });
  tally.note(expired.count > 0 && `${expired.count} unpaid order${expired.count === 1 ? '' : 's'} expired`);
  const neverPaid = await prisma.subscription.findMany({
    where: { status: 'incomplete', business: { orders: { none: { status: { in: ['awaiting_payment', 'pending_approval', 'paid'] } } } } },
    select: { businessId: true },
  });
  const keep = (await getSetting<number>('closed.keep_days')) ?? 90;
  for (const s of neverPaid) {
    // Only once an order was made and lapsed (a business added a moment ago may not have one yet)
    const lapsedOrder = await prisma.order.findFirst({ where: { businessId: s.businessId, status: 'expired' }, select: { id: true } });
    if (!lapsedOrder) continue;
    await tally.item(`unpaid close · ${s.businessId}`, () =>
      prisma.$transaction(async (tx) => {
        await tx.subscription.update({ where: { businessId: s.businessId }, data: { status: 'closed', closedAt: now, purgeAt: new Date(now.getTime() + keep * DAY), version: { increment: 1 } } });
        await issueLicence(tx, s.businessId);
        await audit({ action: 'business.unpaid_closed', entity: 'business', entityId: s.businessId }, tx);
      }),
    );
  }
  return tally;
}
