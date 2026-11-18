import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { Prisma, type Appointment } from '@prisma/client';
import { db } from '../../kernel/db';
import { bundle, userNames, userPart, type Row } from '../../kernel/bundle';
import { AppError, notFound } from '../../kernel/errors';
import type { TenantCtx } from '../../kernel/context';
import { DateStr, Paise, assertVersion, inScope } from '../../kernel/query';
import { todayIST } from '../../kernel/gst';
import { zPhone } from '../../kernel/zodRules';
import { notify } from '../notifications/service';
import { audit } from '../audit/service';
import { createDocument } from '../billing/service';

// Calendar & Bookings: appointments with customer, service, staff and room; services with length,
// gap and who can do them; rooms, chairs and machines; staff working hours and time off; free slots;
// and an online booking page. Lists come in one round trip each (kernel/bundle).

const DAY = 86_400_000;
const IST = 330 * 60_000;
const SCOPE = { owner: ['createdBy', 'staffId'], branch: 'branchId' };
/** Hours used when a person has none set: Monday to Saturday, 10:00 to 19:00 */
const DEFAULT_HOURS = [1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startMin: 600, endMin: 1140 }));
const big = (v: unknown) => (typeof v === 'bigint' ? v : BigInt(Math.round(Number(v ?? 0))));
const istDay = (d: Date) => new Date(d.getTime() + IST).toISOString().slice(0, 10);
const istMinutes = (d: Date) => { const x = new Date(d.getTime() + IST); return x.getUTCHours() * 60 + x.getUTCMinutes(); };
/** The moment of a time on an India date */
const atIst = (date: string, minutes: number) => new Date(new Date(`${date}T00:00:00.000Z`).getTime() + minutes * 60_000 - IST);
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const LIVE = ['scheduled', 'confirmed', 'completed'];

// ---------------------------------------------------------------- appointments

export const AppointmentInput = z.object({
  kind: z.enum(['appointment', 'event']).default('appointment'),
  title: z.string().trim().max(200).optional(),
  contactId: z.string().uuid().optional().nullable(),
  guestName: z.string().trim().max(120).optional().nullable(),
  guestPhone: zPhone.optional().nullable().or(z.literal('').transform(() => null)),
  itemId: z.string().uuid().optional().nullable(),
  staffId: z.string().uuid().optional().nullable(),
  resourceId: z.string().uuid().optional().nullable(),
  startAt: z.string().datetime({ offset: true }),
  endAt: z.string().datetime({ offset: true }).optional(),
  status: z.enum(['scheduled', 'confirmed', 'completed', 'cancelled', 'no_show']).optional(),
  source: z.enum(['walk_in', 'phone', 'whatsapp', 'online']).optional(),
  pricePaise: Paise.optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
  branchId: z.string().uuid().optional().nullable(),
  /** Book even outside the person's working hours */
  outsideHours: z.boolean().optional(),
});
export type AppointmentInput = z.infer<typeof AppointmentInput>;

export const AppointmentList = z.object({
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  view: z.enum(['upcoming', 'today', 'unconfirmed', 'completed', 'uninvoiced', 'cancelled', 'no_show', 'events', 'all']).optional(),
  staffId: z.string().uuid().optional(),
  itemId: z.string().uuid().optional(),
  resourceId: z.string().uuid().optional(),
  contactId: z.string().uuid().optional(),
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(50),
  cursor: z.string().uuid().optional(),
});

const scopeSql = (ctx: TenantCtx) => {
  const scope = ctx.scope ?? 'own';
  if (scope === 'all') return Prisma.empty;
  if (scope === 'branch') return ctx.branchIds.length ? Prisma.sql`and (a.branch_id in (${Prisma.join(ctx.branchIds.map((b) => Prisma.sql`${b}::uuid`))}) or a.branch_id is null)` : Prisma.empty;
  return Prisma.sql`and (a.created_by = ${ctx.userId}::uuid or a.staff_id = ${ctx.userId}::uuid)`;
};

/** Appointments with their customer, service, staff and room, and the counts and totals for the
 *  tabs and cards. With from/to only that window is read (the calendar); otherwise the last 120 days
 *  and everything ahead (the list). */
