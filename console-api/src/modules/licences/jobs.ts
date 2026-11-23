import { CLOUD_LICENCE_DAYS } from '@contracts/licence';
import { prisma } from '../../kernel/db';
import { JobTally } from '../../kernel/jobs';
import { audit } from '../../kernel/audit';
import { issueLicence } from './service';

const DAY = 86_400_000;

/** Every business holds a licence with at least half its life left (and ended trials move to Free) */
export async function runLicenceJobs(now = new Date()) {
  const tally = new JobTally();

  // Trials that ended: on to the Free plan, data kept
  const ended = await prisma.subscription.findMany({ where: { status: 'trialing', trialEndsAt: { lt: now } }, select: { businessId: true } });
  const free = await prisma.plan.findFirst({ where: { isFree: true }, select: { key: true } });
  for (const s of ended) {
    await tally.item(`trial end · ${s.businessId}`, () =>
      prisma.$transaction(async (tx) => {
        await tx.subscription.update({ where: { businessId: s.businessId }, data: { status: 'free', planKey: free!.key, version: { increment: 1 } } });
        await issueLicence(tx, s.businessId);
        await audit({ action: 'business.trial_ended', entity: 'business', entityId: s.businessId }, tx);
      }),
    );
  }
  tally.note(ended.length > 0 && `${ended.length} trial${ended.length === 1 ? '' : 's'} ended`);

  // Licences past half their life get a fresh one
  const before = new Date(now.getTime() + (CLOUD_LICENCE_DAYS / 2) * DAY);
  const stale = await prisma.$queryRaw<{ id: string }[]>`
    SELECT b.id FROM businesses b
     WHERE NOT EXISTS (SELECT 1 FROM licences l WHERE l.business_id = b.id AND l.expires_at >= ${before})`;
  for (const b of stale) await tally.item(`licence · ${b.id}`, () => prisma.$transaction((tx) => issueLicence(tx, b.id)));
  tally.note(stale.length > 0 && `${stale.length} licence${stale.length === 1 ? '' : 's'} renewed`);
  return tally;
}
