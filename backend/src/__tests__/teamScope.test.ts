import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { prisma, db, withPlatform } from '../kernel/db';
import type { TenantCtx } from '../kernel/context';
import { inScope, loadTeamUsers, scopeUsers, scopeWhere } from '../kernel/query';
import * as tasks from '../modules/tasks/service';

// "team" means the same thing in every module: the person plus everyone reporting to them in HR.

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
  const user = (name: string, p: string) => db().user.create({ data: { name, email: `ts${p}-${n}@example.test`, mobile: `+91${p}${n}` } });
  const [owner, lead, amit, junior, other] = await Promise.all([user('Owner', '6'), user('Priya', '7'), user('Amit', '8'), user('Junior', '9'), user('Other', '5')]);
  const tenant = await db().tenant.create({ data: { name: `TS ${n}`, industryKey: 'general', templateVersion: 1, ownerUserId: owner.id, billingStateCode: '09' } });
  const t = tenant.id;
  const role = async (key: string) => (await prisma.role.findFirstOrThrow({ where: { key, tenantId: null }, select: { id: true } })).id;
  const member = async (userId: string, key: string) => db().tenantMember.create({ data: { tenantId: t, userId, roleId: await role(key), status: 'active' } });
  const [om, lm, am, jm, xm] = [await member(owner.id, 'owner'), await member(lead.id, 'team_manager'), await member(amit.id, 'employee'), await member(junior.id, 'employee'), await member(other.id, 'employee')];
  const e = (code: string, name: string, managerId: string | null, memberId: string) => db().employee.create({ data: { tenantId: t, code, name, joinedOn: new Date('2025-01-01T00:00:00Z'), managerId, memberId } });
  const boss = await e('E1', 'Owner', null, om.id);
  const priya = await e('E2', 'Priya', boss.id, lm.id);
  const a = await e('E3', 'Amit', priya.id, am.id);
  await e('E4', 'Junior', a.id, jm.id); // two levels below Priya
  await e('E5', 'Other', boss.id, xm.id);
  const base: TenantCtx = { kind: 'tenant', tenantId: t, userId: lead.id, memberId: lm.id, roleId: await role('team_manager'), sessionId: randomUUID(), branchIds: [] };
  const task = (title: string, by: string, to: string | null) => db().task.create({ data: { tenantId: t, title, createdBy: by, assigneeId: to } });
  return { t, base, owner, lead, amit, junior, other, task };
}

describe('team scope across modules', () => {
  it('works out the team: the person and everyone under them, at any depth', async () => {
    await rolledBack(async () => {
      const { t, base, lead, amit, junior } = await prepare();
      expect(new Set(await loadTeamUsers(t, base.memberId, base.userId))).toEqual(new Set([lead.id, amit.id, junior.id]));
    });
  });

  it('own, team, branch and all mean the same in every Prisma and SQL check', () => {
    const ctx: TenantCtx = { kind: 'tenant', tenantId: 't', userId: 'me', memberId: 'm', roleId: 'r', sessionId: 's', branchIds: [], teamUserIds: ['me', 'a'] };
    expect(scopeUsers({ ...ctx, scope: 'own' })).toEqual(['me']);
    expect(scopeUsers({ ...ctx, scope: 'team' })).toEqual(['me', 'a']);
    expect(scopeUsers({ ...ctx, scope: 'all' })).toBeNull();
    expect(scopeWhere({ ...ctx, scope: 'team' }, { owner: ['createdBy'] })).toEqual({ OR: [{ createdBy: { in: ['me', 'a'] } }] });
    expect(inScope({ ...ctx, scope: 'team' }, { createdBy: 'a' })).toBe(true);
    expect(inScope({ ...ctx, scope: 'team' }, { createdBy: 'x' })).toBe(false);
    expect(inScope({ ...ctx, scope: 'own' }, { createdBy: 'a' })).toBe(false);
    // A team scope whose team isn't loaded falls back to just the person
    expect(scopeUsers({ ...ctx, teamUserIds: undefined, scope: 'team' })).toEqual(['me']);
  });

  it("a team manager sees their team's tasks and nobody else's", async () => {
    await rolledBack(async () => {
      const { t, base, owner, lead, amit, junior, other, task } = await prepare();
      const mine = await task('Priya own', lead.id, lead.id);
      const amits = await task('For Amit', owner.id, amit.id);
      const juniors = await task('Junior made', junior.id, null);
      const outside = await task('Other only', other.id, other.id);
      const team: TenantCtx = { ...base, scope: 'team', teamUserIds: await loadTeamUsers(t, base.memberId, base.userId) };
      const list = await tasks.listTasks(team, tasks.TaskList.parse({ status: 'all' }));
      expect(new Set(list.data.map((x) => x.id))).toEqual(new Set([mine.id, amits.id, juniors.id]));
      await expect(tasks.getTask(team, outside.id)).rejects.toThrow('not found');
      expect((await tasks.getTask(team, juniors.id)).id).toBe(juniors.id);
      // The same person with "own" sees only their own
      const own = await tasks.listTasks({ ...base, scope: 'own' }, tasks.TaskList.parse({ status: 'all' }));
      expect(own.data.map((x) => x.id)).toEqual([mine.id]);
    });
  });
});