export async function listAppointments(ctx: TenantCtx, q: z.infer<typeof AppointmentList>) {
  const t = ctx.tenantId;
  const from = q.from ? new Date(q.from) : new Date(Date.now() - 120 * DAY);
  const to = q.to ? new Date(q.to) : new Date(Date.now() + 365 * DAY);
  if (q.from && q.to && to.getTime() - from.getTime() > 62 * DAY) throw new AppError('VALIDATION_FAILED', 'Choose a range of at most two months.');
  const b = await bundle({
    rows: Prisma.sql`
      select a.*, a.kind::text as kind, a.status::text as status,
        c.name as contact_name, c.company_name as contact_company, c.phone as contact_phone, c.type as contact_type,
        i.name as item_name, i.price_paise as item_price_paise, r.name as resource_name, r.kind as resource_kind,
        s.color as service_color, d.number as invoice_number, d.status::text as invoice_status
      from appointments a
      left join contacts c on c.id = a.contact_id
      left join items i on i.id = a.item_id
      left join booking_resources r on r.id = a.resource_id
      left join booking_services s on s.item_id = a.item_id and s.tenant_id = a.tenant_id
      left join sales_documents d on d.id = a.invoice_id
      where a.tenant_id = ${t}::uuid ${scopeSql(ctx)} and a.start_at < ${to} and a.end_at > ${from}
      order by a.start_at limit 5000`,
    ...userPart(t),
  });
  const user = userNames(b);
  const now = new Date();
  const today = todayIST();
  type A = Row & { id: string; kind: string; status: string; startAt: Date; endAt: Date; staffId: string | null; amountPaise: bigint; day: string };
  const all: A[] = b.rows.map((a) => {
    const price = a.pricePaise != null ? big(a.pricePaise) : a.itemPricePaise != null ? big(a.itemPricePaise) : 0n;
    return {
      ...a, id: a.id as string, kind: a.kind as string, status: a.status as string, startAt: a.startAt as Date, endAt: a.endAt as Date, staffId: a.staffId ?? null,
      day: istDay(a.startAt), durationMin: Math.round(((a.endAt as Date).getTime() - (a.startAt as Date).getTime()) / 60_000),
      contact: a.contactId ? { id: a.contactId, name: a.contactCompany || a.contactName, phone: a.contactPhone ?? null, type: a.contactType } : null,
      customerName: a.contactId ? (a.contactCompany || a.contactName) : (a.guestName ?? null),
      customerPhone: a.contactId ? (a.contactPhone ?? null) : (a.guestPhone ?? null),
      item: a.itemId ? { id: a.itemId, name: a.itemName, pricePaise: a.itemPricePaise == null ? null : big(a.itemPricePaise) } : null,
      staff: a.staffId ? { id: a.staffId, name: user.get(a.staffId) ?? '' } : null,
      resource: a.resourceId ? { id: a.resourceId, name: a.resourceName, kind: a.resourceKind } : null,
      invoice: a.invoiceId ? { id: a.invoiceId, number: a.invoiceNumber, status: a.invoiceStatus } : null,
      color: a.serviceColor ?? (a.kind === 'event' ? 'violet' : 'blue'),
      amountPaise: price,
      createdByName: a.createdBy ? user.get(a.createdBy) ?? null : null,
    };
  });
  const s = q.q?.toLowerCase();
  const base = all.filter((a) =>
    (!q.staffId || a.staffId === q.staffId) && (!q.itemId || a.itemId === q.itemId) && (!q.resourceId || a.resourceId === q.resourceId) && (!q.contactId || a.contactId === q.contactId)
    && (!s || [a.title, a.customerName, a.customerPhone, a.item?.name, a.staff?.name, a.notes].some((v) => typeof v === 'string' && v.toLowerCase().includes(s))));
  const appts = base.filter((a) => a.kind === 'appointment');
  const upcoming = (a: A) => a.startAt >= now && (a.status === 'scheduled' || a.status === 'confirmed');
  const uninvoiced = (a: A) => a.status === 'completed' && !a.invoiceId && !!a.itemId;
  const counts = {
    upcoming: appts.filter(upcoming).length, today: appts.filter((a) => a.day === today && a.status !== 'cancelled').length,
    unconfirmed: appts.filter((a) => a.status === 'scheduled' && a.startAt >= now).length, completed: appts.filter((a) => a.status === 'completed').length,
    uninvoiced: appts.filter(uninvoiced).length, cancelled: appts.filter((a) => a.status === 'cancelled').length, no_show: appts.filter((a) => a.status === 'no_show').length,
    events: base.filter((a) => a.kind === 'event').length, all: base.length,
  };
  const month = today.slice(0, 7);
  const thisMonth = appts.filter((a) => a.day.slice(0, 7) === month);
  const closed = thisMonth.filter((a) => a.startAt < now && a.status !== 'cancelled');
  const sums = {
    todayRemaining: appts.filter((a) => a.day === today && a.endAt >= now && LIVE.includes(a.status)).length,
    monthBooked: thisMonth.filter((a) => a.status !== 'cancelled').length,
    monthRevenuePaise: thisMonth.filter((a) => a.status === 'completed').reduce((x, a) => x + a.amountPaise, 0n),
    upcomingValuePaise: appts.filter(upcoming).reduce((x, a) => x + a.amountPaise, 0n),
    uninvoicedPaise: appts.filter(uninvoiced).reduce((x, a) => x + a.amountPaise, 0n),
    noShowPct: closed.length ? Math.round((closed.filter((a) => a.status === 'no_show').length / closed.length) * 100) : 0,
    online: thisMonth.filter((a) => a.source === 'online').length,
  };
  const pick = (a: A) => {
    switch (q.view) {
      case 'upcoming': return a.kind === 'appointment' && upcoming(a);
      case 'today': return a.kind === 'appointment' && a.day === today && a.status !== 'cancelled';
      case 'unconfirmed': return a.kind === 'appointment' && a.status === 'scheduled' && a.startAt >= now;
      case 'completed': return a.kind === 'appointment' && a.status === 'completed';
      case 'uninvoiced': return a.kind === 'appointment' && uninvoiced(a);
      case 'cancelled': return a.kind === 'appointment' && a.status === 'cancelled';
      case 'no_show': return a.kind === 'appointment' && a.status === 'no_show';
      case 'events': return a.kind === 'event';
      default: return true;
    }
  };
  const rows = base.filter(pick);
  // Past lists newest first; what is ahead, soonest first
  if (['completed', 'uninvoiced', 'cancelled', 'no_show'].includes(q.view ?? '')) rows.reverse();
  const start = q.cursor ? rows.findIndex((r) => r.id === q.cursor) + 1 : 0;
  const data = rows.slice(start, start + q.limit);
  return { data, nextCursor: start + q.limit < rows.length ? data[data.length - 1]?.id ?? null : null, total: rows.length, counts, sums };
}

async function resolve(ctx: Pick<TenantCtx, 'tenantId'>, input: Partial<AppointmentInput>, existing?: Appointment) {
  const [contact, item, service] = await Promise.all([
    input.contactId ? db().contact.findFirst({ where: { id: input.contactId, tenantId: ctx.tenantId }, select: { id: true, name: true, companyName: true } }) : null,
    input.itemId ? db().item.findFirst({ where: { id: input.itemId, tenantId: ctx.tenantId }, select: { id: true, name: true, durationMin: true, pricePaise: true, type: true } }) : null,
    input.itemId ? db().bookingService.findFirst({ where: { itemId: input.itemId, tenantId: ctx.tenantId } }) : null,
  ]);
  if (input.contactId && !contact) throw new AppError('VALIDATION_FAILED', 'Choose a customer from the list.', { fields: { contactId: 'Unknown' } });
  if (input.itemId && !item) throw new AppError('VALIDATION_FAILED', 'Choose a service from the list.', { fields: { itemId: 'Unknown' } });
  if (input.staffId && !(await db().tenantMember.findFirst({ where: { userId: input.staffId, status: 'active' } }))) throw new AppError('VALIDATION_FAILED', 'Choose an active staff member.', { fields: { staffId: 'Not an active user' } });
  if (service && input.staffId && service.staffIds.length && !service.staffIds.includes(input.staffId)) throw new AppError('VALIDATION_FAILED', `This person does not do ${item!.name}. Choose someone who does.`, { fields: { staffId: 'Does not do this service' } });
  if (input.resourceId) {
    const r = await db().bookingResource.findFirst({ where: { id: input.resourceId, tenantId: ctx.tenantId } });
    if (!r || !r.isActive) throw new AppError('VALIDATION_FAILED', 'Choose an available room or resource.', { fields: { resourceId: 'Unknown or closed' } });
  }
  const startAt = input.startAt ? new Date(input.startAt) : existing!.startAt;
  const minutes = service?.durationMin ?? item?.durationMin ?? 30;
  const endAt = input.endAt ? new Date(input.endAt) : input.startAt || input.itemId ? new Date(startAt.getTime() + minutes * 60_000) : existing!.endAt;
  if (endAt <= startAt) throw new AppError('VALIDATION_FAILED', 'End time must be after the start.', { fields: { endAt: 'Must be after start' } });
  if (endAt.getTime() - startAt.getTime() > 16 * 3_600_000) throw new AppError('VALIDATION_FAILED', 'An appointment can be at most 16 hours long.', { fields: { endAt: 'Too long' } });
  const who = contact ? contact.companyName || contact.name : input.guestName ?? null;
  const title = input.title || [item?.name, who].filter(Boolean).join(' · ') || undefined;
  return { startAt, endAt, title, item, service, bufferMin: service?.bufferMin ?? 0 };
}

