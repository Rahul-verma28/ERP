// Demo data for CRM, so Leads, Deals and Tasks show real-looking rows: enquiries from WhatsApp,
// IndiaMART, walk-ins and referrals at every stage, with labels, values and follow-up dates (today,
// missed, coming, none); notes, calls and tasks (some late, some done); and deals at every stage,
// a few won and lost.
// Usage: npx tsx prisma/demo-crm.ts <tenantId> [<tenantId> …]
// Skips a business that already has these leads. Uses the same service code the app uses.
import { randomUUID } from 'node:crypto';
import { prisma, db, withPlatform } from '../src/kernel/db';
import type { TenantCtx } from '../src/kernel/context';
import { todayIST } from '../src/kernel/gst';
import * as crm from '../src/modules/crm/pipeline';

const run = <T>(fn: () => Promise<T>) => withPlatform(fn, { kind: 'platform' }, { timeoutMs: 600_000 });
const addDays = (s: string, n: number) => new Date(new Date(`${s}T00:00:00.000Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);
/** A moment n days from now (negative = past) at an hour, India time */
const at = (n: number, hour: number) => new Date(new Date(`${addDays(todayIST(), n)}T00:00:00+05:30`).getTime() + hour * 3_600_000);

// name, company, phone, email, looking for, source, labels, stage index (0–3), status, value (₹), follow-up (days from today or null), created (days ago)
type L = [string, string | null, string, string | null, string, string, string[], number, 'new' | 'contacted' | 'qualified' | 'lost', number, number | null, number];
const LEADS: L[] = [
  ['Arvind Tripathi', 'Tripathi Kirana Store', '9839221144', null, 'Monthly grocery supply for the shop', 'WhatsApp', ['Hot', 'Bulk order'], 3, 'qualified', 85_000, 0, 12],
  ['Neha Bansal', 'Bansal Caterers', '9415332211', 'bansalcaterers@gmail.com', 'Rice, oil and snacks for wedding season', 'Referral', ['Hot'], 2, 'contacted', 140_000, 1, 9],
  ['Imran Khan', 'Khan Electricals', '9935114422', null, 'LED bulbs and switches, 500 pcs', 'IndiaMART', ['Warm', 'Bulk order'], 1, 'contacted', 62_000, -2, 15],
  ['Ritu Sharma', null, '9721556677', 'ritu.sharma91@gmail.com', 'Ceiling fans for new house (4)', 'Instagram', ['Warm'], 1, 'contacted', 9_800, 3, 6],
  ['Gaurav Mehta', 'Mehta Packers & Movers', '9810667788', 'ops@mehtapackers.in', 'Corrugated boxes and tape every month', 'Google', ['Warm'], 2, 'contacted', 48_000, -1, 20],
  ['Sanjay Verma', 'Verma Tiffin Service', '9450778899', null, 'Atta, oil and dal for 200 tiffins a day', 'Walk-in', ['Hot', 'VIP'], 3, 'qualified', 95_000, 2, 25],
  ['Priyanka Joshi', 'Little Steps Play School', '9839889900', 'admin@littlesteps.in', 'Stationery for 120 kids', 'Website', ['Cold'], 0, 'new', 22_000, null, 2],
  ['Manish Gupta', 'Gupta Hardware', '9415990011', null, 'Paint and fevicol, regular orders', 'JustDial', [], 0, 'new', 30_000, 0, 1],
  ['Kiran Patel', 'Shree Krishna Sweets', '9825001122', 'shreekrishnasweets@gmail.com', 'Boxes and packing for Diwali', 'Exhibition', ['Hot'], 2, 'contacted', 56_000, -4, 30],
  ['Aditya Singh', null, '9936112233', null, 'Inverter and fan for shop', 'Phone call', ['Cold'], 0, 'new', 12_000, 7, 3],
  ['Rekha Nair', 'Nair Home Foods', '9846223344', 'nairhomefoods@gmail.com', 'Spices and rice for packing', 'Facebook', ['Warm'], 1, 'contacted', 35_000, null, 11],
  ['Vivek Rastogi', 'Rastogi Medicals', '9839334455', null, 'Packing tape and boxes', 'Referral', [], 1, 'contacted', 8_000, 5, 8],
  ['Shalini Kapoor', 'The Book Nook', '9415445566', 'thebooknook@gmail.com', 'A4 paper and pens every month', 'Website', ['Warm'], 2, 'contacted', 18_000, -7, 26],
  ['Deepak Yadav', 'Yadav Dairy', '9450556677', null, 'Freezer and lights for dairy', 'Walk-in', ['Cold'], 0, 'new', 45_000, null, 4],
  ['Pankaj Mishra', 'Mishra Restaurant', '9721667788', null, 'Wanted 30% discount on oil', 'IndiaMART', [], 1, 'lost', 25_000, null, 40],
  ['Sunita Rao', null, '9900778899', null, 'Asked for price only', 'Instagram', [], 0, 'lost', 4_000, null, 33],
];
// Leads that became deals: name, company, phone, deal title, value, stage index, outcome, expected close (days)
type D = [string, string, string, string, number, number, 'open' | 'won' | 'lost', number];
const CONVERTED: D[] = [
  ['Rohan Saxena', 'Saxena Banquets', '9839001234', 'Banquet supplies, 6 months', 380_000, 3, 'won', -10],
  ['Alok Pandey', 'Pandey Hotel', '9415112345', 'Monthly grocery for hotel kitchen', 210_000, 2, 'open', 5],
  ['Meera Chauhan', 'Chauhan Electronics', '9450223456', 'Fans and lights for 3 showrooms', 165_000, 1, 'open', 12],
];
// Deals with existing customers: company, title, value, stage, outcome, expected close (days)
const DEALS: [string, string, number, number, 'open' | 'won' | 'lost', number][] = [
  ['Kapoor General Store', 'Festive stock, December', 120_000, 1, 'open', 20],
  ['Malhotra Electricals', 'LED bulbs, bulk 1,000', 98_000, 2, 'open', -3],
  ['Siddiqui Caterers', 'Wedding season rice and oil', 175_000, 3, 'open', 7],
  ['Green Leaf Café', 'Annual kitchen supplies', 260_000, 0, 'open', 35],
  ['Rao Office Supplies', 'Paper and stationery contract', 72_000, 3, 'won', -6],
  ['Punjab Dhaba', 'Dal and atta, quarterly', 88_000, 2, 'lost', -2],
  ['Agrawal Sweets & Namkeen', 'Diwali boxes and packing', 64_000, 3, 'won', -14],
];

async function seed(tenantId: string) {
  const t = await run(() => prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { name: true, ownerUserId: true } }));
  console.log(`\n${t.name} (${tenantId})`);
  if (await run(() => prisma.deal.count({ where: { tenantId, title: CONVERTED[0][3] } }))) return console.log('  · demo deals already there, skipped');
  const member = await run(() => prisma.tenantMember.findFirstOrThrow({ where: { tenantId, userId: t.ownerUserId! } }));
  const ctx: TenantCtx = { kind: 'tenant', tenantId, userId: t.ownerUserId!, memberId: member.id, roleId: member.roleId, sessionId: randomUUID(), branchIds: [], scope: 'all' };
  const today = todayIST();
  const { pipe, leadStages, dealStages } = await run(async () => {
    const p = await crm.ensureSetup(ctx);
    const stages = await db().crmStage.findMany({ where: { tenantId, pipelineId: p.id }, orderBy: { position: 'asc' } });
    return { pipe: p, leadStages: stages.filter((s) => s.kind === 'lead'), dealStages: stages.filter((s) => s.kind === 'deal') };
  });
  const lead = (i: number) => leadStages[Math.min(i, leadStages.length - 1)].id;
  const dstage = (i: number) => dealStages[Math.min(i, dealStages.length - 1)].id;
  const act = (data: { contactId: string; dealId?: string; type: 'note' | 'call' | 'meeting' | 'follow_up' | 'task'; title: string; body?: string; dueAt?: Date; completedAt?: Date | null; createdAt: Date }) =>
    run(() => db().activity.create({ data: { tenantId, assigneeId: ['task', 'follow_up'].includes(data.type) ? ctx.userId : null, createdBy: ctx.userId, ...data, body: data.body ?? null } }));

  // Leads with their history
  let k = 0;
  for (const [name, company, phone, email, subject, source, labels, stage, status, value, follow, created] of LEADS) {
    if (await run(() => db().contact.count({ where: { tenantId, type: 'lead', phone } }))) { k++; continue; }
    const c = await run(() => db().contact.create({ data: {
      tenantId, type: 'lead', name, companyName: company, phone, email, subject, leadSource: source, labels, leadStatus: status,
      pipelineId: pipe.id, stageId: lead(stage), valuePaise: BigInt(value * 100), followUpOn: follow === null ? null : new Date(`${addDays(today, follow)}T00:00:00.000Z`),
      lostReason: status === 'lost' ? (value > 10_000 ? 'Price too high' : 'Not interested now') : null, ownerId: ctx.userId, createdBy: ctx.userId,
      createdAt: at(-created, 11), stateCode: '09',
    } }));
    await act({ contactId: c.id, type: 'note', title: 'Enquiry received', body: `${subject}. Came through ${source}.`, createdAt: at(-created, 11) });
    if (stage >= 1) await act({ contactId: c.id, type: 'call', title: 'Called and shared rates', body: 'Sent the price list on WhatsApp. Will decide after checking with family/partner.', createdAt: at(-Math.max(0, created - 2), 16) });
    if (stage >= 2) await act({ contactId: c.id, type: 'meeting', title: 'Visited the shop', body: 'Saw the samples, liked the quality. Asked for a better rate on bulk.', createdAt: at(-Math.max(0, created - 5), 13) });
    if (status !== 'lost') {
      // A follow-up task on the follow-up date; every third one is done already
      const due = follow ?? (k % 2 ? 4 : -3);
      await act({ contactId: c.id, type: 'follow_up', title: stage >= 2 ? 'Send final quotation' : 'Call back to check interest', dueAt: at(due, 11), completedAt: k % 3 === 2 ? at(Math.min(due, 0), 12) : null, createdAt: at(-Math.max(0, created - 1), 10) });
    }
    k++;
  }
  console.log(`  ✔ ${LEADS.length} leads with notes, calls and follow-ups`);

  // Leads that became deals
  const closeIt = async (dealId: string, outcome: 'open' | 'won' | 'lost', close: number) => {
    // A new deal can't be expected to close in the past; old ones are set back after
    if (close < 0) await run(() => db().deal.update({ where: { id: dealId }, data: { expectedCloseOn: new Date(`${addDays(today, close)}T00:00:00.000Z`), createdAt: at(close - 20, 11) } }));
    if (outcome === 'won') await run(() => crm.closeDeal(ctx, dealId, 'won'));
    if (outcome === 'lost') await run(() => crm.closeDeal(ctx, dealId, 'lost', crm.LostInput.parse({ reason: 'Bought from someone else', note: 'Got a lower rate from a wholesaler in Aminabad.' })));
  };
  for (const [name, company, phone, title, value, stage, outcome, close] of CONVERTED) {
    const c = (await run(() => db().contact.findFirst({ where: { tenantId, type: 'lead', phone } }))) ?? await run(() => db().contact.create({ data: { tenantId, type: 'lead', name, companyName: company, phone, subject: title, leadSource: 'Referral', labels: ['Hot'], leadStatus: 'qualified', pipelineId: pipe.id, stageId: lead(3), valuePaise: BigInt(value * 100), ownerId: ctx.userId, createdBy: ctx.userId, createdAt: at(-28, 11), stateCode: '09' } }));
    await act({ contactId: c.id, type: 'note', title: 'Enquiry received', body: title, createdAt: at(-28, 11) });
    const d = await run(() => crm.convertLeadToDeal(ctx, c.id, crm.ConvertInput.parse({ title, valuePaise: value * 100, stageId: dstage(stage), expectedCloseOn: addDays(today, Math.max(close, 0)), source: 'Referral', labels: ['Hot'] })));
    const dealId = (d as { id?: string; deal?: { id: string } }).deal?.id ?? (d as { id: string }).id;
    await act({ contactId: c.id, dealId, type: 'task', title: 'Share final quotation and delivery plan', dueAt: at(Math.min(close, 2), 12), completedAt: outcome === 'open' ? null : at(close, 13), createdAt: at(-20, 10) });
    await closeIt(dealId, outcome, close);
  }

  // Deals with existing customers
  let n = 0;
  for (const [company, title, value, stage, outcome, close] of DEALS) {
    const c = await run(() => db().contact.findFirst({ where: { tenantId, type: 'customer', companyName: company } }));
    if (!c) continue;
    const d = await run(() => crm.createDeal(ctx, crm.DealInput.parse({ title, contactId: c.id, pipelineId: pipe.id, stageId: dstage(stage), valuePaise: value * 100, expectedCloseOn: addDays(today, Math.max(close, 0)), source: n % 2 ? 'Phone call' : 'WhatsApp', labels: value > 150_000 ? ['VIP'] : [] })));
    await act({ contactId: c.id, dealId: d.id, type: 'call', title: 'Discussed quantities and delivery', body: 'Needs delivery in two lots. Asked for 2% extra off on full payment.', createdAt: at(-9 + n, 15) });
    if (outcome === 'open') await act({ contactId: c.id, dealId: d.id, type: 'task', title: n % 2 ? 'Get the signed order' : 'Send revised quotation', dueAt: at(n % 3 === 0 ? -1 : n, 11), createdAt: at(-5, 10) });
    await closeIt(d.id, outcome, close);
    n++;
  }
  console.log(`  ✔ ${CONVERTED.length + n} deals (some won, some lost) with tasks`);
}

(async () => {
  const ids = process.argv.slice(2);
  if (!ids.length) throw new Error('Usage: npx tsx prisma/demo-crm.ts <tenantId> [<tenantId> …]');
  for (const id of ids) await seed(id);
  await prisma.$disconnect();
})().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
