// Demo data for Items & Price Lists, run after demo-inventory, demo-purchase and demo-sales: a few
// services, three price lists with exact prices and the customers who use them, and this week's
// purchase bills and invoices made with real items, so each item shows what sold, when, and its last
// purchase price. Bills and invoices go through the same service code the app uses (stock moves too).
// Usage: npx tsx prisma/demo-items.ts <tenantId> [<tenantId> …]
import { randomUUID } from 'node:crypto';
import { prisma, db, withPlatform } from '../src/kernel/db';
import type { TenantCtx } from '../src/kernel/context';
import { todayIST } from '../src/kernel/gst';
import * as purchase from '../src/modules/purchase/service';
import * as billing from '../src/modules/billing/service';
import * as receipts from '../src/modules/billing/receipts';

const run = <T>(fn: () => Promise<T>) => withPlatform(fn, { kind: 'platform' }, { timeoutMs: 600_000 });
const addDays = (s: string, n: number) => new Date(new Date(`${s}T00:00:00.000Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);

async function seed(tenantId: string) {
  const t = await run(() => prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { name: true, ownerUserId: true } }));
  console.log(`\n${t.name} (${tenantId})`);
  if (await run(() => prisma.item.count({ where: { tenantId, sku: 'SRV-DELIVERY' } }))) return console.log('  · demo services already there, skipped');
  const member = await run(() => prisma.tenantMember.findFirstOrThrow({ where: { tenantId, userId: t.ownerUserId! } }));
  const ctx: TenantCtx = { kind: 'tenant', tenantId, userId: t.ownerUserId!, memberId: member.id, roleId: member.roleId, sessionId: randomUUID(), branchIds: [], scope: 'all' };
  const today = todayIST();
  const item = async (sku: string) => run(() => db().item.findFirstOrThrow({ where: { tenantId, sku } }));
  const contact = async (company: string, type: 'customer' | 'supplier') => run(() => db().contact.findFirstOrThrow({ where: { tenantId, type, companyName: company } }));

  // Services
  const cat = await run(async () => (await db().itemCategory.findFirst({ where: { tenantId, name: 'Services' } })) ?? db().itemCategory.create({ data: { tenantId, name: 'Services' } }));
  for (const [name, sku, price, sac] of [['Home delivery', 'SRV-DELIVERY', 5_000, '996812'], ['Fan installation', 'SRV-FAN-FIT', 25_000, '995461'], ['Annual maintenance (AMC)', 'SRV-AMC', 150_000, '998719']] as const) {
    await run(() => db().item.create({ data: { tenantId, type: 'service', name, sku, unit: 'job', pricePaise: BigInt(price), gstRateBp: 1800, hsnSac: sac, categoryId: cat.id, createdBy: ctx.userId } }));
  }
  console.log('  ✔ 3 services');

  // Price lists and who uses them
  const LISTS: [string, number, [string, number][], string[]][] = [
    ['Wholesale', 500, [['GRO-SALT-1K', 2_500], ['GRO-OIL-1L', 15_200], ['SNK-PARLE-800', 8_600], ['PKG-BOX-5P', 5_600]], ['Kapoor General Store', 'Shiv Shakti Hardware', 'Rao Office Supplies']],
    ['Caterer rates', 300, [['GRO-RICE-25', 245_000], ['SNK-BHUJ-1K', 27_500]], ['Siddiqui Caterers', 'Punjab Dhaba', 'Agrawal Sweets & Namkeen']],
    ['Retail', 0, [], []],
  ];
  for (const [name, discountBp, prices, customers] of LISTS) {
    const list = await run(async () => (await db().priceList.findFirst({ where: { tenantId, name } })) ?? db().priceList.create({ data: { tenantId, name, discountBp } }));
    for (const [sku, price] of prices) await run(async () => (await db().priceListItem.findFirst({ where: { priceListId: list.id, itemId: (await item(sku)).id } })) ?? db().priceListItem.create({ data: { tenantId, priceListId: list.id, itemId: (await item(sku)).id, pricePaise: BigInt(price) } }));
    for (const company of customers) await run(async () => db().contact.updateMany({ where: { tenantId, type: 'customer', companyName: company }, data: { priceListId: list.id } }));
  }
  console.log('  ✔ 3 price lists with exact prices and their customers');

  // This week's purchase bills with real items (stock comes in, and the last cost is known)
  const BILLS: [number, string, string, [string, number, number][]][] = [
    [5, 'Shree Ganesh Traders', 'SGT/27-0331', [['GRO-SALT-1K', 120, 2_350], ['GRO-OIL-1L', 48, 14_200], ['SNK-PARLE-800', 96, 8_100]]],
    [3, 'Bharat Electricals Pvt Ltd', 'BEPL/27-0302', [['ELE-LED-9W', 100, 9_300], ['ELE-SW-6A', 200, 3_100], ['ELE-FAN-1200', 4, 182_000]]],
    [2, 'Kanpur Packaging Co', 'KPC/27-0279', [['PKG-BOX-5P', 400, 4_700], ['PKG-TAPE-2', 60, 3_500]]],
  ];
  for (const [ago, supplier, ref, lines] of BILLS) {
    const s = await contact(supplier, 'supplier');
    const date = addDays(today, -ago);
    const lineData = await Promise.all(lines.map(async ([sku, quantity, unitPricePaise]) => { const it = await item(sku); return { itemId: it.id, description: it.name, hsnSac: it.hsnSac, unit: it.unit, quantity, unitPricePaise, gstRateBp: it.gstRateBp }; }));
    await run(() => purchase.createPurchase(ctx, 'purchase_bill', purchase.PurchaseInput.parse({ contactId: s.id, issueDate: date, supplierDate: date, dueDate: addDays(date, s.paymentDays ?? 15), supplierRef: ref, lines: lineData })));
  }
  console.log(`  ✔ ${BILLS.length} purchase bills with items`);

  // This week's invoices with real items (stock goes out), some paid
  const INV: [number, string, [string, number][], boolean][] = [
    [5, 'Kapoor General Store', [['GRO-SALT-1K', 60], ['GRO-OIL-1L', 24], ['SNK-PARLE-800', 48], ['SRV-DELIVERY', 1]], true],
    [4, 'Malhotra Electricals', [['ELE-LED-9W', 50], ['ELE-SW-6A', 120]], false],
    [3, 'Siddiqui Caterers', [['GRO-RICE-25', 2], ['SNK-BHUJ-1K', 12], ['GRO-OIL-1L', 10]], true],
    [2, 'Green Leaf Café', [['ELE-FAN-1200', 2], ['SRV-FAN-FIT', 2]], false],
    [1, 'Rao Office Supplies', [['STA-A4-75', 20], ['PKG-BOX-5P', 150], ['PKG-TAPE-2', 24]], true],
    [0, 'Punjab Dhaba', [['GRO-ATTA-10', 4], ['GRO-OIL-1L', 12], ['SRV-DELIVERY', 1]], false],
  ];
  let paid = 0;
  for (const [ago, customer, lines, pay] of INV) {
    const c = await contact(customer, 'customer');
    const date = addDays(today, -ago);
    const lineData = await Promise.all(lines.map(async ([sku, quantity]) => { const it = await item(sku); return { itemId: it.id, description: it.name, hsnSac: it.hsnSac, unit: it.unit, quantity, unitPricePaise: Number(it.pricePaise), gstRateBp: it.gstRateBp }; }));
    const doc = await run(() => billing.createDocument(ctx, 'invoice', billing.DocInput.parse({ contactId: c.id, issueDate: date, dueDate: addDays(date, c.paymentDays ?? 0), notes: 'Goods delivered by our van. Please check and sign the copy.', roundOff: true, lines: lineData }), { issue: true, skipCreditLimit: true }));
    if (!pay) continue;
    await run(() => receipts.receivePayment(ctx, receipts.ReceiveInput.parse({ contactId: c.id, amountPaise: Number(doc.totalPaise), method: 'upi', reference: `5338${String(91220000 + paid * 71).padStart(8, '0')}`, paidOn: date, allocations: [{ documentId: doc.id, amountPaise: Number(doc.totalPaise) }] })));
    paid++;
  }
  console.log(`  ✔ ${INV.length} invoices with items (${paid} paid)`);
}

(async () => {
  const ids = process.argv.slice(2);
  if (!ids.length) throw new Error('Usage: npx tsx prisma/demo-items.ts <tenantId> [<tenantId> …]');
  for (const id of ids) await seed(id);
  await prisma.$disconnect();
})().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
