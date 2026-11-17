// Demo data for Sales, so Customers, Quotations, Sales Invoices, Sales Returns and Payments Received
// show real-looking rows: business and walk-in customers, quotations at every stage, invoices over
// the last three months (drafts, unpaid, overdue, part paid, paid, one cancelled), payments by UPI,
// bank, cheque and cash, an advance, and sales returns (goods back, and an amount reduced).
// Usage: npx tsx prisma/demo-sales.ts <tenantId> [<tenantId> …]
// Re-running picks up where a stopped run left off. Uses the same service code the app uses.
import { randomUUID } from 'node:crypto';
import { prisma, db, withPlatform } from '../src/kernel/db';
import type { TenantCtx } from '../src/kernel/context';
import { gstinCheckChar } from '../src/contracts/validation';
import { todayIST } from '../src/kernel/gst';
import * as fin from '../src/modules/finance/service';
import * as billing from '../src/modules/billing/service';
import * as receipts from '../src/modules/billing/receipts';
import * as notes from '../src/modules/billing/creditNotes';

const run = <T>(fn: () => Promise<T>) => withPlatform(fn, { kind: 'platform' }, { timeoutMs: 600_000 });
const addDays = (s: string, n: number) => new Date(new Date(`${s}T00:00:00.000Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);
const gstin = (state: string, pan: string) => { const first = `${state}${pan}1Z`; return first + gstinCheckChar(first); };

type Cust = { name: string; company?: string; phone: string; email?: string; state: string; city: string; pin: string; line1: string; pan?: string; days?: number };
const CUSTOMERS: Cust[] = [
  { name: 'Anil Kapoor', company: 'Kapoor General Store', phone: '9839112233', email: 'kapoorstore@gmail.com', state: '09', city: 'Lucknow', pin: '226010', line1: 'B-12, Gomti Nagar', pan: 'ABEPK3311L', days: 15 },
  { name: 'Sunita Agrawal', company: 'Agrawal Sweets & Namkeen', phone: '9415334455', email: 'agrawalsweets@yahoo.in', state: '09', city: 'Kanpur', pin: '208001', line1: '64, Birhana Road', pan: 'AAKFA2290R', days: 30 },
  { name: 'Rohit Malhotra', company: 'Malhotra Electricals', phone: '9811556677', email: 'accounts@malhotraelectricals.in', state: '07', city: 'New Delhi', pin: '110018', line1: 'WZ-41, Rajouri Garden', pan: 'AAHFM6612C', days: 30 },
  { name: 'Farhan Siddiqui', company: 'Siddiqui Caterers', phone: '9935778899', email: 'siddiquicaterers@gmail.com', state: '09', city: 'Lucknow', pin: '226003', line1: 'Chowk, Near Akbari Gate', pan: 'BHSPS4421N', days: 7 },
  { name: 'Meena Iyer', company: 'Green Leaf Café', phone: '9844990011', email: 'hello@greenleafcafe.in', state: '29', city: 'Bengaluru', pin: '560038', line1: '12th Main, Indiranagar', pan: 'AAJFG7720K', days: 15 },
  { name: 'Vikas Dubey', company: 'Shiv Shakti Hardware', phone: '9450221133', state: '09', city: 'Prayagraj', pin: '211003', line1: 'Katra Market', pan: 'ADZPD5531H', days: 21 },
  { name: 'Pooja Saxena', phone: '9918443322', email: 'pooja.saxena88@gmail.com', state: '09', city: 'Lucknow', pin: '226016', line1: '3/45, Vikas Nagar' },
  { name: 'Harpreet Singh', company: 'Punjab Dhaba', phone: '9876554433', state: '03', city: 'Ludhiana', pin: '141001', line1: 'GT Road, Near Jagraon Bridge', pan: 'AMWPS8841G', days: 10 },
  { name: 'Kavita Rao', company: 'Rao Office Supplies', phone: '9900112244', email: 'raooffice@gmail.com', state: '27', city: 'Pune', pin: '411004', line1: 'FC Road, Shivajinagar', pan: 'AAPFR9912E', days: 30 },
  { name: 'Deepak Chauhan', phone: '9721334466', state: '09', city: 'Lucknow', pin: '226021', line1: 'Sector 14, Indira Nagar' },
];

// description, HSN, unit, price (paise), GST bp
type G = [string, string, string, number, number];
const GOODS: G[] = [
  ['Tata Salt 1 kg', '25010020', 'pcs', 2_800, 0], ['Fortune Sunflower Oil 1 L', '15121910', 'pcs', 16_500, 500], ['Aashirvaad Atta 10 kg', '11010000', 'bag', 48_000, 0],
  ['Surf Excel 1 kg', '34022010', 'pcs', 15_600, 1800], ['Parle-G 800 g', '19053100', 'pcs', 9_500, 1800], ['Haldiram Bhujia 1 kg', '21069099', 'pcs', 30_000, 1200],
  ['Havells LED Bulb 9W', '85395000', 'pcs', 12_000, 1800], ['Anchor Switch 6A', '85365090', 'pcs', 4_200, 1800], ['Crompton Ceiling Fan 1200 mm', '84145110', 'pcs', 225_000, 1800],
  ['JK Copier A4 75 GSM', '48025690', 'ream', 32_000, 1200], ['Corrugated Box 5-ply', '48191010', 'pcs', 6_500, 1800], ['Basmati Rice 25 kg', '10063020', 'bag', 260_000, 500],
];

// customer index, days ago, lines [goods index, qty], what happens next
type Plan = { c: number; ago: number; lines: [number, number][]; then: 'draft' | 'unpaid' | 'part' | 'paid' | 'cancel' };
const PLANS: Plan[] = [
  { c: 0, ago: 84, lines: [[0, 100], [1, 40], [3, 24]], then: 'paid' },
  { c: 2, ago: 80, lines: [[6, 120], [7, 200]], then: 'paid' },
  { c: 1, ago: 75, lines: [[2, 10], [4, 60], [5, 20]], then: 'part' },
  { c: 4, ago: 70, lines: [[1, 30], [11, 4]], then: 'paid' },
  { c: 5, ago: 66, lines: [[7, 150], [6, 60]], then: 'unpaid' },
  { c: 7, ago: 61, lines: [[11, 6], [1, 50], [0, 80]], then: 'part' },
  { c: 3, ago: 57, lines: [[5, 30], [4, 80]], then: 'paid' },
  { c: 8, ago: 52, lines: [[9, 60], [10, 300]], then: 'unpaid' },
  { c: 0, ago: 48, lines: [[2, 15], [3, 36]], then: 'paid' },
  { c: 2, ago: 44, lines: [[8, 6], [6, 100]], then: 'part' },
  { c: 6, ago: 40, lines: [[1, 4], [4, 6]], then: 'paid' },
  { c: 1, ago: 36, lines: [[5, 40], [0, 50]], then: 'cancel' },
  { c: 4, ago: 31, lines: [[11, 3], [5, 12]], then: 'unpaid' },
  { c: 3, ago: 27, lines: [[1, 60], [2, 20]], then: 'paid' },
  { c: 9, ago: 23, lines: [[6, 10], [7, 20]], then: 'paid' },
  { c: 5, ago: 19, lines: [[8, 3], [7, 80]], then: 'part' },
  { c: 0, ago: 15, lines: [[0, 120], [4, 100], [3, 30]], then: 'unpaid' },
  { c: 7, ago: 12, lines: [[11, 5], [5, 25]], then: 'paid' },
  { c: 8, ago: 9, lines: [[9, 40]], then: 'unpaid' },
  { c: 2, ago: 6, lines: [[6, 150], [8, 4]], then: 'unpaid' },
  { c: 1, ago: 4, lines: [[4, 120], [5, 30]], then: 'part' },
  { c: 6, ago: 2, lines: [[1, 2], [0, 4]], then: 'paid' },
  { c: 3, ago: 1, lines: [[2, 10], [1, 20]], then: 'draft' },
  { c: 9, ago: 0, lines: [[6, 6]], then: 'draft' },
];

async function seed(tenantId: string) {
  const t = await run(() => prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { name: true, ownerUserId: true } }));
  console.log(`\n${t.name} (${tenantId})`);
  if (await run(() => prisma.salesDocument.count({ where: { tenantId, kind: 'quotation', notes: 'Rates valid for 15 days. Delivery within 3 days of order.' } }))) return console.log('  · demo sales already there, skipped');
  const member = await run(() => prisma.tenantMember.findFirstOrThrow({ where: { tenantId, userId: t.ownerUserId! } }));
  const ctx: TenantCtx = { kind: 'tenant', tenantId, userId: t.ownerUserId!, memberId: member.id, roleId: member.roleId, sessionId: randomUUID(), branchIds: [], scope: 'all' };
  const today = todayIST();
  const accounts = await run(async () => { await fin.ensureFinance(ctx); return db().finAccount.findMany({ where: { tenantId, isActive: true } }); });
  const bank = accounts.find((a) => a.kind === 'bank') ?? null;
  const cash = accounts.find((a) => a.kind === 'cash') ?? null;

  // Customers
  const ids = await run(async () => {
    const out: string[] = [];
    for (const c of CUSTOMERS) {
      const had = await db().contact.findFirst({ where: { tenantId, type: 'customer', phone: c.phone } });
      out.push(had?.id ?? (await db().contact.create({ data: {
        tenantId, type: 'customer', name: c.name, companyName: c.company ?? null, phone: c.phone, email: c.email ?? null, stateCode: c.state,
        gstin: c.pan ? gstin(c.state, c.pan) : null, address: { line1: c.line1, city: c.city, pincode: c.pin }, paymentDays: c.days ?? null, ownerId: ctx.userId, createdBy: ctx.userId,
      } })).id);
    }
    return out;
  });
  console.log(`  ✔ ${CUSTOMERS.length} customers`);
  const line = ([g, qty]: [number, number]) => { const [description, hsnSac, unit, unitPricePaise, gstRateBp] = GOODS[g]; return { description, hsnSac, unit, quantity: qty, unitPricePaise, gstRateBp }; };

  // Invoices, oldest first
  const posted: { id: string; plan: Plan; date: string }[] = [];
  for (const plan of PLANS) {
    const date = addDays(today, -plan.ago);
    const days = CUSTOMERS[plan.c].days ?? 0;
    const had = await run(() => db().salesDocument.findFirst({ where: { tenantId, kind: 'invoice', contactId: ids[plan.c], issueDate: new Date(`${date}T00:00:00.000Z`) } }));
    if (had) { if (!['draft', 'cancelled'].includes(had.status)) posted.push({ id: had.id, plan, date }); continue; }
    const doc = await run(() => billing.createDocument(ctx, 'invoice', billing.DocInput.parse({
      contactId: ids[plan.c], issueDate: date, dueDate: addDays(date, days), notes: 'Goods delivered by our van. Please check and sign the copy.', roundOff: true,
      lines: plan.lines.map(line),
    })));
    if (plan.then === 'draft') continue;
    await run(() => billing.issueInvoice(ctx, doc.id, { skipCreditLimit: true }));
    if (plan.then === 'cancel') { await run(() => billing.cancelInvoice(ctx, doc.id, 'Customer cancelled the order before delivery.')); continue; }
    posted.push({ id: doc.id, plan, date });
  }
  console.log(`  ✔ ${PLANS.length} invoices`);

  // Payments: paid in full, part paid about half; a few days after the invoice
  let k = 0;
  for (const b of posted) {
    if (b.plan.then !== 'paid' && b.plan.then !== 'part') continue;
    const inv = await run(() => db().salesDocument.findUniqueOrThrow({ where: { id: b.id } }));
    const due = inv.totalPaise - inv.paidPaise;
    if (due <= 0n || inv.paidPaise > 0n) continue;
    const amount = b.plan.then === 'paid' ? due : (due / 200n) * 100n;
    const walkIn = !CUSTOMERS[b.plan.c].company;
    const method = walkIn ? (amount <= 2_000_000n ? 'cash' : 'upi') : (['upi', 'bank', 'cheque', 'upi', 'bank'] as const)[k % 5];
    const paidOn = addDays(b.date, 3 + (k % 8));
    const reference = method === 'bank' ? `UTR${String(52214000 + k * 613).padStart(12, '0')}` : method === 'cheque' ? String(710220 + k) : method === 'upi' ? `5338${String(77120000 + k * 47).padStart(8, '0')}` : null;
    await run(() => receipts.receivePayment(ctx, receipts.ReceiveInput.parse({
      contactId: inv.contactId, amountPaise: Number(amount), method, reference, paidOn: paidOn > today ? today : paidOn,
      accountId: method === 'cash' ? cash?.id ?? null : bank?.id ?? null, allocations: [{ documentId: b.id, amountPaise: Number(amount) }],
    })));
    k++;
  }
  // An advance from a regular customer for a coming order
  await run(() => receipts.receivePayment(ctx, receipts.ReceiveInput.parse({ contactId: ids[3], amountPaise: 1_500_000, method: 'upi', reference: '533899120044', paidOn: addDays(today, -3), accountId: bank?.id ?? null, notes: 'Advance for the wedding order next week', allocations: [] })));
  console.log(`  ✔ ${k + 1} payments received (one advance)`);

  // Sales returns: two with goods back, one amount reduced
  const RETURNS: [number, 'return' | 'amount', string, string][] = [[0, 'return', 'damaged', 'Two cartons damaged in transit; taken back.'], [8, 'return', 'wrong_item', 'Wrong item sent; customer returned it.'], [13, 'amount', 'rate_difference', 'Agreed rate was lower than billed.']];
  for (const [i, type, reason, note] of RETURNS) {
    const b = posted.find((p) => p.plan === PLANS[i]);
    if (!b) continue;
    const inv = await run(() => billing.getDocument(ctx, b.id, 'invoice'));
    const l = inv.lines[0];
    await run(() => notes.createCreditNote(ctx, b.id, notes.CreditNoteInput.parse({
      type, reason, notes: note, issueDate: addDays(b.date, 5) > today ? today : addDays(b.date, 5),
      lines: [type === 'return' ? { sourceLineId: l.id, quantity: Math.max(1, Math.round(Number(l.quantity) * 0.1)) } : { sourceLineId: l.id, taxablePaise: Math.round(Number(l.taxablePaise) * 0.05) }],
    })));
  }
  console.log(`  ✔ ${RETURNS.length} sales returns`);

  // Quotations at every stage
  const QUOTES: [number, number, [number, number][], 'draft' | 'sent' | 'accepted' | 'declined' | 'convert'][] = [
    [4, 20, [[11, 10], [5, 30]], 'sent'], [8, 14, [[9, 100], [10, 500]], 'accepted'], [2, 10, [[8, 12], [6, 200]], 'declined'],
    [7, 8, [[11, 8], [1, 60]], 'convert'], [5, 5, [[7, 300]], 'sent'], [0, 2, [[0, 200], [3, 50]], 'draft'], [1, 1, [[5, 50], [4, 200]], 'draft'],
  ];
  for (const [c, ago, ls, stage] of QUOTES) {
    const date = addDays(today, -ago);
    const q = await run(() => billing.createDocument(ctx, 'quotation', billing.DocInput.parse({ contactId: ids[c], issueDate: date, dueDate: addDays(date, 15), notes: 'Rates valid for 15 days. Delivery within 3 days of order.', lines: ls.map(line) })));
    if (stage === 'draft') continue;
    if (stage === 'convert') { await run(() => billing.convertQuotation(ctx, q.id, 'invoice')); continue; }
    await run(() => db().salesDocument.update({ where: { id: q.id }, data: { status: stage, version: { increment: 1 } } }));
  }
  console.log(`  ✔ ${QUOTES.length} quotations`);
}

(async () => {
  const list = process.argv.slice(2);
  if (!list.length) throw new Error('Usage: npx tsx prisma/demo-sales.ts <tenantId> [<tenantId> …]');
  for (const id of list) await seed(id);
  await prisma.$disconnect();
})().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