/** Friendly checks before the database constraints: the person is free, at work and not on leave,
 *  and the room is free (the gap after the service counts as busy) */
async function assertFree(ctx: Pick<TenantCtx, 'tenantId'>, a: { staffId?: string | null; resourceId?: string | null; startAt: Date; endAt: Date; bufferMin: number; outsideHours?: boolean }, excludeId?: string) {
  const until = new Date(a.endAt.getTime() + a.bufferMin * 60_000);
  // Another booking is busy until its end plus its own service's gap, so look a little further back
  const clashWith = async (col: 'staff_id' | 'resource_id', id: string) => {
    const rows = await db().$queryRaw<{ title: string; start_at: Date; end_at: Date }[]>(Prisma.sql`
      select a.title, a.start_at, a.end_at from appointments a left join booking_services s on s.item_id = a.item_id and s.tenant_id = a.tenant_id
      where a.tenant_id = ${ctx.tenantId}::uuid and ${Prisma.raw(`a.${col}`)} = ${id}::uuid and a.status not in ('cancelled', 'no_show')
        ${excludeId ? Prisma.sql`and a.id <> ${excludeId}::uuid` : Prisma.empty}
        and a.start_at < ${until} and a.end_at + make_interval(mins => coalesce(s.buffer_min, 0)) > ${a.startAt}
      order by a.start_at limit 1`);
    return rows[0] ? { title: rows[0].title, startAt: new Date(rows[0].start_at), endAt: new Date(rows[0].end_at) } : null;
  };
  if (a.staffId) {
    const clash = await clashWith('staff_id', a.staffId);
    if (clash) throw new AppError('CONFLICT', `This person is already booked ${hhmm(istMinutes(clash.startAt))}–${hhmm(istMinutes(clash.endAt))} (${clash.title}).`, { fields: { staffId: 'Already booked' }, clash });
    const off = await db().staffTimeOff.findFirst({ where: { tenantId: ctx.tenantId, userId: a.staffId, fromAt: { lt: a.endAt }, toAt: { gt: a.startAt } } });
    if (off) throw new AppError('CONFLICT', `This person is off then${off.reason ? ` (${off.reason})` : ''}.`, { fields: { staffId: 'On time off' } });
    if (!a.outsideHours) {
      const hours = await db().staffHours.findMany({ where: { tenantId: ctx.tenantId, userId: a.staffId } });
      const list = hours.length ? hours : DEFAULT_HOURS;
      const day = istDay(a.startAt);
      const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
      const s = istMinutes(a.startAt);
      const e = istDay(a.endAt) === day ? istMinutes(a.endAt) : 1440;
      if (!list.some((h) => h.weekday === weekday && h.startMin <= s && h.endMin >= e)) {
        throw new AppError('VALIDATION_FAILED', 'This is outside the person\'s working hours. Choose another time, or tick "Book outside working hours".', { fields: { startAt: 'Outside working hours' }, outsideHours: true });
      }
    }
  }
  if (a.resourceId) {
    const clash = await clashWith('resource_id', a.resourceId);
    if (clash) throw new AppError('CONFLICT', `This room or resource is already in use then (${clash.title}).`, { fields: { resourceId: 'Already in use' } });
  }
}

const conflict = (e: unknown) => {
  const msg = e instanceof Error ? e.message : String(e);
  if (msg.includes('appointments_no_double_booking')) throw new AppError('CONFLICT', 'This person is already booked at that time.', { fields: { staffId: 'Already booked' } });
  if (msg.includes('appointments_no_double_resource')) throw new AppError('CONFLICT', 'This room or resource is already in use at that time.', { fields: { resourceId: 'Already in use' } });
  throw e;
};

export async function createAppointment(ctx: TenantCtx, b: AppointmentInput) {
  const r = await resolve(ctx, b);
  if (!r.title) throw new AppError('VALIDATION_FAILED', 'Add a title, or choose a customer or service.', { fields: { title: 'Required' } });
  if (b.kind === 'appointment' && !b.contactId && !b.guestName) throw new AppError('VALIDATION_FAILED', 'Choose the customer, or type the name of a new one.', { fields: { contactId: 'Required' } });
  const staffId = b.staffId === undefined ? (b.kind === 'event' ? ctx.userId : null) : b.staffId;
  if (b.startAt && new Date(b.startAt).getTime() < Date.now() - 30 * DAY) throw new AppError('VALIDATION_FAILED', 'An appointment can be entered at most 30 days back.', { fields: { startAt: 'Too far back' } });
  await assertFree(ctx, { staffId, resourceId: b.resourceId, startAt: r.startAt, endAt: r.endAt, bufferMin: r.bufferMin, outsideHours: b.outsideHours || b.kind === 'event' });
  try {
    const status = b.status ?? 'scheduled';
    const a = await db().appointment.create({
      data: {
        kind: b.kind, title: r.title, contactId: b.contactId ?? null, guestName: b.contactId ? null : b.guestName ?? null, guestPhone: b.contactId ? null : b.guestPhone ?? null,
        itemId: b.itemId ?? null, staffId, resourceId: b.resourceId ?? null, startAt: r.startAt, endAt: r.endAt, status, source: b.source ?? 'walk_in',
        pricePaise: b.pricePaise != null ? BigInt(b.pricePaise) : r.item ? r.item.pricePaise : null, confirmedAt: status === 'confirmed' ? new Date() : null,
        notes: b.notes ?? null, tenantId: ctx.tenantId, createdBy: ctx.userId, branchId: b.branchId ?? ctx.branchIds[0] ?? null,
      },
    });
    if (staffId && staffId !== ctx.userId) await notify(staffId, `New ${b.kind}: ${r.title}`, `${istDay(r.startAt)} ${hhmm(istMinutes(r.startAt))}`, '/app/m/bookings');
    return a;
  } catch (e) { return conflict(e); }
}

