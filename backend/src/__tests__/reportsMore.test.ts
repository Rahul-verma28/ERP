import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { prisma, db, withPlatform } from '../kernel/db';
import type { TenantCtx } from '../kernel/context';
import { todayIST } from '../kernel/gst';
import * as more from '../modules/reports/more';

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
  const owner = await db().user.create({ data: { name: 'Owner', email: `rm-${n}@example.test`, mobile: `+917${n}` } });
  const tenant = await db().tenant.create({ data: { name: `RM ${n}`, industryKey: 'general', templateVersion: 1, ownerUserId: owner.id, billingStateCode: '09' } });
  const roleId = (await prisma.role.findFirstOrThrow({ where: { key: 'owner', tenantId: null }, select: { id: true } })).id;
  const m = await db().tenantMember.create({ data: { tenantId: tenant.id, userId: owner.id, roleId, status: 'active' } });
  const ctx: TenantCtx = { kind: 'tenant', tenantId: tenant.id, userId: owner.id, memberId: m.id, roleId, sessionId: randomUUID(), branchIds: [], scope: 'all' };
  return { ctx, tenantId: tenant.id };
}
const month = todayIST().slice(0, 7);
const p = { from: `${month}-01`, to: todayIST() };

describe('more reports', () => {
  it('adds up bookings by service and source, counting only completed visits as earned', async () => {
    await rolledBack(async () => {
      const { ctx, tenantId } = await prepare();
      const item = await db().item.create({ data: { tenantId, type: 'service', name: 'Fan fitting', pricePaise: 25_000n, gstRateBp: 1800 } });
      const at = (h: number) => new Date(`${p.from}T${String(h).padStart(2, '0')}:00:00+05:30`);
      const base = { tenantId, kind: 'appointment', title: 'Fan fitting', itemId: item.id, staffId: ctx.userId, pricePaise: 25_000n, createdBy: ctx.userId };
      await db().appointment.createMany({ data: [
        { ...base, startAt: at(10), endAt: at(11), status: 'completed', source: 'phone' },
        { ...base, startAt: at(12), endAt: at(13), status: 'completed', source: 'online' },
        { ...base, startAt: at(14), endAt: at(15), status: 'no_show', source: 'phone' },
        { ...base, startAt: at(16), endAt: at(17), status: 'cancelled', source: 'phone' },
      ] });
      const bySvc = await more.bookingReport(ctx, { ...p, by: 'service' });
      expect(bySvc.data).toHaveLength(1);
      expect(bySvc.data[0]).toMatchObject({ label: 'Fan fitting', total: 4, completed: 2, noShow: 1, cancelled: 1, earnedPaise: 50_000 });
      expect(bySvc.sums.noShowPct).toBeCloseTo(33.3, 1);
      const bySrc = await more.bookingReport(ctx, { ...p, by: 'source' });
      expect(bySrc.data.find((r) => r.id === 'online')?.earnedPaise).toBe(25_000);
    });
  });

  it('values billable time at the project rate and shows tasks per person', async () => {
    await rolledBack(async () => {
      const { ctx, tenantId } = await prepare();
      const project = await db().taskProject.create({ data: { tenantId, name: 'Café supply', billable: true, hourlyRatePaise: 60_000n, createdBy: ctx.userId } });
      await db().taskTime.createMany({ data: [
        { tenantId, userId: ctx.userId, projectId: project.id, workDate: new Date(`${p.from}T00:00:00Z`), minutes: 90, billable: true },
        { tenantId, userId: ctx.userId, projectId: project.id, workDate: new Date(`${p.from}T00:00:00Z`), minutes: 30, billable: false },
      ] });
      await db().task.create({ data: { tenantId, title: 'Late one', status: 'todo', assigneeId: ctx.userId, dueAt: new Date(Date.now() - 86_400_000), createdBy: ctx.userId } });
      const byProject = await more.timeReport(ctx, { ...p, by: 'project' });
      expect(byProject.data[0]).toMatchObject({ label: 'Café supply', minutes: 120, billableMinutes: 90, valuePaise: 90_000, billablePct: 75 });
      const byPerson = await more.timeReport(ctx, { ...p, by: 'person' });
      expect(byPerson.data[0]).toMatchObject({ minutes: 120, open: 1, overdue: 1 });
    });
  });

  it('counts attendance and half days into the attendance %', async () => {
    await rolledBack(async () => {
      const { ctx, tenantId } = await prepare();
      const e = await db().employee.create({ data: { tenantId, code: 'EMP-1', name: 'Ravi', joinedOn: new Date('2026-01-01T00:00:00Z') } });
      const d = (n: number) => new Date(`${month}-${String(n).padStart(2, '0')}T00:00:00Z`);
      await db().attendance.createMany({ data: [
        { tenantId, employeeId: e.id, date: d(1), status: 'present', lateMinutes: 10 },
        { tenantId, employeeId: e.id, date: d(2), status: 'half_day' },
        { tenantId, employeeId: e.id, date: d(3), status: 'absent' },
        { tenantId, employeeId: e.id, date: d(4), status: 'leave' },
      ] });
      const r = await more.attendanceSummary(ctx, month);
      expect(r.data[0]).toMatchObject({ present: 1, halfDay: 1, absent: 1, leave: 1, lateDays: 1, attendancePct: 37.5 });
    });
  });
});
