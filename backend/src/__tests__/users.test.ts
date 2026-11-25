import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { prisma, db, withPlatform } from '../kernel/db';
import type { TenantCtx } from '../kernel/context';
import { MODULE_KEYS } from '../contracts/modules';
import { getUser, listUsers, resendInvitation, signOutEverywhere } from '../modules/tenancy/users';

// The test business lives inside a rolled-back transaction the entitlement cache can't see:
// every module on, 5 seats
vi.mock('../modules/licensing/entitlements', () => ({
  getEntitlements: async () => ({ modules: Object.fromEntries(MODULE_KEYS.map((k) => [k, { status: 'active', tier: 'full' }])), limits: { users: 5 } }),
}));

class Rollback extends Error {}
async function rolledBack(fn: () => Promise<void>) {
  try {
    await withPlatform(async () => { await fn(); throw new Rollback(); }, { kind: 'platform' }, { timeoutMs: 120_000 });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
}
afterAll(() => prisma.$disconnect());

async function prepare() {
  const n = String(Math.floor(Math.random() * 1e9)).padStart(9, '0');
  const owner = await db().user.create({ data: { name: 'Owner', email: `us-${n}@example.test`, mobile: `+917${n}` } });
  const staff = await db().user.create({ data: { name: 'Neha', email: `usn-${n}@example.test`, mobile: `+918${n}`, mfaEnabled: true } });
  const tenant = await db().tenant.create({ data: { name: `US ${n}`, industryKey: 'general', templateVersion: 1, ownerUserId: owner.id, billingStateCode: '09' } });
  const ownerRole = (await prisma.role.findFirstOrThrow({ where: { key: 'owner', tenantId: null }, select: { id: true } })).id;
  const staffRole = await prisma.role.findFirstOrThrow({ where: { tenantId: null, isPredefined: true, NOT: { key: 'owner' }, layer: 'tenant' }, select: { id: true, name: true } });
  const m = await db().tenantMember.create({ data: { tenantId: tenant.id, userId: owner.id, roleId: ownerRole, status: 'active' } });
  const s = await db().tenantMember.create({ data: { tenantId: tenant.id, userId: staff.id, roleId: staffRole.id, status: 'active' } });
  const ctx: TenantCtx = { kind: 'tenant', tenantId: tenant.id, userId: owner.id, memberId: m.id, roleId: ownerRole, sessionId: randomUUID(), branchIds: [], scope: 'all' };
  return { ctx, tenantId: tenant.id, owner, staff, ownerMember: m, staffMember: s, staffRole };
}

describe('users', () => {
  it('lists people and invitations together with their open work and counts', async () => {
    await rolledBack(async () => {
      const { ctx, tenantId, staff, staffRole } = await prepare();
      await db().task.create({ data: { tenantId, title: 'Call the supplier', status: 'todo', assigneeId: staff.id, dueAt: new Date(Date.now() - 86_400_000), createdBy: ctx.userId } });
      await db().invitation.create({ data: { tenantId, email: 'new@example.test', roleId: staffRole.id, tokenHash: randomUUID(), invitedBy: ctx.userId, expiresAt: new Date(Date.now() - 1000) } });
      const l = await listUsers(ctx);
      expect(l.counts).toMatchObject({ all: 3, active: 2, invited: 1, nomfa: 1 });
      const neha = l.data.find((u) => u.name === 'Neha')!;
      expect(neha.kind === 'member' && neha.work).toMatchObject({ tasks: 1, lateTasks: 1 });
      const inv = l.data.find((u) => u.kind === 'invite')!;
      expect(inv.kind === 'invite' && inv.expired).toBe(true);
      expect(l.sums.expiredInvites).toBe(1);
    });
  });

  it("shows one person's access by module, sends an invitation again and signs people out", async () => {
    await rolledBack(async () => {
      const { ctx, tenantId, staff, ownerMember, staffMember, staffRole } = await prepare();
      const u = await getUser(ctx, staffMember.id);
      expect(u.role.name).toBe(staffRole.name);
      expect(u.mfaEnabled).toBe(true);
      expect(u.access.modules.every((m) => m.resources.every((r) => r.actions.length > 0))).toBe(true);
      expect(u.owner).toBe(false);

      const inv = await db().invitation.create({ data: { tenantId, email: 'again@example.test', roleId: staffRole.id, tokenHash: randomUUID(), invitedBy: ctx.userId, expiresAt: new Date(Date.now() - 1000) } });
      await resendInvitation(ctx, inv.id);
      expect((await db().invitation.findUniqueOrThrow({ where: { id: inv.id } })).expiresAt.getTime()).toBeGreaterThan(Date.now() + 6 * 86_400_000);

      await db().userSession.create({ data: { userId: staff.id, familyId: randomUUID(), tenantId, refreshTokenHash: randomUUID(), expiresAt: new Date(Date.now() + 86_400_000) } });
      expect((await signOutEverywhere(ctx, staffMember.id)).signedOut).toBe(1);
      await expect(signOutEverywhere(ctx, ownerMember.id)).rejects.toThrow('yourself');
    });
  });
});