export async function updateAppointment(ctx: TenantCtx, id: string, b: Partial<AppointmentInput> & { version?: number }) {
  const a = await db().appointment.findUnique({ where: { id } });
  if (!a || !inScope(ctx, a, SCOPE)) throw notFound('Appointment');
  assertVersion(a.version, b.version, 'appointment');
  if (a.invoiceId && (b.itemId !== undefined || b.pricePaise !== undefined)) throw new AppError('CONFLICT', 'This appointment is invoiced; its service and price stay as billed.');
  const { version: _v, kind: _k, outsideHours, ...rest } = b;
  const r = await resolve(ctx, { ...rest, itemId: b.itemId === undefined ? a.itemId : b.itemId }, a);
  const staffId = b.staffId === undefined ? a.staffId : b.staffId;
  const resourceId = b.resourceId === undefined ? a.resourceId : b.resourceId;
  const status = b.status ?? a.status;
  const moved = r.startAt.getTime() !== a.startAt.getTime() || r.endAt.getTime() !== a.endAt.getTime() || staffId !== a.staffId || resourceId !== a.resourceId;
  if (moved && !['cancelled', 'no_show'].includes(status)) await assertFree(ctx, { staffId, resourceId, startAt: r.startAt, endAt: r.endAt, bufferMin: r.bufferMin, outsideHours: outsideHours || a.kind === 'event' }, a.id);
  try {
    const updated = await db().appointment.update({
      where: { id: a.id },
      data: {
        ...rest, pricePaise: b.pricePaise === undefined ? undefined : b.pricePaise == null ? null : BigInt(b.pricePaise),
        title: b.title || (b.contactId || b.itemId ? r.title : undefined), staffId, resourceId, startAt: r.startAt, endAt: r.endAt,
        confirmedAt: moved ? null : undefined, remindedAt: moved ? null : undefined, status: moved && a.status === 'confirmed' ? 'scheduled' : b.status, version: { increment: 1 },
      },
    });
    if (moved && staffId && staffId !== ctx.userId) await notify(staffId, `Moved: ${updated.title}`, `${istDay(r.startAt)} ${hhmm(istMinutes(r.startAt))}`, '/app/m/bookings');
    return updated;
  } catch (e) { return conflict(e); }
}

/** The day's flow: confirm, check in, complete, no-show, cancel (with a reason), or back to booked */
export async function setStatus(ctx: TenantCtx, id: string, action: 'confirm' | 'check_in' | 'complete' | 'no_show' | 'cancel' | 'reopen', reason?: string | null) {
  const a = await db().appointment.findUnique({ where: { id } });
  if (!a || !inScope(ctx, a, SCOPE)) throw notFound('Appointment');
  const closed = ['completed', 'cancelled', 'no_show'].includes(a.status);
  if (action !== 'reopen' && closed) throw new AppError('CONFLICT', `This appointment is already ${a.status.replace('_', '-')}.`);
  if (action === 'reopen' && (!closed || a.invoiceId)) throw new AppError('CONFLICT', a.invoiceId ? 'This appointment is invoiced.' : 'This appointment is still open.');
  if ((action === 'complete' || action === 'no_show' || action === 'check_in') && a.startAt.getTime() > Date.now() + 15 * 60_000) throw new AppError('CONFLICT', 'This appointment has not started yet.');
  if (action === 'cancel' && !reason?.trim()) throw new AppError('VALIDATION_FAILED', 'Say why it is cancelled.', { fields: { reason: 'Required' } });
  const data: Prisma.AppointmentUpdateInput =
    action === 'confirm' ? { status: 'confirmed', confirmedAt: new Date() }
    : action === 'check_in' ? { status: 'confirmed', checkedInAt: new Date(), confirmedAt: a.confirmedAt ?? new Date() }
    : action === 'complete' ? { status: 'completed', checkedInAt: a.checkedInAt ?? a.startAt }
    : action === 'no_show' ? { status: 'no_show' }
    : action === 'cancel' ? { status: 'cancelled', cancelReason: reason!.trim() }
    : { status: 'scheduled', cancelReason: null };
  if (action === 'reopen') await assertFree(ctx, { staffId: a.staffId, resourceId: a.resourceId, startAt: a.startAt, endAt: a.endAt, bufferMin: 0, outsideHours: true }, a.id);
  try {
    const updated = await db().appointment.update({ where: { id }, data: { ...data, version: { increment: 1 } } });
    await audit({ action: `bookings.appointment.${action}`, entity: 'appointment', entityId: id, after: { title: a.title, reason } });
    return updated;
  } catch (e) { return conflict(e); }
}

export async function markReminded(ctx: TenantCtx, id: string) {
  const a = await db().appointment.findUnique({ where: { id } });
  if (!a || !inScope(ctx, a, SCOPE)) throw notFound('Appointment');
  return db().appointment.update({ where: { id }, data: { remindedAt: new Date(), version: { increment: 1 } } });
}

export async function deleteAppointment(ctx: TenantCtx, id: string) {
  const a = await db().appointment.findUnique({ where: { id } });
  if (!a || !inScope(ctx, a, SCOPE)) throw notFound('Appointment');
  if (a.invoiceId) throw new AppError('CONFLICT', 'This appointment has an invoice. Cancel it instead.');
  if (a.kind === 'appointment' && a.status === 'completed') throw new AppError('CONFLICT', 'A completed appointment stays on record.');
  await db().appointment.delete({ where: { id: a.id } });
}

/** BKG-08: completed appointment → draft invoice in one click, at the price agreed */
export async function invoiceAppointment(ctx: TenantCtx, id: string) {
  const a = await db().appointment.findUnique({ where: { id } });
  if (!a || !inScope(ctx, a, SCOPE)) throw notFound('Appointment');
  if (a.invoiceId) throw new AppError('CONFLICT', 'An invoice already exists for this appointment.', { invoiceId: a.invoiceId });
  if (!a.itemId) throw new AppError('VALIDATION_FAILED', 'Choose the service on the appointment first.');
  if (!a.contactId && !a.guestName) throw new AppError('VALIDATION_FAILED', 'The appointment needs a customer to invoice.');
  const item = await db().item.findUniqueOrThrow({ where: { id: a.itemId } });
  const invoice = await createDocument(
    ctx, 'invoice',
    {
      ...(a.contactId ? { contactId: a.contactId } : { buyer: { name: a.guestName!, phone: a.guestPhone ?? undefined } }),
      branchId: a.branchId, notes: `For the appointment on ${istDay(a.startAt)} at ${hhmm(istMinutes(a.startAt))}.`,
      lines: [{ itemId: item.id, quantity: 1, unitPricePaise: Number(a.pricePaise ?? item.pricePaise), discountPaise: 0, gstRateBp: item.gstRateBp }],
    },
    { sourceType: 'appointment', sourceId: a.id },
  );
  await db().appointment.update({ where: { id: a.id }, data: { invoiceId: invoice.id, status: 'completed', version: { increment: 1 } } });
  return invoice;
}

