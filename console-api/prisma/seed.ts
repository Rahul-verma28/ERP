import 'dotenv/config';
import { PrismaClient, type Prisma } from '@prisma/client';
import { MODULES } from '@contracts/modules';
import { TRIAL_LIMITS } from '@contracts/plans';

// Reference data the Console starts with: pricing option A (approved 29 Oct 2026) and the
// settings the team can change later. Only missing rows are added, so Console edits are kept.

const prisma = new PrismaClient();
const FREE_TIER = MODULES.filter((m) => m.freeTier).map((m) => m.key);
const CORE = ['crm', 'catalog', 'billing', 'tasks', 'sales', 'inventory', 'finance', 'bookings', 'reports'];

const PLANS: Prisma.PlanCreateInput[] = [
  {
    key: 'free', name: 'Free', tagline: 'CRM, products, billing and tasks — free forever', monthlyPaise: 0, yearlyPaise: 0, isFree: true, sortOrder: 1,
    limits: { users: 2, branches: 1, contacts: 1000, items: 500, invoicesPerMonth: 100, storageMb: 1024, aiCredits: 0 }, modules: FREE_TIER,
  },
  {
    key: 'standard', name: 'Standard', tagline: 'Everything a small business runs on, with stock', monthlyPaise: 99_900, yearlyPaise: 999_000, sortOrder: 2,
    limits: { users: 5, branches: 1, contacts: 10_000, items: 5000, invoicesPerMonth: null, storageMb: 5120, aiCredits: 0 }, modules: CORE,
  },
  {
    key: 'professional', name: 'Professional', tagline: 'For growing teams: HR, customer service and automation', monthlyPaise: 249_900, yearlyPaise: 2_499_000, isTrial: true, sortOrder: 3,
    limits: { users: 15, branches: 3, contacts: null, items: null, invoicesPerMonth: null, storageMb: 20_480, aiCredits: 0 }, modules: [...CORE, 'hr', 'support'],
  },
  {
    key: 'enterprise', name: 'Enterprise', tagline: 'Any users and branches, every module including AI — quoted by AHEAD', monthlyPaise: null, yearlyPaise: null, sortOrder: 4,
    limits: { users: 50, branches: 50, contacts: null, items: null, invoicesPerMonth: null, storageMb: 512_000, aiCredits: 5000 }, modules: MODULES.map((m) => m.key),
  },
];

const SETTINGS: Record<string, Prisma.InputJsonValue> = {
  'trial.days': 14,
  'trial.limits': TRIAL_LIMITS as unknown as Prisma.InputJsonValue,
  'extra_user.monthly_paise': 19_900,
  'extra_user.yearly_paise': 199_000,
  /** Days a closed business's data is kept before it is deleted */
  'closed.keep_days': 90,
  /** Days a failed renewal keeps paid modules open */
  'renewal.grace_days': 7,
  /** Largest discount each role may give on one order (percent) */
  'discount.limits': { admin: 100, staff: 15, sales: 10, vendor: 5, partner_owner: 0, partner_staff: 0 },
  /** AHEAD's own details on its invoices. SAC and rate: confirm with the CA. */
  seller: { legalName: 'AHEAD Software', gstin: '', stateCode: '', address: '', email: '', sac: '998314', gstRateBp: 1800 },
  /** First payment of a business that signed up with a referral code */
  'referral.welcome_discount_percent': 10,
  /** Days an unpaid first order stays open before it lapses */
  'orders.pay_within_days': 14,
  /** Days before the period ends that the renewal order goes out */
  'renewal.notice_days': 7,
};

async function main() {
  let plans = 0;
  for (const p of PLANS) {
    const exists = await prisma.plan.findUnique({ where: { key: p.key }, select: { key: true } });
    if (!exists) {
      await prisma.plan.create({ data: p });
      plans++;
    }
  }
  let settings = 0;
  for (const [key, value] of Object.entries(SETTINGS)) {
    const r = await prisma.setting.createMany({ data: [{ key, value }], skipDuplicates: true });
    settings += r.count;
  }
  console.log(`seed: ${plans} plan${plans === 1 ? '' : 's'} and ${settings} setting${settings === 1 ? '' : 's'} added`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
