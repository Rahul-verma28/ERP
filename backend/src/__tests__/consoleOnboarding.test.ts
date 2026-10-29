import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { prisma, db, withPlatform } from '../kernel/db';
import type { ConsoleCtx } from '../kernel/context';
import { createClient } from '../modules/platformBilling/service';
import { acceptHandover, handOver, handoverForOwner, importForBusiness, listOnboarding, onboardingDetail, progressOf, saveBranding, saveConfig, skipStep } from '../modules/console/onboarding';

// Blueprint Phase B: steps 1–3 create the business without a login link; steps 4–7 (branding,
// configuration, import, hand over) are saved on it; the owner accepts in the ERP.
// Runs in a rolled-back platform transaction; business-side writes use their own RLS
// transaction and are cleaned up at the end.

class Rollback extends Error {}
async function rolledBack(fn: () => Promise<void>) {
  try {
    await withPlatform(async () => { await fn(); throw new Rollback(); }, { kind: 'platform' }, { timeoutMs: 180_000 });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
}

afterAll(() => prisma.$disconnect());

async function consoleUser(roleKey: string, scope: ConsoleCtx['scope'] = 'all'): Promise<ConsoleCtx> {
  const n = String(Math.floor(Math.random() * 1e9)).padStart(9, '0');
  const user = await db().user.create({ data: { name: `PB ${roleKey}`, email: `pb-${n}@example.test`, mobile: `+918${n}` } });
  const role = await db().role.findFirstOrThrow({ where: { tenantId: null, key: roleKey, layer: { in: ['platform', 'partner'] } } });
  const member = await db().platformMember.create({ data: { userId: user.id, roleId: role.id } });
  return { kind: 'platform', userId: user.id, memberId: member.id, roleId: role.id, sessionId: randomUUID(), scope, partnerId: null };
}

describe('handover progress', () => {
  it('counts the 3 creation steps, the 3 set-up steps and the hand-over', () => {
    expect(progressOf({ startedAt: '', startedBy: null, steps: {} }, false)).toMatchObject({ stage: 'setting_up', nextStep: 'branding', percent: 43 });
    expect(progressOf({ startedAt: '', startedBy: null, steps: { branding: 'done', config: 'skipped', import: 'done' } }, false)).toMatchObject({ nextStep: 'handover', percent: 86 });
    expect(progressOf({ startedAt: '', startedBy: null, steps: { branding: 'done', config: 'done', import: 'done' }, sentAt: 'x' }, true)).toMatchObject({ stage: 'signed_in', nextStep: null, percent: 100 });
  });
});

describe('onboarding wizard', () => {
  it('sets up a business, hands it over once, and only the owner accepts it', async () => {
    let tenantId = '';
    await rolledBack(async () => {
      const sales = await consoleUser('console_sales', 'own');
      const n = String(Math.floor(Math.random() * 1e9)).padStart(9, '0');
      const out = await createClient(sales, { business: { name: 'Wizard Traders', industryKey: 'retail', stateCode: '27' }, owner: { name: 'Meera Shah', email: `pbo-${n}@example.test`, mobile: `+919${n}` }, start: 'trial', setup: true });
      tenantId = out.tenantId;
      expect(out.loginLink).toBeNull();
      expect(await db().accessLink.count({ where: { tenantId } })).toBe(0);
      expect((await listOnboarding(sales)).some((r) => r.id === tenantId)).toBe(true);
    });
    // The business above was rolled back with everything else: nothing to clean
    expect(await prisma.tenant.count({ where: { id: tenantId } })).toBe(0);
  });

  it('runs steps 4–7 on a real business and records each one', async () => {
    const admin = await withPlatform(() => consoleUser('super_admin'));
    const n = String(Math.floor(Math.random() * 1e9)).padStart(9, '0');
    const created = await withPlatform(() => createClient(admin, { business: { name: 'Handover Mart', industryKey: 'retail', stateCode: '27' }, owner: { name: 'Ravi Kumar', email: `pbh-${n}@example.test`, mobile: `+917${n}` }, start: 'trial', setup: true }), { kind: 'platform' }, { timeoutMs: 60_000 });
    const id = created.tenantId;
    try {
      await withPlatform(async () => {
        await saveBranding(admin, id, { brandColor: '#0F766E', font: 'manrope', theme: 'light', density: 'compact' });
        await expect(saveConfig(admin, id, { fyStartMonth: 4, invoicePrefix: 'BAD PREFIX', quotationPrefix: 'QT/{FY}/', receiptPrefix: 'RCT/{FY}/', template: 'classic' })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
        await saveConfig(admin, id, { fyStartMonth: 4, invoicePrefix: 'HM/{FY}/', quotationPrefix: 'QT/{FY}/', receiptPrefix: 'RCT/{FY}/', template: 'classic', invoiceStartAt: 120 });
        const imported = await importForBusiness(admin, id, { kind: 'contacts', rows: [{ name: 'Asha', phone: '9876500001' }, { name: 'Bad', phone: '12' }], onDuplicate: 'skip' });
        expect(imported.created).toBe(1);
        expect(imported.errors).toHaveLength(1);
        await skipStep(admin, id, 'import'); // already done: stays done
        const detail = await onboardingDetail(admin, id);
        expect(detail.branding.brandColor).toBe('#0F766E');
        expect(detail.config.documents.invoicePrefix).toBe('HM/{FY}/');
        expect(detail.config.sequences.find((s) => s.docType === 'invoice')?.nextNo).toBe(120);
        expect(detail.handover.steps).toEqual({ branding: 'done', config: 'done', import: 'done' });
        expect(detail.counts.contacts).toBe(1);

        const link = await handOver(admin, id);
        expect(link.url).toContain('/start/');
        const owner = (await db().tenant.findUniqueOrThrow({ where: { id } })).ownerUserId;
        expect(await handoverForOwner(id, owner)).not.toBeNull();
        expect(await handoverForOwner(id, admin.userId)).toBeNull();
        await expect(acceptHandover(id, admin.userId)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
        await acceptHandover(id, owner);
        expect(await handoverForOwner(id, owner)).toBeNull();
        expect((await listOnboarding(admin)).some((r) => r.id === id)).toBe(false);
      }, { kind: 'platform' }, { timeoutMs: 120_000 });
    } finally {
      // Remove the test business and its owner (owner client: no RLS)
      await cleanup(id, admin.userId);
    }
  }, 180_000);
});

async function cleanup(tenantId: string, adminUserId: string) {
  const t = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { ownerUserId: true } });
  const tables = await prisma.$queryRaw<{ table_name: string }[]>`SELECT table_name::text AS table_name FROM information_schema.columns WHERE column_name = 'tenant_id' AND table_schema = 'public' AND table_name <> 'tenants'`;
  for (let pass = 0; pass < 3; pass++) {
    for (const { table_name } of tables) {
      await prisma.$executeRawUnsafe(`DELETE FROM "${table_name}" WHERE tenant_id = $1::uuid`, tenantId).catch(() => undefined);
    }
  }
  await prisma.$executeRawUnsafe(`DELETE FROM tenants WHERE id = $1::uuid`, tenantId).catch(() => undefined);
  for (const uid of [t?.ownerUserId, adminUserId].filter(Boolean) as string[]) {
    await prisma.$executeRawUnsafe(`DELETE FROM platform_members WHERE user_id = $1::uuid`, uid).catch(() => undefined);
    await prisma.$executeRawUnsafe(`DELETE FROM user_sessions WHERE user_id = $1::uuid`, uid).catch(() => undefined);
    await prisma.$executeRawUnsafe(`DELETE FROM users WHERE id = $1::uuid`, uid).catch(() => undefined);
  }
}