// ---------------------------------------------------------------- services

export const ServiceInput = z.object({
  durationMin: z.number().int().min(5, 'At least 5 minutes').max(960, 'At most 16 hours'),
  bufferMin: z.number().int().min(0).max(240).default(0),
  color: z.string().max(12).default('blue'),
  staffIds: z.array(z.string().uuid()).max(100).default([]),
  resourceKind: z.enum(['room', 'chair', 'equipment']).optional().nullable(),
  online: z.boolean().default(true),
  isActive: z.boolean().default(true),
  notes: z.string().trim().max(1000).optional().nullable(),
  /** Changes the item's own price too */
  pricePaise: Paise.optional(),
});

/** Every service item with how it is booked (defaults where not set yet) and how busy it is */
export async function listServices(ctx: TenantCtx) {
  const t = ctx.tenantId;
  const b = await bundle({
    rows: Prisma.sql`
      select i.id as item_id, i.name, i.sku, i.price_paise, i.gst_rate_bp, i.duration_min as item_duration_min, i.is_active as item_active, c.name as category,
        s.id, s.duration_min, s.buffer_min, s.color, s.staff_ids, s.resource_kind, s.online, s.is_active, s.notes, s.version,
        (select count(*)::int from appointments a where a.item_id = i.id and a.status not in ('cancelled', 'no_show') and a.start_at >= now() - interval '30 days') as booked30,
        (select coalesce(sum(coalesce(a.price_paise, i.price_paise)), 0) from appointments a where a.item_id = i.id and a.status = 'completed' and a.start_at >= now() - interval '30 days') as revenue30_paise,
        (select count(*)::int from appointments a where a.item_id = i.id and a.status in ('scheduled', 'confirmed') and a.start_at >= now()) as upcoming
      from items i left join booking_services s on s.item_id = i.id and s.tenant_id = i.tenant_id
      left join item_categories c on c.id = i.category_id
      where i.tenant_id = ${t}::uuid and i.type = 'service' order by i.name`,
    ...userPart(t),
  });
  const user = userNames(b);
  const data = b.rows.map((r) => ({
    ...r, id: r.itemId as string, configId: r.id ?? null, configured: !!r.id,
    durationMin: r.durationMin ?? r.itemDurationMin ?? 30, bufferMin: r.bufferMin ?? 0, color: r.color ?? 'blue', staffIds: (r.staffIds ?? []) as string[],
    staff: ((r.staffIds ?? []) as string[]).map((id) => ({ id, name: user.get(id) ?? '' })), online: r.online ?? true,
    isActive: (r.isActive ?? true) && r.itemActive, revenue30Paise: big(r.revenue30Paise), pricePaise: big(r.pricePaise), version: r.version ?? 0, booked30: r.booked30 as number,
  }));
  return {
    data,
    sums: {
      services: data.length, online: data.filter((s) => s.online && s.isActive).length,
      booked30: data.reduce((a, s) => a + (s.booked30 as number), 0), revenue30: data.reduce((a, s) => a + s.revenue30Paise, 0n),
    },
  };
}

export async function saveService(ctx: TenantCtx, itemId: string, b: z.infer<typeof ServiceInput>) {
  const item = await db().item.findFirst({ where: { id: itemId, tenantId: ctx.tenantId } });
  if (!item || item.type !== 'service') throw new AppError('VALIDATION_FAILED', 'Choose a service item.', { fields: { itemId: 'Not a service' } });
  for (const id of b.staffIds) if (!(await db().tenantMember.findFirst({ where: { userId: id, status: 'active' } }))) throw new AppError('VALIDATION_FAILED', 'Choose active staff only.', { fields: { staffIds: 'Not an active user' } });
  const { pricePaise, ...cfg } = b;
  const data = { ...cfg, resourceKind: cfg.resourceKind ?? null, notes: cfg.notes ?? null };
  const saved = await db().bookingService.upsert({
    where: { tenantId_itemId: { tenantId: ctx.tenantId, itemId } },
    create: { ...data, tenantId: ctx.tenantId, itemId },
    update: { ...data, version: { increment: 1 } },
  });
  // The item keeps the length too, so invoices and other screens agree
  await db().item.update({ where: { id: itemId }, data: { durationMin: b.durationMin, ...(pricePaise !== undefined ? { pricePaise: BigInt(pricePaise) } : {}), version: { increment: 1 } } });
  return saved;
}

// ---------------------------------------------------------------- resources

export const ResourceInput = z.object({
  name: z.string().trim().min(2, 'Name it, e.g. Room 1 or Chair 2').max(60),
  kind: z.enum(['room', 'chair', 'equipment']).default('room'),
  capacity: z.number().int().min(1).max(500).default(1),
  color: z.string().max(12).default('slate'),
  notes: z.string().trim().max(500).optional().nullable(),
  isActive: z.boolean().default(true),
});

export async function listResources(ctx: TenantCtx) {
  const b = await bundle({
    rows: Prisma.sql`
      select r.*,
        (select count(*)::int from appointments a where a.resource_id = r.id and a.status in ('scheduled', 'confirmed') and a.start_at >= now()) as upcoming,
        (select count(*)::int from appointments a where a.resource_id = r.id and a.status not in ('cancelled', 'no_show') and a.start_at >= now() - interval '30 days' and a.start_at < now()) as used30,
        (select coalesce(sum(extract(epoch from (a.end_at - a.start_at)) / 60), 0)::int from appointments a where a.resource_id = r.id and a.status not in ('cancelled', 'no_show') and a.start_at >= now() - interval '30 days' and a.start_at < now()) as used30_min,
        (select a.title from appointments a where a.resource_id = r.id and a.status not in ('cancelled', 'no_show') and a.start_at <= now() and a.end_at > now() limit 1) as in_use_by
      from booking_resources r where r.tenant_id = ${ctx.tenantId}::uuid order by r.is_active desc, r.name`,
  });
  return { data: b.rows.map((r) => ({ ...r, id: r.id as string })) };
}

