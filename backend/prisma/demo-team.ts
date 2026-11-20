// Demo team member for the dev database: Neha Sharma, an Admin who signs in, takes tickets and
// tasks, has bookings, and asks for and gives approvals. Fills the Users page, the user page, the
// Approvals page and round-robin ticket handout with a second person.
// Test login (dev database only): neha.sharma.<first 8 of the business id>@example.test / Neha@Demo2026
// Usage: npx tsx prisma/demo-team.ts <tenantId> [<tenantId> …]   (skips a business where Neha is already a member)
import { randomUUID } from 'node:crypto';
import { prisma, db, withPlatform } from '../src/kernel/db';
import { hashPassword } from '../src/kernel/crypto';
import type { TenantCtx } from '../src/kernel/context';
import { todayIST } from '../src/kernel/gst';
import * as tasks from '../src/modules/tasks/service';

const PASSWORD = 'Neha@Demo2026';
const DAY = 86_400_000;
const run = <T>(fn: () => Promise<T>) => withPlatform(fn, { kind: 'platform' }, { timeoutMs: 600_000 });
const addDays = (s: string, n: number) => new Date(new Date(`${s}T00:00:00Z`).getTime() + n * DAY).toISOString().slice(0, 10);

async function seed(tenantId: string) {
  const t = await run(() => prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { name: true, ownerUserId: true } }));
  console.log(`\n${t.name} (${tenantId})`);
  const email = `neha.sharma.${tenantId.slice(0, 8)}@example.test`;
  const existing = await run(() => prisma.user.findFirst({ where: { email }, select: { id: true } }));
  if (existing && (await run(() => prisma.tenantMember.count({ where: { tenantId, userId: existing.id } })))) return console.log('  · Neha is already here, skipped');

  const adminRole = await run(() => prisma.role.findFirstOrThrow({ where: { key: 'admin', tenantId: null } }));
  const mobile = `+9198${String(parseInt(tenantId.replace(/-/g, '').slice(-8), 16) % 1e8).padStart(8, '0')}`;
  const user = existing ?? await run(async () => db().user.create({ data: { name: 'Neha Sharma', email, mobile, passwordHash: await hashPassword(PASSWORD), emailVerifiedAt: new Date(), mobileVerifiedAt: new Date(), passwordChangedAt: new Date(), lastLoginAt: new Date(Date.now() - 3 * 3_600_000) } }));
  const member = await run(() => db().tenantMember.create({ data: { tenantId, userId: user.id, roleId: adminRole.id, status: 'active', joinedAt: new Date(Date.now() - 32 * DAY) } }));
  // A few sign-ins over the last weeks, one wrong password
  await run(() => db().signInEvent.createMany({ data: [3, 1, 0.2, 6, 9, 13].map((d, i) => ({ userId: user.id, tenantId, identifier: email, outcome: i === 3 ? 'wrong_password' : 'success', method: 'password', ip: '49.36.112.8', userAgent: i % 2 ? 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/131.0 Mobile Safari/537.36' : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36', createdAt: new Date(Date.now() - d * DAY) })) }));
  console.log(`  ✔ Neha Sharma added as Admin (${email})`);

  const owner: TenantCtx = { kind: 'tenant', tenantId, userId: t.ownerUserId!, memberId: (await run(() => prisma.tenantMember.findFirstOrThrow({ where: { tenantId, userId: t.ownerUserId! } }))).id, roleId: '', sessionId: randomUUID(), branchIds: [], scope: 'all' };
  owner.roleId = (await run(() => prisma.tenantMember.findUniqueOrThrow({ where: { id: owner.memberId } }))).roleId;
  const neha: TenantCtx = { ...owner, userId: user.id, memberId: member.id, roleId: adminRole.id };
  const today = todayIST();

  // Work: a share of the open tasks, tickets and coming bookings
  const openTasks = await run(() => db().task.findMany({ where: { tenantId, status: { in: ['todo', 'in_progress'] }, parentId: null }, orderBy: { createdAt: 'asc' }, select: { id: true } }));
  for (const tk of openTasks.filter((_, i) => i % 3 === 1)) await run(() => db().task.update({ where: { id: tk.id }, data: { assigneeId: user.id } }));
  const openTickets = await run(() => db().supportTicket.findMany({ where: { tenantId, status: { in: ['open', 'pending', 'on_hold'] } }, orderBy: { createdAt: 'asc' }, select: { id: true } }));
  for (const tk of openTickets.filter((_, i) => i % 2 === 0)) await run(() => db().supportTicket.update({ where: { id: tk.id }, data: { assigneeId: user.id } }));
  const coming = await run(() => db().appointment.findMany({ where: { tenantId, startAt: { gte: new Date() }, status: { in: ['scheduled', 'confirmed'] }, kind: 'appointment' }, orderBy: { startAt: 'asc' }, select: { id: true } }));
  for (const a of coming.filter((_, i) => i % 3 === 2)) await run(() => db().appointment.update({ where: { id: a.id }, data: { staffId: user.id } }));
  await run(() => db().supportSettings.updateMany({ where: { tenantId }, data: { lastAssignedId: t.ownerUserId } }));
  console.log(`  ✔ gave her ${Math.ceil(openTasks.length / 3)} tasks, ${Math.ceil(openTickets.length / 2)} tickets and ${Math.floor(coming.length / 3)} bookings`);

  // Approvals both ways: waiting, approved, rejected
  const ask = async (who: TenantCtx, to: string, title: string, kind: 'expense' | 'purchase' | 'discount' | 'leave' | 'payment' | 'other', amount: number | null, details: string, needBy: number | null) =>
    run(() => tasks.requestApproval(who, tasks.ApprovalInput.parse({ title, kind, amountPaise: amount, details, approverId: to, needBy: needBy === null ? null : addDays(today, needBy) })));
  const decide = async (who: TenantCtx, a: { id: string; version: number }, d: 'approved' | 'rejected', note: string) => run(() => tasks.decideApproval(who, a.id, d, note, a.version));
  const r1 = await ask(neha, owner.userId!, 'New billing printer for the counter', 'purchase', 1_450_000, 'Epson TM-T82 thermal printer. The old one jams twice a day.', 3);
  await ask(neha, owner.userId!, '10% discount for Kapoor General Store', 'discount', 420_000, 'Bulk order of 60 fans; they asked for 10% to match another shop.', 1);
  const r3 = await ask(neha, owner.userId!, 'Diwali bonus advance for 3 staff', 'payment', 1_500_000, '₹5,000 each, adjusted in November salary.', null);
  const r4 = await ask(neha, owner.userId!, 'Team dinner after the Diwali sale', 'expense', 600_000, 'For 8 people at Punjab Dhaba.', null);
  const r5 = await ask(neha, owner.userId!, 'Leave on 28 November', 'leave', null, 'Family function in Lucknow.', 7);
  await decide(owner, r1, 'approved', 'Go ahead, buy from the authorised dealer.');
  await decide(owner, r3, 'approved', 'Approved. Tell accounts.');
  await decide(owner, r4, 'rejected', 'Let us do it after the year-end instead.');
  void r5;
  const o1 = await ask(owner, user.id, 'Pay Kanpur Packaging Co ₹28,037', 'payment', 2_803_700, 'Their bill is 58 days late. Check the goods were all received first.', 2);
  const o2 = await ask(owner, user.id, 'Write off ₹1,200 short in the cash drawer', 'other', 120_000, 'Counted short on Saturday. No bill found for it.', null);
  await decide(neha, o2, 'approved', 'Checked the day book; approved.');
  void o1;
  console.log('  ✔ 7 approvals: 3 waiting, 3 approved, 1 rejected');
}

(async () => {
  const ids = process.argv.slice(2);
  if (!ids.length) throw new Error('Usage: npx tsx prisma/demo-team.ts <tenantId> [<tenantId> …]');
  for (const id of ids) await seed(id);
  await prisma.$disconnect();
})().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
