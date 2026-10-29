// Re-computes every client's module entitlements from its plan and the modules' free-tier
// flags. Run once after a pricing change (Console v3: npm run entitlements:recompute).
import 'dotenv/config';
import { prisma, withPlatform } from '../src/kernel/db';
import { persistEntitlements } from '../src/modules/subscription/entitlements';

async function main() {
  const subs = await prisma.subscription.findMany({ select: { tenantId: true } });
  for (const s of subs) {
    await withPlatform(() => persistEntitlements(s.tenantId), { kind: 'platform' }, { timeoutMs: 60_000 });
  }
  console.log(`✔ re-computed entitlements for ${subs.length} clients`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