export async function saveResource(ctx: TenantCtx, b: z.infer<typeof ResourceInput>, id?: string, version?: number) {
  const dup = await db().bookingResource.findFirst({ where: { tenantId: ctx.tenantId, name: { equals: b.name, mode: 'insensitive' }, id: id ? { not: id } : undefined } });
  if (dup) throw new AppError('VALIDATION_FAILED', 'This name is already used.', { fields: { name: 'Already used' } });
  if (!id) return db().bookingResource.create({ data: { ...b, notes: b.notes ?? null, tenantId: ctx.tenantId } });
  const r = await db().bookingResource.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!r) throw notFound('Resource');
  assertVersion(r.version, version, 'resource');
  return db().bookingResource.update({ where: { id }, data: { ...b, notes: b.notes ?? null, version: { increment: 1 } } });
}

export async function deleteResource(ctx: TenantCtx, id: string) {
  const r = await db().bookingResource.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!r) throw notFound('Resource');
  if (await db().appointment.count({ where: { resourceId: id } })) throw new AppError('CONFLICT', 'Appointments used this. Mark it closed instead.');
  await db().bookingResource.delete({ where: { id } });
}

// ---------------------------------------------------------------- staff hours and time off

export const HoursInput = z.object({
  hours: z.array(z.object({ weekday: z.number().int().min(0).max(6), start: z.string().regex(/^\d{2}:\d{2}$/, 'Use HH:MM'), end: z.string().regex(/^\d{2}:\d{2}$/, 'Use HH:MM') })).max(21),
});
const toMin = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));

/** Everyone with their week, time off ahead, and how booked they are this week */
export async function listStaff(ctx: TenantCtx) {
  const t = ctx.tenantId;
  const b = await bundle({
    people: Prisma.sql`select u.id, u.name, u.email, r.name as role from tenant_members m join users u on u.id = m.user_id join roles r on r.id = m.role_id where m.tenant_id = ${t}::uuid and m.status = 'active' order by u.name`,
    hours: Prisma.sql`select user_id, weekday, start_min, end_min from staff_hours where tenant_id = ${t}::uuid order by weekday, start_min`,
    off: Prisma.sql`select * from staff_time_off where tenant_id = ${t}::uuid and to_at >= now() - interval '30 days' order by from_at`,
    week: Prisma.sql`
      select staff_id, count(*)::int as n, coalesce(sum(extract(epoch from (end_at - start_at)) / 60), 0)::int as minutes from appointments
      where tenant_id = ${t}::uuid and staff_id is not null and status not in ('cancelled', 'no_show') and start_at >= date_trunc('week', now()) and start_at < date_trunc('week', now()) + interval '7 days'
      group by staff_id`,
  });
  const week = new Map(b.week.map((w) => [w.staffId as string, w]));
  const data = b.people.map((p) => {
    const own = b.hours.filter((h) => h.userId === p.id);
    const list = own.length ? own : DEFAULT_HOURS;
    const weekMin = list.reduce((a, h) => a + (h.endMin as number) - (h.startMin as number), 0);
    const w = week.get(p.id);
    return {
      ...p, id: p.id as string, usesDefault: !own.length,
      hours: list.map((h) => ({ weekday: h.weekday, start: hhmm(h.startMin), end: hhmm(h.endMin) })),
      weekHours: Math.round(weekMin / 60), bookedThisWeek: w?.n ?? 0, bookedPct: weekMin ? Math.round(((w?.minutes ?? 0) / weekMin) * 100) : 0,
      timeOff: b.off.filter((o) => o.userId === p.id).map((o) => ({ id: o.id, fromAt: o.fromAt, toAt: o.toAt, reason: o.reason })),
      offNow: b.off.some((o) => o.userId === p.id && new Date(o.fromAt) <= new Date() && new Date(o.toAt) > new Date()),
    };
  });
  return { data };
}

export async function saveHours(ctx: TenantCtx, userId: string, b: z.infer<typeof HoursInput>) {
  if (!(await db().tenantMember.findFirst({ where: { userId, status: 'active' } }))) throw notFound('Staff member');
  const rows = b.hours.map((h) => ({ weekday: h.weekday, startMin: toMin(h.start), endMin: toMin(h.end) }));
  rows.forEach((h, i) => { if (h.endMin <= h.startMin) throw new AppError('VALIDATION_FAILED', 'Each stretch must end after it starts.', { fields: { [`hours.${i}.end`]: 'Before the start' } }); });
  for (const d of [0, 1, 2, 3, 4, 5, 6]) {
    const day = rows.filter((h) => h.weekday === d).sort((a, c) => a.startMin - c.startMin);
    for (let i = 1; i < day.length; i++) if (day[i].startMin < day[i - 1].endMin) throw new AppError('VALIDATION_FAILED', 'Two stretches on the same day overlap.', { fields: { hours: 'Overlapping times' } });
  }
  await db().staffHours.deleteMany({ where: { tenantId: ctx.tenantId, userId } });
  if (rows.length) await db().staffHours.createMany({ data: rows.map((h) => ({ ...h, tenantId: ctx.tenantId, userId })) });
  return listStaff(ctx);
}

export const TimeOffInput = z.object({
  userId: z.string().uuid({ message: 'Choose the person' }),
  fromDate: DateStr, toDate: DateStr,
  fromTime: z.string().regex(/^\d{2}:\d{2}$/).optional().nullable(), toTime: z.string().regex(/^\d{2}:\d{2}$/).optional().nullable(),
  reason: z.string().trim().max(200).optional().nullable(),
}).refine((v) => v.toDate >= v.fromDate, { path: ['toDate'], message: "Can't end before it starts" });

export async function addTimeOff(ctx: TenantCtx, b: z.infer<typeof TimeOffInput>) {
  if (!(await db().tenantMember.findFirst({ where: { userId: b.userId, status: 'active' } }))) throw new AppError('VALIDATION_FAILED', 'Choose an active person.', { fields: { userId: 'Not active' } });
  const fromAt = atIst(b.fromDate, b.fromTime ? toMin(b.fromTime) : 0);
  const toAt = atIst(b.toDate, b.toTime ? toMin(b.toTime) : 1440);
  if (toAt <= fromAt) throw new AppError('VALIDATION_FAILED', 'Time off must end after it starts.', { fields: { toTime: 'Before the start' } });
  const booked = await db().appointment.count({ where: { tenantId: ctx.tenantId, staffId: b.userId, status: { in: ['scheduled', 'confirmed'] }, startAt: { lt: toAt }, endAt: { gt: fromAt } } });
  if (booked) throw new AppError('CONFLICT', `${booked} appointment${booked === 1 ? ' is' : 's are'} booked with this person then. Move or cancel ${booked === 1 ? 'it' : 'them'} first.`, { fields: { fromDate: 'Has appointments' } });
  return db().staffTimeOff.create({ data: { tenantId: ctx.tenantId, userId: b.userId, fromAt, toAt, reason: b.reason ?? null, createdBy: ctx.userId } });
}

