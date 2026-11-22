import { prisma, withPlatform } from '../../kernel/db';
import { JobTally } from '../../kernel/jobs';
import { transition } from './stateMachine';

// LLD §11.4 — hourly: move expired trials to the Free plan (paid modules → read_only).
// Each business moves in its own transaction; one that fails is counted and skipped, and is
// tried again on the next run, while the rest still move.
export async function runTrialExpiry(now = new Date()) {
  const tally = new JobTally();
  const failed = new Set<string>();
  for (;;) {
    const batch = await prisma.subscription.findMany({
      where: { status: 'trialing', trialEndsAt: { lte: now }, tenantId: { notIn: [...failed] } },
      select: { tenantId: true },
      orderBy: { trialEndsAt: 'asc' },
      take: 100,
    });
    if (!batch.length) break;
    for (const { tenantId } of batch) {
      const ok = await tally.item(`business ${tenantId}`, () => withPlatform(() => transition(tenantId, 'trial_expired', { now })));
      if (!ok) failed.add(tenantId);
    }
  }
  tally.note(tally.done > 0 && `${tally.done} trial${tally.done === 1 ? '' : 's'} ended`);
  return tally;
}
