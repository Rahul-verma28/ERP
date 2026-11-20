// Demo customer portal for the dev database: switches the portal on at /portal/<business>-account,
// and leaves one quotation "sent" for Malhotra Electricals so accept / decline shows.
// Sign in as Malhotra Electricals with mobile 9811556677; in development the code shows on screen.
// Usage: npx tsx prisma/demo-portal.ts <tenantId> [<tenantId> …]
import { randomUUID } from 'node:crypto';
import { prisma, withPlatform } from '../src/kernel/db';
import type { TenantCtx } from '../src/kernel/context';
import * as portal from '../src/modules/portal/service';

const run = <T>(fn: () => Promise<T>) => withPlatform(fn, { kind: 'platform' }, { timeoutMs: 600_000 });

async function seed(tenantId: string) {
  const t = await run(() => prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { name: true, ownerUserId: true } }));
  console.log(`\n${t.name} (${tenantId})`);
  const m = await run(() => prisma.tenantMember.findFirstOrThrow({ where: { tenantId, userId: t.ownerUserId! } }));
  const ctx: TenantCtx = { kind: 'tenant', tenantId, userId: t.ownerUserId!, memberId: m.id, roleId: m.roleId, sessionId: randomUUID(), branchIds: [], scope: 'all' };
  const current = await run(() => portal.getSettings(ctx));
  const slug = current.slug ?? `${t.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30)}-account`;
  await run(() => portal.saveSettings(ctx, portal.SettingsInput.parse({ ...current, enabled: true, slug, title: `Your account with ${t.name}`, intro: current.intro ?? 'See your bills and pay by UPI, download your statement, and raise a request.' })));
  console.log(`  ✔ portal on at /portal/${slug}`);
  // Portal test tickets made while building it
  const gone = await run(() => prisma.supportTicket.deleteMany({ where: { tenantId, subject: { startsWith: 'Portal test' } } }));
  if (gone.count) console.log(`  ✔ removed ${gone.count} test ticket(s)`);
  const c = await run(() => prisma.contact.findFirst({ where: { tenantId, type: 'customer', companyName: 'Malhotra Electricals' } }));
  if (!c) return console.log('  · no Malhotra Electricals here');
  const q = await run(() => prisma.salesDocument.findFirst({ where: { tenantId, contactId: c.id, kind: 'quotation', status: { in: ['sent', 'accepted', 'declined', 'draft'] } }, orderBy: { createdAt: 'desc' } }));
  if (q) {
    await run(() => prisma.salesDocument.update({ where: { id: q.id }, data: { status: 'sent', dueDate: new Date(Date.now() + 20 * 86_400_000) } }));
    console.log(`  ✔ quotation ${q.number ?? q.id.slice(0, 8)} is "sent" to Malhotra Electricals, valid 20 days`);
  } else console.log('  · Malhotra Electricals has no quotation to send');
}

(async () => {
  const ids = process.argv.slice(2);
  if (!ids.length) throw new Error('Usage: npx tsx prisma/demo-portal.ts <tenantId> [<tenantId> …]');
  for (const id of ids) await seed(id);
  await prisma.$disconnect();
})().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