export async function deleteTimeOff(ctx: TenantCtx, id: string) {
  const o = await db().staffTimeOff.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!o) throw notFound('Time off');
  await db().staffTimeOff.delete({ where: { id } });
}

// ---------------------------------------------------------------- free slots

export const SlotQuery = z.object({ date: DateStr, itemId: z.string().uuid(), staffId: z.string().uuid().optional() });

/** Free start times for a service on a day: inside someone's hours, not on leave, not booked
 *  (the gap after each service counts), a room free when the service needs one, and not too soon. */
export async function freeSlots(tenantId: string, q: z.infer<typeof SlotQuery>, opts: { stepMin?: number; leadMin?: number; onlineOnly?: boolean } = {}) {
  const b = await bundle({
    item: Prisma.sql`select i.id, i.name, i.duration_min, i.price_paise, i.is_active, s.duration_min as cfg_duration, s.buffer_min, s.staff_ids, s.resource_kind, s.online, s.is_active as cfg_active from items i left join booking_services s on s.item_id = i.id and s.tenant_id = i.tenant_id where i.id = ${q.itemId}::uuid and i.tenant_id = ${tenantId}::uuid and i.type = 'service'`,
    people: Prisma.sql`select u.id, u.name from tenant_members m join users u on u.id = m.user_id where m.tenant_id = ${tenantId}::uuid and m.status = 'active'`,
    hours: Prisma.sql`select user_id, weekday, start_min, end_min from staff_hours where tenant_id = ${tenantId}::uuid`,
    busy: Prisma.sql`select a.staff_id, a.resource_id, a.start_at, a.end_at, coalesce(s.buffer_min, 0) as buffer_min from appointments a left join booking_services s on s.item_id = a.item_id and s.tenant_id = a.tenant_id where a.tenant_id = ${tenantId}::uuid and a.status not in ('cancelled', 'no_show') and a.start_at < ${atIst(q.date, 1440)} and a.end_at > ${atIst(q.date, 0)}`,
    off: Prisma.sql`select user_id, from_at, to_at from staff_time_off where tenant_id = ${tenantId}::uuid and from_at < ${atIst(q.date, 1440)} and to_at > ${atIst(q.date, 0)}`,
    rooms: Prisma.sql`select id, kind from booking_resources where tenant_id = ${tenantId}::uuid and is_active`,
  });
  const item = b.item[0];
  if (!item || !item.isActive || item.cfgActive === false || (opts.onlineOnly && item.online === false)) throw new AppError('VALIDATION_FAILED', 'This service is not open for booking.', { fields: { itemId: 'Not bookable' } });
  const duration = (item.cfgDuration ?? item.durationMin ?? 30) as number;
  const buffer = (item.bufferMin ?? 0) as number;
  const step = opts.stepMin ?? 30;
  const weekday = new Date(`${q.date}T00:00:00Z`).getUTCDay();
  const allowed = ((item.staffIds ?? []) as string[]);
  const staff = b.people.filter((p) => (!allowed.length || allowed.includes(p.id)) && (!q.staffId || p.id === q.staffId));
  const earliest = Date.now() + (opts.leadMin ?? 0) * 60_000;
  const rooms = item.resourceKind ? b.rooms.filter((r) => r.kind === item.resourceKind) : [];
  const overlaps = (s: number, e: number, rows: Row[], key: 'staffId' | 'resourceId', id: string) =>
    rows.some((x) => x[key] === id && new Date(x.startAt).getTime() < e && new Date(x.endAt).getTime() + (x.bufferMin as number) * 60_000 > s);
  const slots = new Map<number, { id: string; name: string }[]>();
  for (const p of staff) {
    const own = b.hours.filter((h) => h.userId === p.id);
    const stretches = (own.length ? own : DEFAULT_HOURS).filter((h) => h.weekday === weekday);
    for (const h of stretches) {
      for (let m = h.startMin as number; m + duration <= (h.endMin as number); m += step) {
        const s = atIst(q.date, m).getTime();
        const e = s + (duration + buffer) * 60_000;
        if (s < earliest) continue;
        if (overlaps(s, e, b.busy, 'staffId', p.id)) continue;
        if (b.off.some((o) => o.userId === p.id && new Date(o.fromAt).getTime() < e && new Date(o.toAt).getTime() > s)) continue;
        if (item.resourceKind && !rooms.some((r) => !overlaps(s, e, b.busy, 'resourceId', r.id))) continue;
        slots.set(m, [...(slots.get(m) ?? []), { id: p.id as string, name: p.name as string }]);
      }
    }
  }
  return {
    service: { id: item.id, name: item.name, durationMin: duration, bufferMin: buffer, pricePaise: big(item.pricePaise), needs: item.resourceKind ?? null },
    slots: [...slots.entries()].sort((a, c) => a[0] - c[0]).map(([m, people]) => ({ time: hhmm(m), startAt: atIst(q.date, m).toISOString(), staff: people })),
  };
}

/** A free room of the kind the service needs, for a slot (online bookings and the form's default) */
export async function freeRoom(tenantId: string, kind: string | null, startAt: Date, endAt: Date) {
  if (!kind) return null;
  const rooms = await db().bookingResource.findMany({ where: { tenantId, kind, isActive: true }, orderBy: { name: 'asc' } });
  for (const r of rooms) {
    const busy = await db().appointment.findFirst({ where: { tenantId, resourceId: r.id, status: { notIn: ['cancelled', 'no_show'] }, startAt: { lt: endAt }, endAt: { gt: startAt } } });
    if (!busy) return r.id;
  }
  return null;
}

// ---------------------------------------------------------------- online booking

