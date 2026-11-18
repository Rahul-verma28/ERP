// Demo data for Tasks & Projects and Calendar & Bookings: three projects with tasks at every stage
// (checklists, labels, repeats, subtasks, comments and time logged), and a service desk: services
// set up for booking, vans and a demo room, working hours with a lunch break, time off, past
// appointments (completed and invoiced, no-shows, cancelled), today's and the next two weeks', a
// team meeting, and the online booking page switched on.
// Usage: npx tsx prisma/demo-tasks-bookings.ts <tenantId> [<tenantId> …]
// Uses the same service code the app uses; skips a business that already has these projects.
import { randomUUID } from 'node:crypto';
import { prisma, db, withPlatform } from '../src/kernel/db';
import type { TenantCtx } from '../src/kernel/context';
import { todayIST } from '../src/kernel/gst';
import * as tasks from '../src/modules/tasks/service';
import * as bk from '../src/modules/bookings/service';

const run = <T>(fn: () => Promise<T>) => withPlatform(fn, { kind: 'platform' }, { timeoutMs: 600_000 });
const DAY = 86_400_000;
const addDays = (s: string, n: number) => new Date(new Date(`${s}T00:00:00Z`).getTime() + n * DAY).toISOString().slice(0, 10);
const at = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00+05:30`).toISOString();
const weekday = (s: string) => new Date(`${s}T00:00:00Z`).getUTCDay();
/** The nth working day (Mon–Sat) from today; negative goes back */
function workDay(n: number) {
  let d = todayIST();
  let left = Math.abs(n);
  while (left > 0) { d = addDays(d, n > 0 ? 1 : -1); if (weekday(d) !== 0) left--; }
  return d;
}

async function seed(tenantId: string) {
  const t = await run(() => prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { name: true, ownerUserId: true } }));
  console.log(`\n${t.name} (${tenantId})`);
  if (await run(() => prisma.bookingSettings.count({ where: { tenantId, enabled: true } }))) return console.log('  · demo already there, skipped');
  const member = await run(() => prisma.tenantMember.findFirstOrThrow({ where: { tenantId, userId: t.ownerUserId! } }));
  const ctx: TenantCtx = { kind: 'tenant', tenantId, userId: t.ownerUserId!, memberId: member.id, roleId: member.roleId, sessionId: randomUUID(), branchIds: [], scope: 'all' };
  const me = ctx.userId;
  const today = todayIST();
  const customer = async (company: string) => (await run(() => db().contact.findFirst({ where: { tenantId, type: 'customer', companyName: company }, select: { id: true } })))?.id ?? null;

  // ── Projects ── (each step reuses what an earlier, broken run already made)
  const project = async (name: string, make: () => Promise<{ id: string }>) => (await run(() => prisma.taskProject.findFirst({ where: { tenantId, name }, select: { id: true } }))) ?? run(make);
  const P = {
    diwali: await project('Diwali display 2026', () => tasks.createProject(ctx, tasks.ProjectInput.parse({ name: 'Diwali display 2026', code: 'DIW26', description: 'Window display, festive stock and gift hampers for the season.', ownerId: me, status: 'active', startOn: addDays(today, -20), dueOn: addDays(today, 10), budgetPaise: 5_000_000, color: 'amber' }))),
    shop: await project('Shop renovation', () => tasks.createProject(ctx, tasks.ProjectInput.parse({ name: 'Shop renovation', code: 'RENO', description: 'New racks, lighting and a billing counter.', ownerId: me, status: 'active', startOn: addDays(today, -35), dueOn: addDays(today, -2), budgetPaise: 25_000_000, color: 'violet' }))),
    green: await project('Green Leaf Café kitchen supply', async () => tasks.createProject(ctx, tasks.ProjectInput.parse({ name: 'Green Leaf Café kitchen supply', code: 'GLC', description: 'Monthly supply contract: samples, rates and first delivery.', contactId: await customer('Green Leaf Café'), ownerId: me, status: 'planning', startOn: today, dueOn: addDays(today, 25), billable: true, hourlyRatePaise: 50_000, color: 'emerald' }))),
  };
  console.log('  ✔ 3 projects');

  // ── Tasks ── [title, project, status, priority, due (working days), labels, checklist, repeat, estimate (min)]
  type T = [string, keyof typeof P | null, 'todo' | 'in_progress' | 'done', 'low' | 'medium' | 'high' | 'urgent', number | null, string[], string[], 'none' | 'daily' | 'weekly' | 'monthly', number | null];
  const TASKS: T[] = [
    ['Design the window display', 'diwali', 'done', 'high', -6, ['Design'], ['Pick the theme', 'Get the lights', 'Print the banner'], 'none', 240],
    ['Order 200 gift hampers', 'diwali', 'in_progress', 'urgent', 1, ['Purchase'], ['Get 3 quotes', 'Choose the supplier', 'Pay the advance'], 'none', 120],
    ['Set up the festive counter', 'diwali', 'todo', 'high', 3, ['Shop floor'], ['Clear the space', 'Put up the shelves', 'Price tags'], 'none', 180],
    ['Post Diwali offers on Instagram', 'diwali', 'todo', 'medium', 2, ['Marketing'], [], 'none', 60],
    ['Train staff on hamper billing', 'diwali', 'todo', 'medium', -1, ['Training'], ['Show the hamper items', 'Practice one bill'], 'none', 45],
    ['Fix the new racks', 'shop', 'done', 'medium', -12, ['Carpenter'], ['Measure', 'Fix', 'Clean up'], 'none', 300],
    ['Electrician: shop lighting', 'shop', 'in_progress', 'high', -3, ['Electrical'], ['LED panels', 'Sign board light', 'Test'], 'none', 360],
    ['Paint the billing counter', 'shop', 'todo', 'low', -2, ['Carpenter'], [], 'none', 120],
    ['Send samples to Green Leaf Café', 'green', 'todo', 'high', 2, ['Sales'], ['Rice', 'Oil', 'Spices'], 'none', 90],
    ['Agree the monthly rates', 'green', 'todo', 'medium', 6, ['Sales'], [], 'none', 60],
    ['Count the cash drawer', null, 'todo', 'medium', 0, ['Daily'], ['Count notes', 'Count coins', 'Match with the day book'], 'daily', 20],
    ['Check stock of fast movers', null, 'todo', 'medium', 4, ['Stock'], ['Salt', 'Oil', 'Biscuits', 'Atta'], 'weekly', 30],
    ['Pay electricity bill', null, 'todo', 'high', -4, ['Bills'], [], 'monthly', 10],
    ['File GST return (GSTR-3B)', null, 'todo', 'urgent', 3, ['Accounts'], ['Get the sales summary', 'Send to CA'], 'monthly', 45],
    ['Call back Tripathi Kirana about bulk order', null, 'todo', 'high', 0, ['Follow-up'], [], 'none', null],
    ['Renew trade licence', null, 'done', 'medium', -8, ['Admin'], [], 'none', 30],
  ];
  const made: Record<string, { id: string; version: number }> = {}
  for (const [title, proj, status, priority, due, labels, steps, repeat, estimate] of TASKS) {
    const old = await run(() => prisma.task.findFirst({ where: { tenantId, title, parentId: null }, select: { id: true, version: true } }));
    if (old) { made[title] = old; continue; }
    const start = addDays(today, -10);
    const startOn = !proj ? null : due !== null && workDay(due) < start ? workDay(due) : start;
    const dueAt = due === null ? null : at(workDay(due), due <= 0 ? '17:00' : '18:00');
    const tk = await run(() => tasks.createTask(ctx, tasks.TaskInput.parse({
      title, projectId: proj ? P[proj].id : null, priority, dueAt, labels, repeat, estimateMin: estimate, startOn,
      checklist: steps.map((text, i) => ({ text, done: status === 'done' || (status === 'in_progress' && i === 0) })),
    })));
    if (status !== 'todo') {
      const moved = await run(() => tasks.updateTask(ctx, tk.id, { status: 'in_progress', version: tk.version }));
      made[title] = status === 'done' ? await run(() => tasks.updateTask(ctx, tk.id, { status: 'done', version: moved.version })) : moved;
    } else made[title] = tk;
  }
  let minutes = 0;
  // Subtasks, comments and time (once)
  if (!(await run(() => prisma.task.count({ where: { tenantId, title: 'Quote from Shree Ganesh Traders' } })))) {
  const hampers = made['Order 200 gift hampers'];
  for (const [title, done] of [['Quote from Shree Ganesh Traders', true], ['Quote from Annapurna Food Supplies', true], ['Quote from a third supplier', false]] as const) {
    const s = await run(() => tasks.createTask(ctx, tasks.TaskInput.parse({ title, parentId: hampers.id, priority: 'medium', dueAt: at(workDay(1), '12:00') })));
    if (done) await run(() => tasks.updateTask(ctx, s.id, { status: 'done', version: s.version }));
  }
  for (const [title, text] of [
    ['Order 200 gift hampers', 'Shree Ganesh quoted ₹420 a hamper, Annapurna ₹445. Waiting for one more quote.'],
    ['Order 200 gift hampers', 'Need the order placed by Friday to get delivery before Dhanteras.'],
    ['Electrician: shop lighting', 'Panels fitted on the left wall. Sign board light comes tomorrow.'],
    ['Design the window display', 'Final look approved. Photos are in the shop WhatsApp group.'],
  ] as const) await run(() => tasks.comment(ctx, made[title].id, text));
  // Time logged over the last two weeks
  minutes = 0;
  for (const [title, ago, mins, note, billable] of [
    ['Design the window display', 9, 150, 'Sketches and shopping for lights', false], ['Design the window display', 7, 120, 'Set up the display', false],
    ['Fix the new racks', 12, 240, 'With the carpenter', false], ['Electrician: shop lighting', 3, 180, 'Wiring and panels', false],
    ['Order 200 gift hampers', 2, 75, 'Calls for quotes', false], ['Send samples to Green Leaf Café', 1, 60, 'Packed the samples', true],
    ['Count the cash drawer', 1, 20, null, false], ['Renew trade licence', 8, 45, 'Nagar Nigam visit', false],
  ] as const) {
    await run(() => tasks.logTime(ctx, tasks.TimeInput.parse({ taskId: made[title].id, workDate: workDay(-ago), minutes: mins, note, billable })));
    minutes += mins;
  }
  await run(() => tasks.logTime(ctx, tasks.TimeInput.parse({ projectId: P.green.id, workDate: workDay(-1), minutes: 90, note: 'Meeting at the café about their menu', billable: true })));
  }
  console.log(`  ✔ ${TASKS.length + 3} tasks, 4 comments, ${Math.round((minutes + 90) / 60)} hours logged now`);

  // ── Bookings: services, rooms, hours ──
  const findOrMake = async (name: string, sku: string, price: number, sac: string, minutes2: number) =>
    (await run(() => db().item.findFirst({ where: { tenantId, type: 'service', sku } })))
    ?? run(() => db().item.create({ data: { tenantId, type: 'service', name, sku, unit: 'job', pricePaise: BigInt(price), gstRateBp: 1800, hsnSac: sac, durationMin: minutes2, createdBy: me } }));
  const S = {
    install: await findOrMake('Fan installation', 'SRV-FAN-FIT', 25_000, '995461', 45),
    amc: await findOrMake('Annual maintenance (AMC)', 'SRV-AMC', 150_000, '998719', 60),
    repair: await findOrMake('Electrical repair visit', 'SRV-REPAIR', 40_000, '998719', 60),
    inverter: await findOrMake('Inverter check-up', 'SRV-INVERTER', 30_000, '998719', 45),
    demo: await findOrMake('Product demo at the shop', 'SRV-DEMO', 0, '998599', 30),
  };
  const van1 = await run(() => bk.saveResource(ctx, bk.ResourceInput.parse({ name: 'Service van 1', kind: 'equipment', color: 'blue', notes: 'Maruti Eeco, UP32 AB 4471' })));
  await run(() => bk.saveResource(ctx, bk.ResourceInput.parse({ name: 'Service van 2', kind: 'equipment', color: 'cyan' })));
  const room = await run(() => bk.saveResource(ctx, bk.ResourceInput.parse({ name: 'Demo room', kind: 'room', capacity: 4, color: 'violet', notes: 'Fans and lights on display' })));
  await run(() => bk.saveService(ctx, S.install.id, bk.ServiceInput.parse({ durationMin: 45, bufferMin: 15, color: 'blue', resourceKind: 'equipment', online: true, pricePaise: 25_000 })));
  await run(() => bk.saveService(ctx, S.amc.id, bk.ServiceInput.parse({ durationMin: 60, bufferMin: 15, color: 'emerald', resourceKind: 'equipment', online: true })));
  await run(() => bk.saveService(ctx, S.repair.id, bk.ServiceInput.parse({ durationMin: 60, bufferMin: 30, color: 'amber', resourceKind: 'equipment', online: true, pricePaise: 40_000 })));
  await run(() => bk.saveService(ctx, S.inverter.id, bk.ServiceInput.parse({ durationMin: 45, bufferMin: 15, color: 'rose', resourceKind: 'equipment', online: false, pricePaise: 30_000 })));
  await run(() => bk.saveService(ctx, S.demo.id, bk.ServiceInput.parse({ durationMin: 30, color: 'violet', resourceKind: 'room', online: true, pricePaise: 0 })));
  await run(() => bk.saveHours(ctx, me, bk.HoursInput.parse({ hours: [1, 2, 3, 4, 5, 6].flatMap((d) => [{ weekday: d, start: '10:00', end: '14:00' }, { weekday: d, start: '15:00', end: '19:30' }]) })));
  console.log('  ✔ 5 services set up, 2 vans and a demo room, working hours with a lunch break');

  // ── Appointments ── [working days from today, time, service, customer company or guest, status, source]
  type A = [number, string, keyof typeof S, string, 'completed' | 'no_show' | 'cancelled' | 'confirmed' | 'scheduled', 'walk_in' | 'phone' | 'whatsapp' | 'online', boolean?];
  const APPTS: A[] = [
    [-14, '11:00', 'install', 'Kapoor General Store', 'completed', 'phone', true], [-13, '16:00', 'repair', 'Shiv Shakti Hardware', 'completed', 'whatsapp', true],
    [-12, '10:30', 'amc', 'Green Leaf Café', 'completed', 'phone', true], [-11, '12:00', 'inverter', 'guest:Rajeev Nigam:9839887766', 'no_show', 'phone'],
    [-10, '17:00', 'install', 'Malhotra Electricals', 'completed', 'phone', true], [-9, '11:30', 'demo', 'guest:Sneha Arora:9415776655', 'completed', 'online'],
    [-8, '15:30', 'repair', 'Punjab Dhaba', 'cancelled', 'whatsapp'], [-6, '10:00', 'amc', 'Siddiqui Caterers', 'completed', 'phone', true],
    [-5, '13:00', 'install', 'Rao Office Supplies', 'completed', 'phone', false], [-4, '18:00', 'inverter', 'Agrawal Sweets & Namkeen', 'completed', 'walk_in', false],
    [-3, '11:00', 'repair', 'Kapoor General Store', 'no_show', 'phone'], [-2, '16:30', 'demo', 'guest:Arjun Mehta:9721443322', 'completed', 'online', false],
    [-1, '12:00', 'install', 'Shiv Shakti Hardware', 'completed', 'phone', false],
    [0, '11:00', 'amc', 'Kapoor General Store', 'confirmed', 'phone'], [0, '16:00', 'repair', 'Green Leaf Café', 'scheduled', 'whatsapp'], [0, '18:30', 'demo', 'guest:Pooja Rawat:9935112244', 'confirmed', 'online'],
    [1, '10:30', 'install', 'Malhotra Electricals', 'confirmed', 'phone'], [1, '15:30', 'inverter', 'Siddiqui Caterers', 'scheduled', 'phone'],
    [2, '12:00', 'repair', 'Agrawal Sweets & Namkeen', 'scheduled', 'whatsapp'], [3, '11:00', 'amc', 'Rao Office Supplies', 'confirmed', 'phone'],
    [3, '17:00', 'demo', 'guest:Kunal Bhatia:9450223311', 'scheduled', 'online'], [5, '10:00', 'install', 'Punjab Dhaba', 'scheduled', 'phone'],
    [6, '16:00', 'repair', 'Kapoor General Store', 'scheduled', 'walk_in'], [8, '12:30', 'amc', 'Green Leaf Café', 'scheduled', 'phone'],
  ];
  let invoiced = 0;
  for (const [n, time, svc, who, status, source, invoice] of APPTS) {
    const date = workDay(n);
    const guest = who.startsWith('guest:') ? who.split(':') : null;
    const contactId = guest ? null : await customer(who);
    if (!guest && !contactId) continue;
    const needsRoom = svc === 'demo';
    const a = await run(async () => bk.createAppointment(ctx, bk.AppointmentInput.parse({
      contactId, guestName: guest?.[1] ?? null, guestPhone: guest?.[2] ?? null, itemId: S[svc].id, staffId: me,
      resourceId: needsRoom ? room.id : (await bk.freeRoom(tenantId, 'equipment', new Date(at(date, time)), new Date(new Date(at(date, time)).getTime() + 120 * 60_000))) ?? van1.id,
      startAt: at(date, time), source, status: status === 'confirmed' ? 'confirmed' : 'scheduled', notes: svc === 'repair' ? 'Customer says the MCB trips twice a day.' : null,
    })));
    if (status === 'completed') {
      await run(() => bk.setStatus(ctx, a.id, 'confirm'));
      await run(() => bk.setStatus(ctx, a.id, 'complete'));
      if (invoice && S[svc].pricePaise > 0n && contactId) { await run(() => bk.invoiceAppointment(ctx, a.id)); invoiced++; }
    }
    if (status === 'no_show') await run(() => bk.setStatus(ctx, a.id, 'no_show'));
    if (status === 'cancelled') await run(() => bk.setStatus(ctx, a.id, 'cancel', 'Customer asked to come next week'));
    if (n > 0 && n <= 2) await run(() => bk.markReminded(ctx, a.id));
  }
  // A weekly team meeting and lunch on Saturday, and half a day off next week
  for (const n of [-5, 1]) await run(() => bk.createAppointment(ctx, bk.AppointmentInput.parse({ kind: 'event', title: 'Team meeting: week plan', staffId: me, startAt: at(workDay(n), '10:00'), endAt: at(workDay(n), '10:30'), outsideHours: true })));
  const thursday = (() => { let d = addDays(today, 1); while (weekday(d) !== 4) d = addDays(d, 1); return d; })();
  try { await run(() => bk.addTimeOff(ctx, bk.TimeOffInput.parse({ userId: me, fromDate: thursday, toDate: thursday, fromTime: '15:00', toTime: '19:30', reason: 'Bank and CA visit' }))); } catch { /* an appointment already there: skip */ }
  console.log(`  ✔ ${APPTS.length} appointments (${invoiced} invoiced), 2 team meetings, time off`);

  // ── Online booking page ──
  const slug = `${t.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30)}-book`;
  await run(() => bk.saveSettings(ctx, bk.SettingsInput.parse({ enabled: true, slug, title: `Book a visit with ${t.name}`, intro: 'Fan fitting, repairs and AMC visits at your shop or home. We confirm on WhatsApp.', slotStepMin: 30, leadMin: 120, maxDaysAhead: 30, autoConfirm: false })));
  console.log(`  ✔ online booking page on at /book/${slug}`);
}

(async () => {
  const ids = process.argv.slice(2);
  if (!ids.length) throw new Error('Usage: npx tsx prisma/demo-tasks-bookings.ts <tenantId> [<tenantId> …]');
  for (const id of ids) await seed(id);
  await prisma.$disconnect();
})().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
