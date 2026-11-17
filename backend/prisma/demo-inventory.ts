// Demo data for Inventory, so Stock, Warehouses, Transfers and Stock Entries show real-looking rows:
// stock items in categories with prices and low-stock levels, opening stock in each warehouse, stock
// in from suppliers, adjustments (damage, found, sample), a stock count, and transfers (moved at once,
// received, and one still on the way). A few items end low or out of stock on purpose.
// Usage: npx tsx prisma/demo-inventory.ts <tenantId> [<tenantId> …]
// Skips a business that already has these items. Uses the same stock engine the app uses.
import { randomUUID } from 'node:crypto';
import { prisma, db, withPlatform } from '../src/kernel/db';
import type { TenantCtx } from '../src/kernel/context';
import { todayIST } from '../src/kernel/gst';
import * as inventory from '../src/modules/inventory/service';

const run = <T>(fn: () => Promise<T>) => withPlatform(fn, { kind: 'platform' }, { timeoutMs: 600_000 });
const addDays = (s: string, n: number) => new Date(new Date(`${s}T00:00:00.000Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);

// name, sku, category, unit, sale price, cost (paise), GST bp, HSN, low-stock level, opening qty per warehouse (first, second, third)
type I = [string, string, string, string, number, number, number, string, number, number[]];
const ITEMS: I[] = [
  ['Tata Salt 1 kg', 'GRO-SALT-1K', 'Grocery', 'pcs', 2_800, 2_400, 0, '25010020', 40, [180, 60, 0]],
  ['Fortune Sunflower Oil 1 L', 'GRO-OIL-1L', 'Grocery', 'pcs', 16_500, 14_500, 500, '15121910', 30, [90, 24, 12]],
  ['Aashirvaad Atta 10 kg', 'GRO-ATTA-10', 'Grocery', 'bag', 48_000, 42_000, 0, '11010000', 10, [35, 8, 0]],
  ['Basmati Rice 25 kg', 'GRO-RICE-25', 'Grocery', 'bag', 260_000, 225_000, 500, '10063020', 5, [6, 2, 0]],
  ['Surf Excel 1 kg', 'HOM-SURF-1K', 'Home care', 'pcs', 15_600, 13_800, 1800, '34022010', 25, [70, 20, 10]],
  ['Parle-G 800 g', 'SNK-PARLE-800', 'Snacks', 'pcs', 9_500, 8_200, 1800, '19053100', 50, [240, 80, 40]],
  ['Haldiram Bhujia 1 kg', 'SNK-BHUJ-1K', 'Snacks', 'pcs', 30_000, 26_000, 1200, '21069099', 20, [45, 12, 0]],
  ['Havells LED Bulb 9W', 'ELE-LED-9W', 'Electricals', 'pcs', 12_000, 9_500, 1800, '85395000', 30, [120, 0, 25]],
  ['Anchor Switch 6A', 'ELE-SW-6A', 'Electricals', 'pcs', 4_200, 3_200, 1800, '85365090', 50, [260, 0, 40]],
  ['Crompton Ceiling Fan 1200 mm', 'ELE-FAN-1200', 'Electricals', 'pcs', 225_000, 185_000, 1800, '84145110', 4, [9, 0, 3]],
  ['JK Copier A4 75 GSM', 'STA-A4-75', 'Stationery', 'ream', 32_000, 26_000, 1200, '48025690', 15, [60, 10, 0]],
  ['Reynolds Ball Pen (50)', 'STA-PEN-50', 'Stationery', 'box', 32_000, 25_000, 1800, '96081019', 5, [1, 0, 0]],
  ['Corrugated Box 5-ply', 'PKG-BOX-5P', 'Packaging', 'pcs', 6_500, 4_800, 1800, '48191010', 200, [900, 150, 0]],
  ['BOPP Tape 2 in', 'PKG-TAPE-2', 'Packaging', 'roll', 5_000, 3_600, 1800, '39191000', 40, [36, 0, 0]],
];

async function seed(tenantId: string) {
  const t = await run(() => prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { name: true, ownerUserId: true } }));
  console.log(`\n${t.name} (${tenantId})`);
  if (await run(() => prisma.item.count({ where: { tenantId, sku: ITEMS[0][1] } }))) return console.log('  · demo items already there, skipped');
  const member = await run(() => prisma.tenantMember.findFirstOrThrow({ where: { tenantId, userId: t.ownerUserId! } }));
  const ctx: TenantCtx = { kind: 'tenant', tenantId, userId: t.ownerUserId!, memberId: member.id, roleId: member.roleId, sessionId: randomUUID(), branchIds: [], scope: 'all' };
  const today = todayIST();

  // Warehouses: use what is there, and make sure there are three
  const places = await run(async () => {
    await inventory.listLocations(ctx);
    const have = await db().stockLocation.findMany({ where: { tenantId, isActive: true }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }] });
    const extra = [
      { name: 'City Shop Store', address: 'Shop 4, Hazratganj Market', city: 'Lucknow', zipCode: '226001', stateCode: '09', contactPerson: 'Manoj Tiwari', phone: '9839045612' },
      { name: 'Kanpur Depot', address: 'Plot 12, Dada Nagar Industrial Area', city: 'Kanpur', zipCode: '208022', stateCode: '09', contactPerson: 'Ravi Shukla', phone: '9415067823' },
    ];
    for (const w of extra.slice(0, Math.max(0, 3 - have.length))) have.push(await db().stockLocation.create({ data: { tenantId, ...w } }));
    return have.slice(0, 3);
  });

  // Categories and items
  const items = await run(async () => {
    const cat = new Map<string, string>();
    for (const name of [...new Set(ITEMS.map((i) => i[2]))]) {
      const had = await db().itemCategory.findFirst({ where: { tenantId, name } });
      cat.set(name, had?.id ?? (await db().itemCategory.create({ data: { tenantId, name } })).id);
    }
    const out: { id: string; row: I }[] = [];
    for (const row of ITEMS) {
      const [name, sku, category, unit, price, cost, gst, hsn, reorder] = row;
      const it = await db().item.create({ data: { tenantId, type: 'product', name, sku, unit, pricePaise: BigInt(price), costPricePaise: BigInt(cost), gstRateBp: gst, hsnSac: hsn, trackStock: true, reorderLevel: reorder, categoryId: cat.get(category)!, createdBy: ctx.userId } });
      out.push({ id: it.id, row });
    }
    return out;
  });
  console.log(`  ✔ ${items.length} stock items in ${new Set(ITEMS.map((i) => i[2])).size} categories`);

  const post = (input: Parameters<typeof inventory.EntryInput.parse>[0]) => run(() => inventory.postEntry(ctx, inventory.EntryInput.parse(input)));
  const id = (sku: string) => items.find((i) => i.row[1] === sku)!.id;
  const cost = (sku: string) => items.find((i) => i.row[1] === sku)!.row[5];

  // Opening stock, per warehouse, 40 days back
  let entries = 0;
  for (const [w, place] of places.entries()) {
    const lines = items.filter((i) => (i.row[9][w] ?? 0) > 0).map((i) => ({ itemId: i.id, quantity: i.row[9][w], ratePaise: i.row[5] }));
    if (!lines.length) continue;
    await post({ kind: 'opening', locationId: place.id, date: addDays(today, -40), note: 'Stock counted when we started using the software.', lines });
    entries++;
  }

  // Stock in from suppliers this week
  const IN: [number, string, string, string, [string, number][]][] = [
    [6, 'Shree Ganesh Traders', 'SGT/26-0311', 'Weekly grocery delivery', [['GRO-SALT-1K', 120], ['GRO-OIL-1L', 48], ['SNK-PARLE-800', 120]]],
    [5, 'Bharat Electricals Pvt Ltd', 'BEPL/27-0288', 'Diwali stock for the shop', [['ELE-LED-9W', 100], ['ELE-SW-6A', 150]]],
    [3, 'Kanpur Packaging Co', 'KPC/27-0266', null as unknown as string, [['PKG-BOX-5P', 500]]],
    [1, 'Annapurna Food Supplies', 'AFS/26-0291', 'Rice and snacks', [['GRO-RICE-25', 4], ['SNK-BHUJ-1K', 30]]],
  ];
  for (const [ago, party, reference, note, lines] of IN) {
    await post({ kind: 'stock_in', locationId: places[0].id, date: addDays(today, -ago), party, reference, note, lines: lines.map(([sku, q]) => ({ itemId: id(sku), quantity: q, ratePaise: cost(sku) })) });
    entries++;
  }

  // Adjustments
  const ADJ: [number, number, 'in' | 'out', 'damage' | 'loss' | 'found' | 'sample', string, [string, number][]][] = [
    [5, 0, 'out', 'damage', 'Rats got into two bags in the back room.', [['GRO-ATTA-10', 2]]],
    [4, 0, 'out', 'damage', 'Bulbs broken while unloading.', [['ELE-LED-9W', 6]]],
    [3, 1, 'in', 'found', 'Found a carton behind the rack during cleaning.', [['SNK-PARLE-800', 24]]],
    [2, 0, 'out', 'sample', 'Given to Sharma Caterers to try.', [['SNK-BHUJ-1K', 3], ['GRO-OIL-1L', 2]]],
    [1, 0, 'out', 'loss', 'Short in the monthly check; no bill found.', [['STA-PEN-50', 1]]],
  ];
  for (const [ago, w, direction, reason, note, lines] of ADJ) {
    await post({ kind: 'adjustment', locationId: places[w].id, date: addDays(today, -ago), direction, reason, note, lines: lines.map(([sku, q]) => ({ itemId: id(sku), quantity: q, ...(direction === 'in' ? { ratePaise: cost(sku) } : {}) })) });
    entries++;
  }

  // Transfers between warehouses: three moved at once, one sent and received later, two still on the way
  const MOVE: [number, number, number, boolean, string | null, string, [string, number][]][] = [
    [6, 0, 1, true, 'GP-1042', 'Stock for the city shop', [['GRO-SALT-1K', 40], ['GRO-OIL-1L', 20], ['SNK-PARLE-800', 60]]],
    [5, 0, 2, true, 'GP-1043', 'Kanpur depot top-up', [['PKG-BOX-5P', 300], ['PKG-TAPE-2', 10]]],
    [4, 2, 1, false, 'GP-1044', 'Fans for the shop display', [['ELE-FAN-1200', 2]]],
    [3, 0, 1, true, 'GP-1045', null as unknown as string, [['ELE-LED-9W', 30], ['ELE-SW-6A', 50]]],
    [1, 0, 2, false, 'LR 55821', 'Sent by tempo, reaches tomorrow', [['GRO-ATTA-10', 8], ['GRO-RICE-25', 2]]],
    [0, 0, 1, false, 'GP-1047', 'Evening van to the shop', [['SNK-BHUJ-1K', 10], ['STA-A4-75', 12]]],
  ];
  const sent: string[] = [];
  for (const [ago, from, to, now, reference, note, lines] of MOVE) {
    const e = await post({ kind: 'transfer', locationId: places[from].id, toLocationId: places[to].id, date: addDays(today, -ago), receiveNow: now, reference, note, lines: lines.map(([sku, q]) => ({ itemId: id(sku), quantity: q })) });
    if (!now) sent.push((e as { id: string }).id);
    entries++;
  }
  // The oldest one on the way has arrived
  if (sent[0]) await run(() => inventory.receiveTransfer(ctx, sent[0]));

  // A stock count at the shop: two items off by a little
  await run(() => inventory.postCount(ctx, inventory.CountInput.parse({
    locationId: places[1].id, note: 'Monthly count at the shop.',
    lines: [{ itemId: id('GRO-SALT-1K'), counted: 97 }, { itemId: id('SNK-PARLE-800'), counted: 162 }, { itemId: id('GRO-OIL-1L'), counted: 42 }],
  })));
  entries++;
  console.log(`  ✔ ${entries} stock entries (opening, stock in, adjustments, transfers, a count)`);
}

(async () => {
  const ids = process.argv.slice(2);
  if (!ids.length) throw new Error('Usage: npx tsx prisma/demo-inventory.ts <tenantId> [<tenantId> …]');
  for (const tid of ids) await seed(tid);
  await prisma.$disconnect();
})().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
