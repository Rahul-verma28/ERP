import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { prisma, db, withPlatform } from '../kernel/db';
import type { TenantCtx } from '../kernel/context';
import { todayIST } from '../kernel/gst';
import * as tasks from '../modules/tasks/service';
import * as bk from '../modules/bookings/service';

class Rollback extends Error {}
async function rolledBack(fn: () => Promise<void>) {
  try {
    await withPlatform(async () => { await fn(); throw new Rollback(); }, { kind: 'platform' }, { timeoutMs: 120_000 });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
}
afterAll(() => prisma.$disconnect());

const DAY = 86_400_000;
const addDays = (s: string, n: number) => new Date(new Date(`${s}T00:00:00Z`).getTime() + n * DAY).toISOString().slice(0, 10);
/** Next Monday in India, so working hours (Mon–Sat 10–19) apply */
const nextMonday = () => { const t = todayIST(); const d = new Date(`${t}T00:00:00Z`).getUTCDay(); return addDays(t, ((8 - d) % 7) || 7); };
const at = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00+05:30`).toISOString();

async function prepare() {
  const n = String(Math.floor(Math.random() * 1e9)).padStart(9, '0');
  const owner = await db().user.create({ data: { name: 'Owner', email: `tb-${n}@example.test`, mobile: `+917${n}` } });
  const staff = await db().user.create({ data: { name: 'Staff', email: `tbs-${n}@example.test`, mobile: `+918${n}` } });
  const tenant = await db().tenant.create({ data: { name: `TB ${n}`, industryKey: 'general', templateVersion: 1, ownerUserId: owner.id, billingStateCode: '09' } });
  const roleId = (await prisma.role.findFirstOrThrow({ where: { key: 'owner', tenantId: null }, select: { id: true } })).id;
  const m = await db().tenantMember.create({ data: { tenantId: tenant.id, userId: owner.id, roleId, status: 'active' } });
  await db().tenantMember.create({ data: { tenantId: tenant.id, userId: staff.id, roleId, status: 'active' } });
  const ctx: TenantCtx = { kind: 'tenant', tenantId: tenant.id, userId: owner.id, memberId: m.id, roleId, sessionId: randomUUID(), branchIds: [], scope: 'all' };
  const staffCtx: TenantCtx = { ...ctx, userId: staff.id };
  return { ctx, staffCtx, owner, staff };
}

describe('tasks & projects', () => {
  it('makes the next one when a repeating task is done, and counts tabs', async () => {
    await rolledBack(async () => {
      const { ctx } = await prepare();
      const project = await tasks.createProject(ctx, tasks.ProjectInput.parse({ name: 'Diwali display', ownerId: ctx.userId }));
      const due = new Date(Date.now() - DAY).toISOString();
      const t = await tasks.createTask(ctx, tasks.TaskInput.parse({ title: 'Count the cash drawer', dueAt: due, repeat: 'daily', projectId: project.id, checklist: [{ text: 'Count notes' }, { text: 'Count coins' }] }));
      let list = await tasks.listTasks(ctx, tasks.TaskList.parse({}));
      expect(list.counts.overdue).toBe(1);
      expect(list.data[0].checklistTotal).toBe(2);

      await tasks.updateTask(ctx, t.id, { status: 'done', version: t.version });
      list = await tasks.listTasks(ctx, tasks.TaskList.parse({ status: 'all' }));
      expect(list.counts.done).toBe(1);
      expect(list.counts.open).toBe(1); // the next day's copy
      const next = list.data.find((x) => x.status === 'todo')!;
      expect(new Date(next.dueAt).getTime() - new Date(due).getTime()).toBe(DAY);
      expect((next.checklist as { done: boolean }[]).every((s) => !s.done)).toBe(true);

      await expect(tasks.createTask(ctx, tasks.TaskInput.parse({ title: 'Bad dates', startOn: addDays(todayIST(), 5), dueAt: new Date().toISOString() }))).rejects.toThrow("can't be before the start");
    });
  });

  it('keeps time to 24 hours a day and approvals to a named approver', async () => {
    await rolledBack(async () => {
      const { ctx, staffCtx, staff } = await prepare();
      const t = await tasks.createTask(ctx, tasks.TaskInput.parse({ title: 'Fix the shutter' }));
      await tasks.logTime(ctx, tasks.TimeInput.parse({ taskId: t.id, workDate: todayIST(), minutes: 1400 }));
      await expect(tasks.logTime(ctx, tasks.TimeInput.parse({ taskId: t.id, workDate: todayIST(), minutes: 60 }))).rejects.toThrow('24 hours');

      await expect(tasks.requestApproval(ctx, tasks.ApprovalInput.parse({ title: 'New printer', kind: 'purchase', amountPaise: 1_200_000, approverId: ctx.userId }))).rejects.toThrow('own request');
      const a = await tasks.requestApproval(ctx, tasks.ApprovalInput.parse({ title: 'New printer', kind: 'purchase', amountPaise: 1_200_000, approverId: staff.id }));
      expect(a.number).toBe('APR-0001');
      await expect(tasks.decideApproval(ctx, a.id, 'approved', null, a.version)).rejects.toThrow('approver');
      await expect(tasks.decideApproval(staffCtx, a.id, 'rejected', null, a.version)).rejects.toThrow('Say why');
      const done = await tasks.decideApproval(staffCtx, a.id, 'approved', 'Buy the HP one', a.version);
      expect(done.status).toBe('approved');
      const list = await tasks.listApprovals(ctx, { view: 'mine' });
      expect(list.counts.approved).toBe(1);
    });
  });
});

describe('calendar & bookings', () => {
  it('books inside hours, never twice, and offers only free slots', async () => {
    await rolledBack(async () => {
      const { ctx, staff } = await prepare();
      const item = await db().item.create({ data: { tenantId: ctx.tenantId, type: 'service', name: 'Haircut', pricePaise: 30_000n, gstRateBp: 1800 } });
      await bk.saveService(ctx, item.id, bk.ServiceInput.parse({ durationMin: 30, bufferMin: 10, staffIds: [staff.id], resourceKind: 'chair' }));
      const chair = await bk.saveResource(ctx, bk.ResourceInput.parse({ name: 'Chair 1', kind: 'chair' }));
      const mon = nextMonday();

      const a = await bk.createAppointment(ctx, bk.AppointmentInput.parse({ guestName: 'Ravi', itemId: item.id, staffId: staff.id, resourceId: chair.id, startAt: at(mon, '11:00') }));
      expect(a.pricePaise).toBe(30_000n);
      // The 10-minute gap after counts as busy
      await expect(bk.createAppointment(ctx, bk.AppointmentInput.parse({ guestName: 'Sita', itemId: item.id, staffId: staff.id, startAt: at(mon, '11:35') }))).rejects.toThrow('already booked');
      // Outside working hours needs a tick
      await expect(bk.createAppointment(ctx, bk.AppointmentInput.parse({ guestName: 'Late', itemId: item.id, staffId: staff.id, startAt: at(mon, '20:00') }))).rejects.toThrow('working hours');
      // Someone else who doesn't do this service
      await expect(bk.createAppointment(ctx, bk.AppointmentInput.parse({ guestName: 'Sita', itemId: item.id, staffId: ctx.userId, startAt: at(mon, '12:00') }))).rejects.toThrow('does not do');

      const free = await bk.freeSlots(ctx.tenantId, { date: mon, itemId: item.id }, { stepMin: 15 });
      const times = free.slots.map((s) => s.time);
      expect(times).toContain('10:00');
      expect(times).not.toContain('11:00');
      expect(times).not.toContain('11:30'); // 11:00 + 30 min + 10 min gap
      expect(times).toContain('11:45');

      // Time off removes the day
      await bk.addTimeOff(ctx, bk.TimeOffInput.parse({ userId: staff.id, fromDate: addDays(mon, 1), toDate: addDays(mon, 1) }));
      expect((await bk.freeSlots(ctx.tenantId, { date: addDays(mon, 1), itemId: item.id })).slots).toHaveLength(0);

      // The day's flow, then the list's counts
      await expect(bk.setStatus(ctx, a.id, 'complete')).rejects.toThrow('not started');
      await bk.setStatus(ctx, a.id, 'confirm');
      await expect(bk.setStatus(ctx, a.id, 'cancel')).rejects.toThrow('Say why');
      const list = await bk.listAppointments(ctx, bk.AppointmentList.parse({ view: 'upcoming' }));
      expect(list.counts.upcoming).toBe(1);
      expect(list.data[0].status).toBe('confirmed');
    });
  });

  it('takes an online booking into a free slot and links a known customer by mobile', async () => {
    await rolledBack(async () => {
      const { ctx, staff } = await prepare();
      const item = await db().item.create({ data: { tenantId: ctx.tenantId, type: 'service', name: 'Facial', pricePaise: 80_000n, gstRateBp: 1800, durationMin: 45 } });
      await bk.saveService(ctx, item.id, bk.ServiceInput.parse({ durationMin: 45, staffIds: [staff.id] }));
      const customer = await db().contact.create({ data: { tenantId: ctx.tenantId, type: 'customer', name: 'Meena', phone: '9876501234' } });
      const settings = await bk.saveSettings(ctx, bk.SettingsInput.parse({ enabled: true, slug: `tb-${Date.now()}`, title: 'Book with us', slotStepMin: 30, leadMin: 0, maxDaysAhead: 30, autoConfirm: true }));
      const page = await bk.publicPage(settings.slug);
      expect(page.services.map((s) => s.name)).toEqual(['Facial']);

      const mon = nextMonday();
      const slots = await bk.publicSlots(settings.slug, { date: mon, itemId: item.id });
      const first = slots.slots[0];
      expect(first.time).toBe('10:00');
      const done = await bk.publicBook(settings.slug, bk.PublicBookInput.parse({ itemId: item.id, startAt: first.startAt, name: 'Meena', phone: '9876501234' }));
      expect(done.status).toBe('confirmed');
      const appt = await db().appointment.findUniqueOrThrow({ where: { id: done.id } });
      expect(appt.contactId).toBe(customer.id);
      expect(appt.source).toBe('online');
      // The same slot is gone
      await expect(bk.publicBook(settings.slug, bk.PublicBookInput.parse({ itemId: item.id, startAt: first.startAt, name: 'Other', phone: '9876509999' }))).rejects.toThrow('just taken');
    });
  });
});