export const SettingsInput = z.object({
  enabled: z.boolean(),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9-]{3,40}$/, 'Use 3 to 40 small letters, numbers or -'),
  title: z.string().trim().min(2, 'Give the page a title').max(120),
  intro: z.string().trim().max(1000).optional().nullable(),
  slotStepMin: z.number().int().refine((v) => [10, 15, 20, 30, 45, 60].includes(v), 'Choose 10, 15, 20, 30, 45 or 60'),
  leadMin: z.number().int().min(0).max(10_080),
  maxDaysAhead: z.number().int().min(1).max(180),
  autoConfirm: z.boolean(),
});

export async function getSettings(ctx: TenantCtx) {
  const s = await db().bookingSettings.findUnique({ where: { tenantId: ctx.tenantId } });
  if (s) return s;
  const t = await db().tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { name: true } });
  const base = t.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'book';
  return { tenantId: ctx.tenantId, enabled: false, slug: `${base}-${randomBytes(2).toString('hex')}`, title: `Book with ${t.name}`, intro: null, slotStepMin: 30, leadMin: 60, maxDaysAhead: 30, autoConfirm: false, updatedAt: new Date() };
}

export async function saveSettings(ctx: TenantCtx, b: z.infer<typeof SettingsInput>) {
  const taken = await db().$queryRaw<{ n: number }[]>`select count(*)::int as n from booking_settings where slug = ${b.slug} and tenant_id <> ${ctx.tenantId}::uuid`;
  if (taken[0]?.n) throw new AppError('VALIDATION_FAILED', 'This link is taken. Try another.', { fields: { slug: 'Already taken' } });
  return db().bookingSettings.upsert({ where: { tenantId: ctx.tenantId }, create: { ...b, intro: b.intro ?? null, tenantId: ctx.tenantId }, update: { ...b, intro: b.intro ?? null } });
}

/** The public page: the business, its online services and the people who do them (no login) */
export async function publicPage(slug: string) {
  const s = await db().bookingSettings.findUnique({ where: { slug } });
  if (!s || !s.enabled) throw notFound('Booking page');
  const t = s.tenantId;
  const b = await bundle({
    tenant: Prisma.sql`select name, profile from tenants where id = ${t}::uuid`,
    services: Prisma.sql`select i.id, i.name, i.description, i.price_paise, coalesce(s.duration_min, i.duration_min, 30) as duration_min, s.staff_ids from items i left join booking_services s on s.item_id = i.id and s.tenant_id = i.tenant_id where i.tenant_id = ${t}::uuid and i.type = 'service' and i.is_active and coalesce(s.online, true) and coalesce(s.is_active, true) order by i.name`,
    people: Prisma.sql`select u.id, u.name from tenant_members m join users u on u.id = m.user_id where m.tenant_id = ${t}::uuid and m.status = 'active' order by u.name`,
  });
  const profile = (b.tenant[0]?.profile ?? {}) as { address?: Record<string, string>; phone?: string; logoUrl?: string };
  return {
    business: { name: b.tenant[0]?.name, phone: profile.phone ?? null, city: profile.address?.city ?? null, logoUrl: profile.logoUrl ?? null },
    title: s.title, intro: s.intro, maxDaysAhead: s.maxDaysAhead,
    services: b.services.map((x) => ({ id: x.id, name: x.name, description: x.description, pricePaise: big(x.pricePaise), durationMin: x.durationMin, staffIds: x.staffIds ?? [] })),
    staff: b.people.map((p) => ({ id: p.id, name: p.name })),
  };
}

export async function publicSlots(slug: string, q: z.infer<typeof SlotQuery>) {
  const s = await db().bookingSettings.findUnique({ where: { slug } });
  if (!s || !s.enabled) throw notFound('Booking page');
  const last = new Date(Date.now() + s.maxDaysAhead * DAY).toISOString().slice(0, 10);
  if (q.date < todayIST() || q.date > last) throw new AppError('VALIDATION_FAILED', `Choose a day within the next ${s.maxDaysAhead} days.`, { fields: { date: 'Out of range' } });
  return freeSlots(s.tenantId, q, { stepMin: s.slotStepMin, leadMin: s.leadMin, onlineOnly: true });
}

export const PublicBookInput = z.object({
  itemId: z.string().uuid(),
  staffId: z.string().uuid().optional().nullable(),
  startAt: z.string().datetime({ offset: true }),
  name: z.string().trim().min(2, 'Enter your name').max(120),
  phone: zPhone,
  notes: z.string().trim().max(500).optional().nullable(),
});

/** A customer books themself: the slot is checked again, a free person and room are given, and a
 *  known phone number links the existing customer */
export async function publicBook(slug: string, b: z.infer<typeof PublicBookInput>) {
  const s = await db().bookingSettings.findUnique({ where: { slug } });
  if (!s || !s.enabled) throw notFound('Booking page');
  const date = istDay(new Date(b.startAt));
  const free = await freeSlots(s.tenantId, { date, itemId: b.itemId, staffId: b.staffId ?? undefined }, { stepMin: s.slotStepMin, leadMin: s.leadMin, onlineOnly: true });
  const slot = free.slots.find((x) => x.startAt === new Date(b.startAt).toISOString());
  if (!slot) throw new AppError('CONFLICT', 'That time was just taken. Please choose another.', { fields: { startAt: 'No longer free' } });
  const staffId = b.staffId ?? slot.staff[0].id;
  const startAt = new Date(slot.startAt);
  const endAt = new Date(startAt.getTime() + free.service.durationMin * 60_000);
  const resourceId = await freeRoom(s.tenantId, free.service.needs, startAt, new Date(endAt.getTime() + free.service.bufferMin * 60_000));
  const digits = b.phone.replace(/\D/g, '').slice(-10);
  const known = await db().contact.findFirst({ where: { tenantId: s.tenantId, type: 'customer', phone: { endsWith: digits } }, select: { id: true } });
  try {
    const a = await db().appointment.create({
      data: {
        tenantId: s.tenantId, kind: 'appointment', title: `${free.service.name} · ${b.name}`, contactId: known?.id ?? null, guestName: known ? null : b.name, guestPhone: known ? null : b.phone,
        itemId: b.itemId, staffId, resourceId, startAt, endAt, status: s.autoConfirm ? 'confirmed' : 'scheduled', confirmedAt: s.autoConfirm ? new Date() : null,
        source: 'online', pricePaise: free.service.pricePaise, notes: b.notes ?? null,
      },
    });
    await notify(staffId, `Booked online: ${a.title}`, `${date} ${slot.time}`, '/app/m/bookings');
    return { id: a.id, service: free.service.name, date, time: slot.time, staff: slot.staff.find((x) => x.id === staffId)?.name ?? null, status: a.status };
  } catch (e) { return conflict(e); }
}
