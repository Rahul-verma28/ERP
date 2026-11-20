// Demo HR team for the dev database: a two-level reporting line with app logins.
//   Rakesh Sharma (Store Manager) → Priya Verma (Senior Sales, Team Manager login)
//     → Amit Kumar, Anil Mehta (Employee self-service logins, free seats), Neha Joshi, Pooja Rani
// Also moves the business to the Professional plan (15 users) so the logins fit, and leaves
// pending leave requests from Priya's team for her to decide.
// Test logins (dev database only), password for all: Team@Demo2026
//   priya.verma.<first 8 of the business id>@example.test, amit.kumar.<…>@example.test, anil.mehta.<…>@example.test
// Usage: npx tsx prisma/demo-hr-team.ts <tenantId> [<tenantId> …]   (skips a business where Priya already has a login)
import { prisma, db, withPlatform } from '../src/kernel/db';
import { hashPassword } from '../src/kernel/crypto';
import { todayIST } from '../src/kernel/gst';
import { persistEntitlements } from '../src/modules/subscription/entitlements';

const PASSWORD = 'Team@Demo2026';
const DAY = 86_400_000;
const run = <T>(fn: () => Promise<T>) => withPlatform(fn, { kind: 'platform' }, { timeoutMs: 600_000 });
const addDays = (s: string, n: number) => new Date(new Date(`${s}T00:00:00Z`).getTime() + n * DAY);

async function seed(tenantId: string) {
  const t = await run(() => prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { name: true } }));
  console.log(`\n${t.name} (${tenantId})`);
  const short = tenantId.slice(0, 8);
  const priyaEmail = `priya.verma.${short}@example.test`;
  if (await run(() => prisma.user.count({ where: { email: priyaEmail } }))) return console.log('  · team logins already there, skipped');

  // Professional plan, paid for a year: 15 users
  const plan = await run(() => prisma.plan.findFirstOrThrow({ where: { key: 'professional' } }));
  await run(() => prisma.subscription.updateMany({ where: { tenantId }, data: { planId: plan.id, status: 'active', trialEndsAt: null, currentPeriodStart: new Date(), currentPeriodEnd: new Date(Date.now() + 365 * DAY), graceEndsAt: null } }));
  await run(() => persistEntitlements(tenantId));
  console.log('  ✔ on the Professional plan (15 users)');

  const emp = async (code: string) => run(() => prisma.employee.findFirstOrThrow({ where: { tenantId, code } }));
  const [rakesh, priya, amit, anil, nehaJ, pooja] = await Promise.all(['EMP-0001', 'EMP-0002', 'EMP-0003', 'EMP-0010', 'EMP-0009', 'EMP-0012'].map(emp));
  // The reporting line: Priya under Rakesh, the sales team under Priya
  await run(() => prisma.employee.update({ where: { id: priya.id }, data: { managerId: rakesh.id } }));
  await run(() => prisma.employee.updateMany({ where: { id: { in: [amit.id, anil.id, nehaJ.id, pooja.id] } }, data: { managerId: priya.id } }));
  console.log('  ✔ Amit, Anil, Neha Joshi and Pooja now report to Priya; Priya reports to Rakesh');

  const role = async (key: string) => run(() => prisma.role.findFirstOrThrow({ where: { key, tenantId: null } }));
  const [manager, self] = await Promise.all([role('team_manager'), role('employee')]);
  const hash = await hashPassword(PASSWORD);
  const login = async (e: { id: string; name: string }, first: string, roleId: string, n: number) => {
    const email = `${first}.${short}@example.test`;
    const user = await run(() => db().user.create({ data: { name: e.name, email, mobile: `+9197${String(parseInt(tenantId.replace(/-/g, '').slice(-7), 16) % 1e7).padStart(7, '0')}${n}`, passwordHash: hash, emailVerifiedAt: new Date(), mobileVerifiedAt: new Date(), passwordChangedAt: new Date(), lastLoginAt: new Date(Date.now() - n * 3_600_000) } }));
    const member = await run(() => db().tenantMember.create({ data: { tenantId, userId: user.id, roleId, status: 'active', joinedAt: new Date(Date.now() - 20 * DAY) } }));
    await run(() => prisma.employee.update({ where: { id: e.id }, data: { memberId: member.id } }));
    return email;
  };
  await login(priya, 'priya.verma', manager.id, 1);
  await login(amit, 'amit.kumar', self.id, 2);
  await login(anil, 'anil.mehta', self.id, 3);
  console.log('  ✔ logins: Priya (Team Manager), Amit and Anil (Employee self-service, free seats)');

  // Pending leave from her team for Priya to decide
  const type = await run(() => prisma.leaveType.findFirst({ where: { tenantId, isActive: true, paid: true }, orderBy: { position: 'asc' } }));
  if (type) {
    const today = todayIST();
    for (const [e, from, days, reason] of [[amit, 5, 2, 'Sister’s wedding in Kanpur'], [nehaJ, 9, 1, 'Doctor appointment'], [anil, 3, 1, 'Bank work']] as const) {
      await run(() => prisma.leaveApplication.create({ data: { tenantId, employeeId: e.id, leaveTypeId: type.id, fromDate: addDays(today, from), toDate: addDays(today, from + days - 1), days, reason, status: 'pending', createdBy: null } }));
    }
    console.log('  ✔ 3 leave requests waiting for Priya');
  }
}

(async () => {
  const ids = process.argv.slice(2);
  if (!ids.length) throw new Error('Usage: npx tsx prisma/demo-hr-team.ts <tenantId> [<tenantId> …]');
  for (const id of ids) await seed(id);
  await prisma.$disconnect();
})().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
