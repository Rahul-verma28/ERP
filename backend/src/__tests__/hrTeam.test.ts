import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { prisma, db, withPlatform } from '../kernel/db';
import type { TenantCtx } from '../kernel/context';
import { MODULE_KEYS } from '../contracts/modules';
import { hrReach } from '../modules/hr/employees';
import * as time from '../modules/hr/time';
import { invite } from '../modules/tenancy/service';

// The test business lives inside a rolled-back transaction the entitlement cache can't see: 1 seat
vi.mock('../modules/licensing/entitlements', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../modules/licensing/entitlements')>()),
  getEntitlements: async () => ({ modules: Object.fromEntries(MODULE_KEYS.map((k) => [k, { status: 'active', tier: 'full' }])), limits: { users: 1 } }),
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
  const owner = await db().user.create({ data: { name: 'Owner', email: `ht-${n}@example.test`, mobile: `+917${n}` } });
  const lead = await db().user.create({ data: { name: 'Priya', email: `htp-${n}@example.test`, mobile: `+918${n}` } });
  const tenant = await db().tenant.create({ data: { name: `HT ${n}`, industryKey: 'general', templateVersion: 1, ownerUserId: owner.id, billingStateCode: '09' } });
  const role = async (key: string) => (await prisma.role.findFirstOrThrow({ where: { key, tenantId: null }, select: { id: true } })).id;
  const om = await db().tenantMember.create({ data: { tenantId: tenant.id, userId: owner.id, roleId: await role('owner'), status: 'active' } });
  const lm = await db().tenantMember.create({ data: { tenantId: tenant.id, userId: lead.id, roleId: await role('team_manager'), status: 'active' } });
  const t = tenant.id;
  const e = (code: string, name: string, managerId: string | null, memberId: string | null = null) => db().employee.create({ data: { tenantId: t, code, name, joinedOn: new Date('2025-01-01T00:00:00Z'), managerId, memberId } });
  const boss = await e('E1', 'Rakesh', null);
  const priya = await e('E2', 'Priya', boss.id, lm.id);
  const amit = await e('E3', 'Amit', priya.id);
  const junior = await e('E4', 'Junior', amit.id); // two levels below Priya
  const other = await e('E5', 'Other', boss.id);
  const type = await db().leaveType.create({ data: { tenantId: t, name: 'Casual', code: 'CL', daysPerYear: 12 } });
  const owner_: TenantCtx = { kind: 'tenant', tenantId: t, userId: owner.id, memberId: om.id, roleId: await role('owner'), sessionId: randomUUID(), branchIds: [], scope: 'all' };
  const team: TenantCtx = { ...owner_, userId: lead.id, memberId: lm.id, roleId: await role('team_manager'), scope: 'team' };
  return { t, owner_, team, boss, priya, amit, junior, other, type, role };
}
const leave = (t: string, employeeId: string, leaveTypeId: string) => db().leaveApplication.create({ data: { tenantId: t, employeeId, leaveTypeId, fromDate: new Date('2026-12-10T00:00:00Z'), toDate: new Date('2026-12-10T00:00:00Z'), days: 1, reason: 'Work at home', status: 'pending' } });

describe('team managers and employee seats', () => {
  it('reaches the person and everyone under them, at any depth, and nobody else', async () => {
    await rolledBack(async () => {
      const { team, owner_, priya, amit, junior, other, boss } = await prepare();
      const reach = await hrReach(team);
      expect(new Set(reach)).toEqual(new Set([priya.id, amit.id, junior.id]));
      expect(reach).not.toContain(other.id);
      expect(reach).not.toContain(boss.id);
      expect(await hrReach(owner_)).toBeNull();
    });
  });

  it("decides their team's leave but not their own or an outsider's, and marks only their team", async () => {
    await rolledBack(async () => {
      const { t, team, priya, junior, other, type, boss } = await prepare();
      const mine = await leave(t, priya.id, type.id);
      const theirs = await leave(t, junior.id, type.id);
      const outside = await leave(t, other.id, type.id);
      await expect(time.decideLeave(team, mine.id, { status: 'approved' })).rejects.toThrow('your own leave');
      await expect(time.decideLeave(team, outside.id, { status: 'approved' })).rejects.toThrow('not found');
      const ok = await time.decideLeave(team, theirs.id, { status: 'approved' });
      expect(ok.status).toBe('approved');
      const list = await time.listLeaves(team, time.LeaveList.parse({}));
      expect(list.data.map((l) => l.employeeId).sort()).toEqual([priya.id, junior.id].sort());
      await expect(time.markAttendance(team, time.MarkInput.parse({ date: '2026-11-18', rows: [{ employeeId: boss.id, status: 'present' }] }))).rejects.toThrow('not in your team');
    });
  });

  it('lets self-service employee logins in when every paid seat is taken', async () => {
    await rolledBack(async () => {
      const { owner_, role } = await prepare();
      // 1 seat on the (mocked) plan, already taken: a paid role can't be invited, a self-service employee can
      await expect(invite(owner_, { email: 'cashier@example.test', roleId: await role('cashier'), branchIds: [] })).rejects.toThrow('allows 1 users');
      const r = await invite(owner_, { email: 'worker@example.test', roleId: await role('employee'), branchIds: [] });
      expect(r.id).toBeTruthy();
    });
  });
});
