import 'dotenv/config';
import { Client } from 'pg';
import type { ConsoleRole, OnboardedBy, SubStatus } from '@prisma/client';
import { prisma } from '../src/kernel/db';
import { issueLicence } from '../src/modules/licences/service';

// One-time move of what the Console used to keep inside the ERP database: Console people (with
// their passwords; two-step is set up again), partners, the businesses with their owners, plans
// and subscriptions. Safe to run again: what is already here is left as it is.
//   npm run import:erp   (reads ERP_DATABASE_URL)

const ROLE: Record<string, ConsoleRole> = { super_admin: 'admin', console_staff: 'staff', console_sales: 'sales', vendor: 'vendor', partner_admin: 'partner_owner', partner_staff: 'partner_staff' };
/** Old plans that are no longer sold, onto the nearest current one */
const PLAN: Record<string, string> = { free: 'free', standard: 'standard', starter: 'standard', professional: 'professional', growth: 'professional', business_pro: 'enterprise', enterprise: 'enterprise' };
const ONBOARDED: Record<string, OnboardedBy> = { self: 'website', vendor: 'vendor', sales_user: 'sales', partner_user: 'partner' };

async function main() {
  const url = process.env.ERP_DATABASE_URL;
  if (!url) throw new Error('Set ERP_DATABASE_URL to the ERP database');
  const erp = new Client({ connectionString: url });
  await erp.connect();
  const q = async <T>(sql: string) => (await erp.query(sql)).rows as T[];

  // Partners
  const partners = await q<{ id: string; name: string; contact_name: string; email: string; mobile: string; gstin: string | null; status: string; created_at: Date }>(`SELECT * FROM partners`);
  for (const p of partners) {
    const code = p.name.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'PARTNER';
    await prisma.partner.upsert({
      where: { id: p.id },
      update: {},
      create: { id: p.id, name: p.name, code: (await prisma.partner.findUnique({ where: { code } })) ? `${code}${p.id.slice(-4).toUpperCase()}` : code, contactName: p.contact_name, email: p.email, mobile: p.mobile, gstin: p.gstin, status: p.status === 'active' ? 'active' : 'disabled', createdAt: p.created_at },
    });
  }

  // Console people
  const people = await q<{ user_id: string; name: string; email: string; mobile: string | null; password_hash: string | null; role: string; status: string; partner_id: string | null; referral_code: string | null; joined_at: Date; last_login_at: Date | null }>(`
    SELECT pm.user_id, u.name, u.email, u.mobile, u.password_hash, r.key AS role, pm.status, pm.partner_id, pm.referral_code, pm.joined_at, u.last_login_at
      FROM platform_members pm JOIN users u ON u.id = pm.user_id JOIN roles r ON r.id = pm.role_id`);
  let staff = 0;
  for (const m of people) {
    const role = ROLE[m.role];
    if (!role) continue;
    const exists = await prisma.consoleUser.findUnique({ where: { email: m.email } });
    if (exists) continue;
    await prisma.consoleUser.create({
      data: {
        id: m.user_id, name: m.name, email: m.email, mobile: m.mobile, passwordHash: m.password_hash, role, partnerId: m.partner_id, referralCode: m.referral_code,
        status: m.status === 'active' ? (m.password_hash ? 'active' : 'invited') : 'disabled', lastLoginAt: m.last_login_at, createdAt: m.joined_at,
      },
    });
    staff++;
  }

  // Businesses, owners and subscriptions
  const rows = await q<{
    id: string; name: string; legal_name: string | null; gstin: string | null; billing_state_code: string | null; industry_key: string; partner_id: string | null; created_at: Date;
    owner_name: string; owner_email: string; owner_mobile: string; plan_key: string; status: SubStatus | 'purged'; cycle: string;
    trial_ends_at: Date | null; current_period_start: Date | null; current_period_end: Date | null; grace_ends_at: Date | null; purge_at: Date | null; closed_at: Date | null;
    acquired_by_type: string | null; acquired_by_user_id: string | null; referral_code: string | null;
  }>(`
    SELECT t.id, t.name, t.legal_name, t.gstin, t.billing_state_code, t.industry_key, t.partner_id, t.created_at, t.closed_at,
           u.name AS owner_name, u.email AS owner_email, u.mobile AS owner_mobile,
           p.key AS plan_key, s.status::text AS status, s.cycle::text AS cycle, s.trial_ends_at, s.current_period_start, s.current_period_end, s.grace_ends_at, s.purge_at,
           a.acquired_by_type::text AS acquired_by_type, a.acquired_by_user_id, a.referral_code
      FROM tenants t
      JOIN users u ON u.id = t.owner_user_id
      JOIN subscriptions s ON s.tenant_id = t.id
      JOIN plans p ON p.id = s.plan_id
      LEFT JOIN tenant_acquisitions a ON a.tenant_id = t.id
     WHERE t.status <> 'purged' AND NOT t.is_internal`);
  let businesses = 0;
  for (const r of rows) {
    if (await prisma.business.findUnique({ where: { id: r.id } })) continue;
    const onboarder = r.acquired_by_user_id ? await prisma.consoleUser.findUnique({ where: { id: r.acquired_by_user_id }, select: { id: true } }) : null;
    const status = (r.status === 'purged' ? 'closed' : r.status) as SubStatus;
    await prisma.$transaction(async (tx) => {
      await tx.business.create({
        data: {
          id: r.id, name: r.name, legalName: r.legal_name, gstin: r.gstin, stateCode: r.billing_state_code, industryKey: r.industry_key,
          ownerName: r.owner_name, ownerEmail: r.owner_email, ownerMobile: r.owner_mobile,
          onboardedBy: r.partner_id ? 'partner' : ONBOARDED[r.acquired_by_type ?? 'self'] ?? 'website', onboardedById: onboarder?.id ?? null, partnerId: r.partner_id, referralCode: r.referral_code,
          provisionedAt: r.created_at, createdAt: r.created_at,
        },
      });
      await tx.subscription.create({
        data: {
          businessId: r.id, planKey: PLAN[r.plan_key] ?? 'free', status, cycle: r.cycle === 'yearly' ? 'yearly' : 'monthly', trialEndsAt: r.trial_ends_at,
          periodStart: r.current_period_start, periodEnd: r.current_period_end, graceEndsAt: r.grace_ends_at, closedAt: r.closed_at, purgeAt: r.purge_at,
        },
      });
      // The business already runs in the ERP: its first Console licence goes out at once
      await issueLicence(tx, r.id);
    });
    businesses++;
  }
  await erp.end();
  console.log(`import: ${partners.length} partners, ${staff} Console people, ${businesses} businesses (licences queued for the ERP)`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
