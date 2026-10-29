// Adds (or updates, or deactivates) a member of the AHEAD team in the Console.
// Used to create the first Admin; after that, Console users are managed from the Console (Step 3).
//
//   npm run console:member -- --email you@aheaderp.in --role super_admin
//   npm run console:member -- --email new@aheaderp.in --name "New Person" --mobile +919800000000 --role console_sales
//   npm run console:member -- --email old@aheaderp.in --deactivate
//
// A person without a password gets a login link (printed here and sent by SMS/email) to set their own.
import 'dotenv/config';
import { prisma, withPlatform, db } from '../src/kernel/db';
import { normaliseEmail, normaliseMobile } from '../src/kernel/crypto';
import { audit } from '../src/modules/audit/service';
import { ROLES } from '../src/contracts/roles';
import { sendAccessLink } from '../src/modules/identity/accessLinks';

const CONSOLE_ROLES = ROLES.filter((r) => r.layer === 'platform').map((r) => r.key);

function arg(name: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

function fail(message: string): never {
  console.error(`✖ ${message}`);
  process.exit(1);
}

async function main() {
  const email = arg('email') ? normaliseEmail(arg('email')!) : fail('--email is required');
  const deactivate = process.argv.includes('--deactivate');
  const roleKey = arg('role');
  if (!deactivate && (!roleKey || !CONSOLE_ROLES.includes(roleKey))) fail(`--role must be one of: ${CONSOLE_ROLES.join(', ')}`);

  await withPlatform(async () => {
    const tx = db();
    let user = await tx.user.findUnique({ where: { email } });
    if (!user) {
      if (deactivate) fail(`No user with email ${email}`);
      const hint = `No account with email ${email}. Check the email, or pass --name and --mobile to create a new user.`;
      const name = arg('name') ?? fail(hint);
      const mobile = arg('mobile') ? normaliseMobile(arg('mobile')!) : fail(hint);
      if (await tx.user.findUnique({ where: { mobile } })) fail(`Mobile ${mobile} already belongs to another user`);
      user = await tx.user.create({ data: { name, email, mobile, passwordHash: null } });
      console.log(`• created user ${email}`);
    }

    const existing = await tx.platformMember.findUnique({ where: { userId: user.id } });
    if (deactivate) {
      if (!existing) fail(`${email} is not a Console member`);
      await tx.platformMember.update({ where: { id: existing.id }, data: { status: 'deactivated', deactivatedAt: new Date() } });
      await tx.userSession.updateMany({ where: { userId: user.id, workspace: 'console', revokedAt: null }, data: { revokedAt: new Date() } });
      await audit({ tenantId: null, actorId: null, action: 'console.member_deactivated', entity: 'platform_member', entityId: existing.id });
      console.log(`✔ deactivated ${email} (Console sessions revoked; running APIs drop access within 60 s)`);
      return;
    }

    const role = await tx.role.findFirst({ where: { tenantId: null, key: roleKey!, layer: 'platform' } });
    if (!role) fail(`Role ${roleKey} not found — run npm run db:seed first`);
    let reportsTo: string | null = null;
    if (arg('reports-to')) {
      const manager = await tx.user.findUnique({ where: { email: normaliseEmail(arg('reports-to')!) }, include: { platformMember: true } });
      if (!manager?.platformMember) fail(`--reports-to ${arg('reports-to')} is not a Console member`);
      reportsTo = manager.id;
    }

    const data = { roleId: role.id, reportsTo, status: 'active' as const, deactivatedAt: null };
    const member = existing
      ? await tx.platformMember.update({ where: { id: existing.id }, data })
      : await tx.platformMember.create({ data: { userId: user.id, ...data } });
    await audit({ tenantId: null, actorId: null, action: existing ? 'console.member_updated' : 'console.member_added', entity: 'platform_member', entityId: member.id, after: { email, role: roleKey, reportsTo } });
    console.log(`✔ ${email} is a Console ${role.name}${reportsTo ? ` reporting to ${arg('reports-to')}` : ''}`);
    if (!user.passwordHash) {
      const link = await sendAccessLink({ kind: 'console_member', userId: user.id, createdBy: null });
      console.log(`• login link (7 days): ${link.url}`);
    }
  }, { kind: 'platform' }, { timeoutMs: 60_000 });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
