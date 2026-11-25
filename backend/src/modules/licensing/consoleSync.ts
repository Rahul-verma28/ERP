import { prisma, withPlatform } from '../../kernel/db';
import { JobTally } from '../../kernel/jobs';
import { consoleApi, hasConsole } from '../../kernel/consoleClient';
import { applyLicence } from './service';

// Hourly, between this ERP and the Console: (1) the licences issued since the last check, in case a
// delivery was missed (an older one is ignored); (2) each business's usage, for the Console's
// client pages and plan limits. Nothing happens on an installation with no Console.

const DAY = 86_400_000;

export async function runConsoleSync(now = new Date()) {
  const tally = new JobTally();
  if (!hasConsole()) {
    tally.note('No Console connected');
    return tally;
  }

  // 1. Licences issued in the last day (the job runs hourly, so a missed one is picked up well inside it)
  const since = new Date(now.getTime() - DAY).toISOString();
  const { data } = await consoleApi<{ data: { businessId: string; seq: number; licence: string }[] }>('GET', `/licences?since=${encodeURIComponent(since)}`);
  const held = new Map((await prisma.tenantLicence.findMany({ where: { tenantId: { in: data.map((d) => d.businessId) } }, select: { tenantId: true, seq: true } })).map((h) => [h.tenantId, h.seq]));
  const known = new Set((await prisma.tenant.findMany({ where: { id: { in: data.map((d) => d.businessId) } }, select: { id: true } })).map((t) => t.id));
  let applied = 0;
  for (const d of data) {
    if (!known.has(d.businessId) || (held.get(d.businessId) ?? -1) >= d.seq) continue;
    await tally.item(`licence · ${d.businessId}`, async () => {
      const out = await withPlatform(() => applyLicence(d.licence, { tenantId: d.businessId }));
      if (out.applied) applied++;
    });
  }
  tally.note(applied > 0 && `${applied} licence${applied === 1 ? '' : 's'} caught up`);

  // 2. Usage of every business on this installation
  const month = new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 7);
  const tenants = await prisma.tenant.findMany({ where: { status: { not: 'purged' } }, select: { id: true } });
  for (let i = 0; i < tenants.length; i += 500) {
    const ids = tenants.slice(i, i + 500).map((t) => t.id);
    const [members, invoices, customers, files, sessions] = await Promise.all([
      prisma.tenantMember.groupBy({ by: ['tenantId'], where: { tenantId: { in: ids }, status: 'active' }, _count: true }),
      prisma.usageCounter.findMany({ where: { tenantId: { in: ids }, metric: 'invoices', period: month }, select: { tenantId: true, used: true } }),
      prisma.contact.groupBy({ by: ['tenantId'], where: { tenantId: { in: ids }, type: 'customer' }, _count: true }),
      prisma.storedFile.groupBy({ by: ['tenantId'], where: { tenantId: { in: ids } }, _sum: { sizeBytes: true } }),
      prisma.userSession.groupBy({ by: ['tenantId'], where: { tenantId: { in: ids } }, _max: { createdAt: true } }),
    ]);
    const reports = ids.map((id) => ({
      businessId: id,
      users: members.find((m) => m.tenantId === id)?._count ?? 0,
      invoicesThisMonth: Number(invoices.find((x) => x.tenantId === id)?.used ?? 0),
      customers: customers.find((c) => c.tenantId === id)?._count ?? 0,
      storageBytes: Number(files.find((f) => f.tenantId === id)?._sum.sizeBytes ?? 0),
      lastActiveAt: sessions.find((s) => s.tenantId === id)?._max?.createdAt?.toISOString() ?? null,
    }));
    await tally.item(`usage · ${ids.length} businesses`, () => consoleApi('POST', '/usage', { reports }, 30_000));
  }
  return tally;
}
