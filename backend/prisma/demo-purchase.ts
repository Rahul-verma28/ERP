// Demo data for Purchase, so the invoice, return, payment and supplier pages show real-looking rows:
// suppliers across states, invoices over the last three months (drafts, posted, part paid, paid,
// overdue, one cancelled), payments by bank, UPI, cheque and cash, and returns at every stage.
// Usage: npx tsx prisma/demo-purchase.ts <tenantId> [<tenantId> …]
// Skips a business that already has these suppliers. Uses the same service code the app uses.
import { randomUUID } from 'node:crypto';
import { prisma, db, withPlatform } from '../src/kernel/db';
import type { TenantCtx } from '../src/kernel/context';
import { gstinCheckChar } from '../src/contracts/validation';
import { todayIST } from '../src/kernel/gst';
import * as fin from '../src/modules/finance/service';
import * as purchase from '../src/modules/purchase/service';
import * as payments from '../src/modules/purchase/payments';

const run = <T>(fn: () => Promise<T>) => withPlatform(fn, { kind: 'platform' }, { timeoutMs: 600_000 });
const day = (s: string) => new Date(`${s}T00:00:00.000Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (s: string, n: number) => iso(new Date(day(s).getTime() + n * 86_400_000));
const gstin = (state: string, pan: string) => { const first = `${state}${pan}1Z`; return first + gstinCheckChar(first); };

type Sup = { name: string; company: string; phone: string; email: string; state: string; city: string; pin: string; line1: string; pan?: string; days: number; notes?: string };
const SUPPLIERS: Sup[] = [
  { name: 'Rajesh Gupta', company: 'Shree Ganesh Traders', phone: '9839012345', email: 'orders@shreeganeshtraders.in', state: '09', city: 'Lucknow', pin: '226018', line1: '14, Aminabad Market', pan: 'AAKFS4521K', days: 15, notes: 'Main supplier for daily-use goods. Delivers twice a week.' },
  { name: 'Amit Jain', company: 'Bharat Electricals Pvt Ltd', phone: '9810034567', email: 'sales@bharatelectricals.co.in', state: '07', city: 'New Delhi', pin: '110006', line1: '2210, Bhagirath Palace, Chandni Chowk', pan: 'AABCB7812M', days: 30 },
  { name: 'Sunil Mishra', company: 'Kanpur Packaging Co', phone: '9415523456', email: 'accounts@kanpurpackaging.in', state: '09', city: 'Kanpur', pin: '208012', line1: 'Plot 31, Panki Industrial Area', pan: 'AAJFK3390P', days: 21 },
  { name: 'Deepak Agarwal', company: 'Mahalaxmi Stationery Mart', phone: '9450078901', email: 'mahalaxmi.stationery@gmail.com', state: '09', city: 'Varanasi', pin: '221001', line1: 'K 37/12, Gola Dinanath', pan: 'ABDPA6271Q', days: 7 },
  { name: 'Vinod Patil', company: 'Om Sai Hardware', phone: '9822045678', email: 'omsaihardware@yahoo.in', state: '27', city: 'Pune', pin: '411002', line1: '512, Budhwar Peth', pan: 'AHMPP2219L', days: 30 },
  { name: 'Hitesh Shah', company: 'Gujarat Polymers', phone: '9825067890', email: 'hitesh@gujaratpolymers.com', state: '24', city: 'Ahmedabad', pin: '382445', line1: 'Shed 18, GIDC Vatva', pan: 'AAFFG5583D', days: 45, notes: 'Ships by transport; freight on our side.' },
  { name: 'Mohan Lal', company: 'Annapurna Food Supplies', phone: '9414089012', email: 'annapurna.jaipur@gmail.com', state: '08', city: 'Jaipur', pin: '302003', line1: 'Gangori Bazaar, Near Tripolia Gate', pan: 'ACIPL8834F', days: 10 },
  { name: 'Ramesh Yadav', company: 'Yadav Kirana Wholesale', phone: '9936012347', email: 'yadavkirana@gmail.com', state: '09', city: 'Lucknow', pin: '226003', line1: 'Naka Hindola, Station Road', days: 0, notes: 'Small dealer, not GST registered. Cash or UPI only.' },
];

// What each supplier sells: description, HSN, unit, price (paise), GST basis points
type L = [string, string, string, number, number];
const GOODS: Record<string, L[]> = {
  'Shree Ganesh Traders': [['Tata Salt 1 kg', '25010020', 'pcs', 2_400, 0], ['Fortune Sunflower Oil 1 L', '15121910', 'pcs', 14_500, 500], ['Aashirvaad Atta 10 kg', '11010000', 'bag', 42_000, 0], ['Surf Excel 1 kg', '34022010', 'pcs', 13_800, 1800], ['Parle-G 800 g', '19053100', 'pcs', 8_200, 1800]],
  'Bharat Electricals Pvt Ltd': [['Havells LED Bulb 9W', '85395000', 'pcs', 9_500, 1800], ['Anchor Switch 6A', '85365090', 'pcs', 3_200, 1800], ['Polycab Wire 1.5 sq mm (90 m)', '85444999', 'roll', 145_000, 1800], ['Crompton Ceiling Fan 1200 mm', '84145110', 'pcs', 185_000, 1800]],
  'Kanpur Packaging Co': [['Corrugated Box 5-ply (18x12x12)', '48191010', 'pcs', 4_800, 1800], ['BOPP Tape 2 in (65 m)', '39191000', 'roll', 3_600, 1800], ['Bubble Wrap Roll 1 m x 100 m', '39211900', 'roll', 98_000, 1800], ['Stretch Film 18 in', '39201012', 'roll', 42_000, 1800]],
  'Mahalaxmi Stationery Mart': [['JK Copier A4 75 GSM (500)', '48025690', 'ream', 26_000, 1200], ['Reynolds Ball Pen (box of 50)', '96081019', 'box', 25_000, 1800], ['Classmate Notebook 172 pages', '48202000', 'pcs', 5_200, 1200], ['Kangaro Stapler HD-10', '84729010', 'pcs', 9_500, 1800]],
  'Om Sai Hardware': [['Asian Paints Apcolite 4 L', '32091010', 'tin', 165_000, 1800], ['Fevicol SH 1 kg', '35069999', 'pcs', 38_000, 1800], ['Taparia Screwdriver Set', '82054000', 'set', 42_000, 1800], ['Godrej Navtal Lock 7 Lever', '83011000', 'pcs', 78_000, 1800]],
  'Gujarat Polymers': [['HDPE Granules (25 kg bag)', '39012000', 'bag', 312_000, 1800], ['PP Woven Sack 50 kg', '63053300', 'pcs', 1_400, 500], ['LDPE Film Roll', '39201011', 'kg', 15_500, 1800]],
  'Annapurna Food Supplies': [['Basmati Rice 25 kg', '10063020', 'bag', 225_000, 500], ['Toor Dal 30 kg', '07136000', 'bag', 390_000, 500], ['Haldiram Bhujia 1 kg', '21069099', 'pcs', 26_000, 1200], ['MDH Garam Masala 100 g', '09109100', 'pcs', 8_500, 500]],
  'Yadav Kirana Wholesale': [['Loose Sugar', '17019990', 'kg', 4_200, 500], ['Loose Chana Dal', '07132000', 'kg', 9_800, 0], ['Agarbatti Pack', '33074100', 'box', 4_500, 500]],
};

// [supplier, days ago, which goods (index, qty)…, what happens]
type Plan = { s: string; ago: number; lines: [number, number][]; then: 'draft' | 'unpaid' | 'part' | 'paid' | 'cancel'; ref?: string };
const PLANS: Plan[] = [
  { s: 'Shree Ganesh Traders', ago: 86, lines: [[0, 200], [1, 60], [2, 25]], then: 'paid' },
  { s: 'Bharat Electricals Pvt Ltd', ago: 82, lines: [[0, 150], [1, 300], [2, 6]], then: 'paid' },
  { s: 'Kanpur Packaging Co', ago: 78, lines: [[0, 1000], [1, 120]], then: 'part' },
  { s: 'Gujarat Polymers', ago: 74, lines: [[0, 20], [1, 2000]], then: 'part' },
  { s: 'Mahalaxmi Stationery Mart', ago: 70, lines: [[0, 40], [1, 6], [2, 120]], then: 'paid' },
  { s: 'Shree Ganesh Traders', ago: 64, lines: [[3, 80], [4, 150]], then: 'paid' },
  { s: 'Om Sai Hardware', ago: 60, lines: [[0, 12], [1, 30], [3, 10]], then: 'unpaid' },
  { s: 'Annapurna Food Supplies', ago: 56, lines: [[0, 12], [1, 6], [3, 200]], then: 'part' },
  { s: 'Yadav Kirana Wholesale', ago: 52, lines: [[0, 150], [1, 80]], then: 'paid' },
  { s: 'Bharat Electricals Pvt Ltd', ago: 47, lines: [[3, 8], [2, 4]], then: 'unpaid' },
  { s: 'Kanpur Packaging Co', ago: 43, lines: [[2, 6], [3, 15]], then: 'cancel' },
  { s: 'Shree Ganesh Traders', ago: 39, lines: [[0, 300], [1, 80], [2, 30], [4, 200]], then: 'part' },
  { s: 'Gujarat Polymers', ago: 34, lines: [[2, 350]], then: 'unpaid' },
  { s: 'Mahalaxmi Stationery Mart', ago: 30, lines: [[0, 30], [3, 10]], then: 'paid' },
  { s: 'Annapurna Food Supplies', ago: 26, lines: [[2, 120], [3, 150]], then: 'paid' },
  { s: 'Om Sai Hardware', ago: 21, lines: [[2, 15], [1, 20]], then: 'part' },
  { s: 'Shree Ganesh Traders', ago: 16, lines: [[1, 100], [3, 60]], then: 'unpaid' },
  { s: 'Kanpur Packaging Co', ago: 12, lines: [[0, 1500], [1, 200], [3, 20]], then: 'unpaid' },
  { s: 'Yadav Kirana Wholesale', ago: 8, lines: [[0, 100], [2, 40]], then: 'paid' },
  { s: 'Bharat Electricals Pvt Ltd', ago: 5, lines: [[0, 200], [1, 400]], then: 'unpaid' },
  { s: 'Annapurna Food Supplies', ago: 3, lines: [[0, 10], [1, 4]], then: 'draft' },
  { s: 'Mahalaxmi Stationery Mart', ago: 1, lines: [[1, 4], [2, 200]], then: 'draft' },
];

async function seed(tenantId: string) {
  const t = await run(() => prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { name: true, ownerUserId: true } }));
  console.log(`\n${t.name} (${tenantId})`);
  // Re-running picks up where a stopped run left off: what exists is kept, the rest is added
  if (await run(() => prisma.purchaseDocument.count({ where: { tenantId, kind: 'purchase_return', returnReason: 'Quality issue', notes: { startsWith: 'Quality issue:' } } }))) return console.log('  · demo purchases already there, skipped');
  const member = await run(() => prisma.tenantMember.findFirstOrThrow({ where: { tenantId, userId: t.ownerUserId! } }));
  const ctx: TenantCtx = { kind: 'tenant', tenantId, userId: t.ownerUserId!, memberId: member.id, roleId: member.roleId, sessionId: randomUUID(), branchIds: [], scope: 'all' };
  const today = todayIST();

  const { accounts, locations } = await run(async () => {
    await fin.ensureFinance(ctx);
    return {
      accounts: await db().finAccount.findMany({ where: { tenantId, isActive: true }, orderBy: { createdAt: 'asc' } }),
      locations: await db().stockLocation.findMany({ where: { tenantId, isActive: true }, orderBy: { createdAt: 'asc' } }),
    };
  });
  const bank = accounts.find((a) => a.kind === 'bank') ?? null;
  const cash = accounts.find((a) => a.kind === 'cash') ?? null;

  // Suppliers
  const sup = new Map<string, { id: string; days: number; gst: boolean }>();
  await run(async () => {
    for (const s of SUPPLIERS) {
      const had = await db().contact.findFirst({ where: { tenantId, type: 'supplier', companyName: s.company } });
      if (had) { sup.set(s.company, { id: had.id, days: s.days, gst: !!s.pan }); continue; }
      const c = await purchase.createSupplier(ctx, purchase.SupplierInput.parse({
        name: s.name, companyName: s.company, phone: s.phone, email: s.email, stateCode: s.state, gstin: s.pan ? gstin(s.state, s.pan) : null,
        address: { line1: s.line1, city: s.city, pincode: s.pin }, notes: s.notes ?? null, paymentDays: s.days || null,
      }));
      sup.set(s.company, { id: c.id, days: s.days, gst: !!s.pan });
    }
  });
  console.log(`  ✔ ${SUPPLIERS.length} suppliers`);

  // Invoices, oldest first, then what happens to each
  const bills: { id: string; plan: Plan; date: string; total: bigint; lines: { id: string; quantity: number }[] }[] = [];
  let n = 0;
  for (const plan of PLANS) {
    const s = sup.get(plan.s)!;
    const date = addDays(today, -plan.ago);
    const loc = locations.length ? locations[n % locations.length].id : null;
    const goods = GOODS[plan.s];
    const ref = `${plan.s.split(' ').map((w) => w[0]).join('').toUpperCase()}/${26 + (n % 2)}-${String(140 + n * 7).padStart(4, '0')}`;
    const had = await run(() => db().purchaseDocument.findFirst({ where: { tenantId, kind: 'purchase_bill', contactId: s.id, supplierRef: ref }, include: { lines: { orderBy: { position: 'asc' } } } }));
    if (had) {
      n++;
      if (had.status !== 'draft' && had.status !== 'cancelled') bills.push({ id: had.id, plan, date, total: had.totalPaise, lines: had.lines.map((l) => ({ id: l.id, quantity: Number(l.quantity) })) });
      continue;
    }
    const doc = await run(() => purchase.createPurchase(ctx, 'purchase_bill', purchase.PurchaseInput.parse({
      contactId: s.id, issueDate: date, supplierDate: date, dueDate: addDays(date, s.days || 7), supplierRef: ref,
      locationId: loc, notes: n % 3 === 0 ? 'Checked at the gate; quantities match the challan.' : null,
      chargesPaise: plan.s === 'Gujarat Polymers' ? 250_000 : 0, chargesGstBp: plan.s === 'Gujarat Polymers' ? 1800 : 0,
      lines: plan.lines.map(([i, qty]) => { const [description, hsnSac, unit, price, gst] = goods[i]; return { description, hsnSac, unit, quantity: qty, unitPricePaise: price, gstRateBp: s.gst ? gst : 0 }; }),
    }), { draft: true }));
    n++;
    if (plan.then === 'draft') continue;
    const posted = await run(() => purchase.postBill(ctx, doc.id, doc.version));
    if (plan.then === 'cancel') { await run(() => purchase.cancelPurchase(ctx, doc.id, 'Supplier sent the wrong rate; new invoice to follow.')); continue; }
    bills.push({ id: doc.id, plan, date, total: posted.totalPaise, lines: posted.lines.map((l) => ({ id: l.id, quantity: Number(l.quantity) })) });
  }
  console.log(`  ✔ ${PLANS.length} invoices (${PLANS.filter((p) => p.then === 'draft').length} drafts, 1 cancelled)`);

  // Returns: one completed, one completed with a partial quantity, one approved, one draft
  const RETURNS: [number, 'issued' | 'approved' | 'draft', string, number][] = [[2, 'issued', 'Damaged in transit', 0.1], [5, 'issued', 'Defective', 0.05], [11, 'approved', 'Wrong item', 0.1], [15, 'draft', 'Quality issue', 0.2]];
  for (const [i, stage, reason, share] of RETURNS) {
    const b = bills.find((x) => x.plan === PLANS[i]);
    if (!b || (await run(() => db().purchaseDocument.count({ where: { tenantId, kind: 'purchase_return', sourceId: b.id } })))) continue;
    const date = addDays(b.date, 3);
    const l = b.lines[0];
    const r = await run(() => purchase.createPurchase(ctx, 'purchase_return', purchase.PurchaseInput.parse({
      contactId: sup.get(b.plan.s)!.id, issueDate: date > today ? today : date, sourceId: b.id, returnReason: reason,
      notes: `${reason}: sent back with the transporter, debit note to follow.`,
      lines: [{ sourceLineId: l.id, quantity: Math.max(1, Math.round(l.quantity * share)), unitPricePaise: 0, gstRateBp: 0 }],
    }), { draft: true }));
    if (stage === 'draft') continue;
    const a = await run(() => purchase.approveReturn(ctx, r.id, r.version));
    if (stage === 'issued') await run(() => purchase.completeReturn(ctx, r.id, a.version));
  }
  console.log(`  ✔ ${RETURNS.length} purchase returns`);

  // Payments: paid ones in full, part ones about half, a few days after the invoice
  let k = 0;
  for (const b of bills) {
    if (b.plan.then !== 'paid' && b.plan.then !== 'part') continue;
    const fresh = await run(() => db().purchaseDocument.findUniqueOrThrow({ where: { id: b.id } }));
    const due = fresh.totalPaise - fresh.paidPaise - fresh.returnedPaise;
    if (due <= 0n || fresh.paidPaise > 0n) continue;
    const amount = b.plan.then === 'paid' ? due : (due / 200n) * 100n;
    const unregistered = !sup.get(b.plan.s)!.gst;
    const method = unregistered ? (amount <= 1_000_000n ? 'cash' : 'upi') : (['bank', 'upi', 'cheque', 'bank'] as const)[k % 4];
    const paidOn = addDays(b.date, 4 + (k % 9));
    const reference = method === 'bank' ? `UTR${String(31245600 + k * 977).padStart(12, '0')}` : method === 'cheque' ? String(482110 + k) : method === 'upi' ? `4127${String(88120000 + k * 31).padStart(8, '0')}` : null;
    await run(() => payments.paySuppliers(ctx, payments.PayInput.parse({
      contactId: fresh.contactId, amountPaise: Number(amount), method, reference, paidOn: paidOn > today ? today : paidOn,
      accountId: method === 'cash' ? cash?.id ?? null : bank?.id ?? null,
      allocations: [{ documentId: b.id, amountPaise: Number(amount) }],
    })));
    k++;
  }
  console.log(`  ✔ ${k} payments made`);
}

(async () => {
  const ids = process.argv.slice(2);
  if (!ids.length) throw new Error('Usage: npx tsx prisma/demo-purchase.ts <tenantId> [<tenantId> …]');
  for (const id of ids) await seed(id);
  await prisma.$disconnect();
})().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
