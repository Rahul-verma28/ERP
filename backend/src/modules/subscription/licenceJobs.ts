import { prisma, withPlatform } from '../../kernel/db';
import { JobTally } from '../../kernel/jobs';
import { CLOUD_LICENCE_DAYS } from '../../contracts/licence';
import { persistEntitlements } from './entitlements';

// No longer scheduled: console-api issues and renews licences (docs/architecture/console-erp-split.md).
// Kept for a one-off run on an ERP without a Console during the move. Console side: every business holds a fresh licence. Hourly, a licence that runs out within half
// its life is issued again, and a business with none gets its first. Each business on its own.

const DAY = 86_400_000;

export async function runLicenceRefresh(now = new Date()) {
  const tally = new JobTally();
  const before = new Date(now.getTime() + (CLOUD_LICENCE_DAYS / 2) * DAY);
  const due = await prisma.$queryRaw<{ id: string; owner_user_id: string | null }[]>`
    SELECT t.id, t.owner_user_id
      FROM tenants t
      JOIN subscriptions s ON s.tenant_id = t.id
      LEFT JOIN tenant_licences l ON l.tenant_id = t.id
     WHERE t.status <> 'purged' AND (l.tenant_id IS NULL OR l.expires_at < ${before})`;
  let issued = 0;
  for (const t of due) {
    await tally.item(`business ${t.id}`, async () => {
      // Console work: platform rights (plans, prices and subscriptions are not the business's tables)
      await withPlatform(() => persistEntitlements(t.id));
      issued += 1;
    });
  }
  tally.note(issued > 0 && `${issued} licence${issued === 1 ? '' : 's'} issued`);
  return tally;
}
