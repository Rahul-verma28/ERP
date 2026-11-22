import { Prisma } from '@prisma/client';
import { prisma, withTenant } from '../../kernel/db';
import { JobTally } from '../../kernel/jobs';
import { autoClose } from './service';

// Hourly: resolved tickets that nobody reopened close after the business's set days (Customer
// Service › Setup). Opening the ticket list does the same for that business; this catches the
// businesses where nobody opened it. Each business runs on its own.

const DEFAULT_DAYS = 7;

export async function runSupportAutoClose() {
  const tally = new JobTally();
  // Businesses with a resolved ticket old enough to close under their own setting
  const due = await prisma.$queryRaw<{ tenant_id: string; days: number }[]>(Prisma.sql`
    SELECT t.tenant_id, coalesce(s.auto_close_days, ${DEFAULT_DAYS}::int) AS days
      FROM support_tickets t
      LEFT JOIN support_settings s ON s.tenant_id = t.tenant_id
     WHERE t.status = 'resolved' AND coalesce(s.auto_close_days, ${DEFAULT_DAYS}::int) > 0
       AND t.resolved_at < now() - make_interval(days => coalesce(s.auto_close_days, ${DEFAULT_DAYS}::int))
     GROUP BY t.tenant_id, s.auto_close_days`);
  let closed = 0;
  for (const b of due) {
    await tally.item(`business ${b.tenant_id}`, async () => {
      closed += (await withTenant({ kind: 'system', tenantId: b.tenant_id }, () => autoClose({ tenantId: b.tenant_id }, Number(b.days)))) ?? 0;
    });
  }
  tally.note(closed > 0 && `${closed} ticket${closed === 1 ? '' : 's'} closed`);
  return tally;
}
