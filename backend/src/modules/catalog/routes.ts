import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { db } from '../../kernel/db';
import { AppError, notFound } from '../../kernel/errors';
import type { TenantCtx } from '../../kernel/context';
import { GST_RATES_BP } from '../../kernel/gst';
import { IdParam, ListQuery, Paise, assertRecordLimit, assertVersion, canWriteField, markOnboarding, page, pageArgs, stripHidden } from '../../kernel/query';
import { validate } from '../../middleware/request';
import { requirePermission, tenantAuth, tx } from '../../middleware/auth';
import { validateCustom } from '../config/service';
import { optionalText, zHsnOrSac } from '../../kernel/zodRules';
import { consumer } from '../events/outbox';
import { audit } from '../audit/service';
import { reservedByItem, stockByItem } from '../inventory/service';
import { templateByKey } from '../../contracts/templates';

// Product & Service Catalogue (CAT-01, CAT-02) — master data shared by billing, CRM, bookings.

const router = Router();
router.use(tenantAuth);

const HIDDEN = { cost_price: 'costPricePaise' };

const ItemInput = z.object({
  type: z.enum(['product', 'service']).default('product'),
  name: z.string().trim().min(1).max(160),
  sku: z.string().trim().max(40).optional().nullable(),
  categoryId: z.string().uuid().optional().nullable(),
  unit: z.string().trim().min(1).max(20).default('pcs'),
  pricePaise: Paise,
  costPricePaise: Paise.optional().nullable(),
  gstRateBp: z.number().int().refine((v) => (GST_RATES_BP as readonly number[]).includes(v), 'Choose a valid GST rate'),
  hsnSac: optionalText(zHsnOrSac),
  durationMin: z.number().int().min(5).max(24 * 60).optional().nullable(),
  skill: z.string().trim().max(80).optional().nullable(),
  description: z.string().trim().max(2000).optional().nullable(),
  imageUrl: z.string().url().max(500).optional().nullable().or(z.literal('').transform(() => null)),
  isActive: z.boolean().optional(),
  /** Inventory: sales and returns move this item's stock */
  trackStock: z.boolean().optional(),
  reorderLevel: z.number().min(0, 'Enter 0 or more').max(1e9).optional().nullable(),
  /** none | batch (batch number and expiry) | serial (one number per piece) */
  tracking: z.enum(['none', 'batch', 'serial']).optional(),
  altUnit: z.string().trim().max(20).optional().nullable(),
  altFactor: z.number().gt(1, 'More than 1').max(1e6).optional().nullable(),
  barcode: z.string().trim().max(48).regex(/^[\x20-\x7E]+$/, 'Letters, digits and symbols only').optional().nullable().or(z.literal('').transform(() => null)),
  variantGroup: z.string().trim().max(160).optional().nullable(),
  attributes: z.record(z.string().max(40)).optional(),
  custom: z.record(z.unknown()).optional(),
});

const ItemPatch = ItemInput.partial().extend({ version: z.number().int() });

/** Second unit both ways or neither; a barcode used once per business */
async function checkStockFields(tenantId: string, body: { altUnit?: string | null; altFactor?: number | null; barcode?: string | null }, itemId?: string) {
  if (!!body.altUnit !== !!body.altFactor && (body.altUnit !== undefined || body.altFactor !== undefined)) {
    throw new AppError('VALIDATION_FAILED', 'Give the second unit and how many base units it holds.', { fields: { altFactor: 'Both needed' } });
  }
  if (body.barcode && (await db().item.findFirst({ where: { tenantId, barcode: body.barcode, ...(itemId ? { id: { not: itemId } } : {}) }, select: { name: true } }))) {
    throw new AppError('VALIDATION_FAILED', 'Another item already has this barcode.', { fields: { barcode: 'Already used' } });
  }
}

const ItemList = ListQuery.extend({
  type: z.enum(['product', 'service']).optional(),
  categoryId: z.string().uuid().optional(),
  active: z.enum(['true', 'false', 'all']).default('true'),
});

async function serialize(ctx: TenantCtx, rows: Record<string, unknown>[]) {
  // Tracked items carry how many are in stock, all godowns together
  const stock = await stockByItem(ctx.tenantId, rows.filter((r) => r.trackStock).map((r) => r.id as string));
  const reserved = rows.some((r) => r.trackStock) ? await reservedByItem(ctx.tenantId) : new Map<string, number>();
  const withStock = rows.map((r) => ({
    ...r,
    altFactor: r.altFactor == null ? null : Number(r.altFactor),
    ...(r.trackStock ? { stockQty: stock.get(r.id as string) ?? 0, reservedQty: reserved.get(r.id as string) ?? 0, reorderLevel: r.reorderLevel === null ? null : Number(r.reorderLevel) } : {}),
  }));
  return stripHidden(ctx, 'item', withStock, HIDDEN);
}

async function checkCategory(categoryId?: string | null) {
  if (categoryId && !(await db().itemCategory.findUnique({ where: { id: categoryId } }))) {
    throw new AppError('VALIDATION_FAILED', 'Unknown category.', { fields: { categoryId: 'Unknown category' } });
  }
}

router.get('/items', requirePermission('catalog.item.view'), validate(ItemList, 'query'), tx(async (req, res) => {
  const q = req.query as unknown as z.infer<typeof ItemList>;
  const where: Prisma.ItemWhereInput = {
    type: q.type,
    categoryId: q.categoryId,
    isActive: q.active === 'all' ? undefined : q.active === 'true',
    ...(q.q ? { OR: [{ name: { contains: q.q, mode: 'insensitive' } }, { sku: { contains: q.q, mode: 'insensitive' } }, { hsnSac: { startsWith: q.q } }, { barcode: q.q }] } : {}),
  };
  const rows = await db().item.findMany({ where, ...pageArgs(q) });
  const p = page(rows, q.limit);
  res.json({ ...p, data: await serialize(req.ctx!, p.data) });
}));

router.get('/items/:id', requirePermission('catalog.item.view'), validate(IdParam, 'params'), tx(async (req, res) => {
  const item = await db().item.findUnique({ where: { id: String(req.params.id) } });
  if (!item) throw notFound('Item');
  res.json((await serialize(req.ctx!, [item]))[0]);
}));

router.post('/items', requirePermission('catalog.item.create'), validate(ItemInput), tx(async (req, res) => {
  const ctx = req.ctx!;
  const body = req.body as z.infer<typeof ItemInput>;
  await assertRecordLimit(ctx, 'items', () => db().item.count(), 'products and services');
  await checkCategory(body.categoryId);
  await checkStockFields(ctx.tenantId, body);
  if (body.type === 'service') Object.assign(body, { trackStock: false, tracking: 'none' });
  if (body.costPricePaise != null && !(await canWriteField(ctx, 'item', 'cost_price'))) delete body.costPricePaise;
  const custom = await validateCustom(ctx.tenantId, 'item', body.custom);
  const item = await db().item.create({
    data: { ...body, tenantId: ctx.tenantId, createdBy: ctx.userId, pricePaise: BigInt(body.pricePaise), costPricePaise: body.costPricePaise != null ? BigInt(body.costPricePaise) : null, custom: custom as Prisma.InputJsonValue },
  });
  await markOnboarding(ctx, 'firstItem');
  res.status(201).json((await serialize(ctx, [item]))[0]);
}));

// Variants: one item per combination of the values given, e.g. Size S, M, L × Colour Red, Blue
const VariantInput = z.object({ attributes: z.record(z.array(z.string().trim().min(1).max(40)).min(1).max(20)).refine((a) => Object.keys(a).length >= 1 && Object.keys(a).length <= 3, 'Use 1 to 3 attributes') });
router.post('/items/:id/variants', requirePermission('catalog.item.create'), validate(IdParam, 'params'), validate(VariantInput), tx(async (req, res) => {
  const ctx = req.ctx!;
  const base = await db().item.findUnique({ where: { id: String(req.params.id) } });
  if (!base) throw notFound('Item');
  if (base.type !== 'product') throw new AppError('VALIDATION_FAILED', 'Only products have variants.');
  const attrs = (req.body as z.infer<typeof VariantInput>).attributes;
  let combos: Record<string, string>[] = [{}];
  for (const [k, values] of Object.entries(attrs)) combos = combos.flatMap((c) => [...new Set(values)].map((v) => ({ ...c, [k]: v })));
  if (combos.length > 100) throw new AppError('VALIDATION_FAILED', 'That makes more than 100 variants. Use fewer values.');
  const group = base.variantGroup ?? base.name;
  const existing = new Set((await db().item.findMany({ where: { variantGroup: group }, select: { name: true } })).map((i) => i.name.toLowerCase()));
  await assertRecordLimit(ctx, 'items', () => db().item.count(), 'products and services');
  const created = [];
  for (const combo of combos) {
    const name = `${group} - ${Object.values(combo).join(' / ')}`.slice(0, 160);
    if (existing.has(name.toLowerCase())) continue;
    created.push(await db().item.create({
      data: {
        tenantId: ctx.tenantId, type: 'product', name, categoryId: base.categoryId, unit: base.unit, pricePaise: base.pricePaise, costPricePaise: base.costPricePaise,
        gstRateBp: base.gstRateBp, hsnSac: base.hsnSac, description: base.description, trackStock: base.trackStock, reorderLevel: base.reorderLevel, tracking: base.tracking,
        altUnit: base.altUnit, altFactor: base.altFactor, variantGroup: group, attributes: combo, createdBy: ctx.userId,
      },
    }));
  }
  if (!base.variantGroup) await db().item.update({ where: { id: base.id }, data: { variantGroup: group } });
  await audit({ action: 'catalog.item.create', entity: 'item', entityId: base.id, after: { variants: created.length, group } });
  res.status(201).json({ created: created.length, data: await serialize(ctx, created) });
}));

router.patch('/items/:id', requirePermission('catalog.item.edit'), validate(IdParam, 'params'), validate(ItemPatch), tx(async (req, res) => {
  const ctx = req.ctx!;
  const { version, ...body } = req.body as z.infer<typeof ItemPatch>;
  const item = await db().item.findUnique({ where: { id: String(req.params.id) } });
  if (!item) throw notFound('Item');
  assertVersion(item.version, version, 'item');
  await checkCategory(body.categoryId);
  if (body.trackStock === false && item.trackStock && (await stockByItem(ctx.tenantId, [item.id])).get(item.id)) {
    throw new AppError('CONFLICT', 'This item still has stock. Bring it to zero with an adjustment before you stop tracking it.', { fields: { trackStock: 'Stock is not zero' } });
  }
  if ((body.type ?? item.type) === 'service') Object.assign(body, { trackStock: false, tracking: 'none' });
  await checkStockFields(ctx.tenantId, { altUnit: body.altUnit === undefined ? item.altUnit : body.altUnit, altFactor: body.altFactor === undefined ? (item.altFactor === null ? null : Number(item.altFactor)) : body.altFactor, barcode: body.barcode }, item.id);
  if (body.tracking && body.tracking !== item.tracking && (await stockByItem(ctx.tenantId, [item.id])).get(item.id)) {
    throw new AppError('CONFLICT', 'Batch or serial tracking can change only while the item has no stock.', { fields: { tracking: 'Stock is not zero' } });
  }
  if (body.costPricePaise !== undefined && !(await canWriteField(ctx, 'item', 'cost_price'))) delete body.costPricePaise;
  const custom = body.custom ? await validateCustom(ctx.tenantId, 'item', body.custom, item.custom as Record<string, unknown>) : undefined;
  const updated = await db().item.update({
    where: { id: item.id },
    data: {
      ...body,
      pricePaise: body.pricePaise !== undefined ? BigInt(body.pricePaise) : undefined,
      costPricePaise: body.costPricePaise === undefined ? undefined : body.costPricePaise === null ? null : BigInt(body.costPricePaise),
      custom: custom as Prisma.InputJsonValue | undefined,
      version: { increment: 1 },
    },
  });
  res.json((await serialize(ctx, [updated]))[0]);
}));

/** Items used on documents are never hard-deleted: they are archived. */
router.delete('/items/:id', requirePermission('catalog.item.delete'), validate(IdParam, 'params'), tx(async (req, res) => {
  const item = await db().item.findUnique({ where: { id: String(req.params.id) } });
  if (!item) throw notFound('Item');
  const used = await db().salesDocumentLine.count({ where: { itemId: item.id } });
  if (used) await db().item.update({ where: { id: item.id }, data: { isActive: false, version: { increment: 1 } } });
  else await db().item.delete({ where: { id: item.id } });
  await audit({ action: used ? 'catalog.item.archive' : 'catalog.item.delete', entity: 'item', entityId: item.id, before: { name: item.name } });
  res.status(204).end();
}));

// ── Categories ──

router.get('/item-categories', requirePermission('catalog.category.view'), tx(async (_req, res) => {
  res.json({ data: await db().itemCategory.findMany({ orderBy: { name: 'asc' } }) });
}));

router.post('/item-categories', requirePermission('catalog.category.create'), validate(z.object({ name: z.string().trim().min(1).max(80) })), tx(async (req, res) => {
  res.status(201).json(await db().itemCategory.create({ data: { tenantId: req.ctx!.tenantId, name: req.body.name } }));
}));

router.delete('/item-categories/:id', requirePermission('catalog.category.delete'), validate(IdParam, 'params'), tx(async (req, res) => {
  await db().item.updateMany({ where: { categoryId: String(req.params.id) }, data: { categoryId: null } });
  await db().itemCategory.delete({ where: { id: String(req.params.id) } });
  res.status(204).end();
}));

// Seed the industry template's starter catalogue for a new tenant (CFG-01); runs alongside template application
consumer('catalog.seed-template', 'tenant.created', async (evt) => {
  const template = templateByKey(String(evt.payload.industryKey));
  if (!template?.catalogSeed.length) return;
  if (await db().item.count({ where: { source: 'template' } })) return;
  await db().item.createMany({
    data: template.catalogSeed.map((s) => ({
      tenantId: evt.tenantId!, type: s.type, name: s.name, pricePaise: BigInt(s.pricePaise), gstRateBp: s.gstRateBp,
      hsnSac: s.hsnSac, durationMin: s.durationMin, unit: s.type === 'service' ? 'service' : 'pcs', source: 'template' as const,
    })),
  });
});

// ── CSV import (setup wizard / Settings › Data): the browser parses and maps the file ──
const ItemImportRow = z.object({
  name: z.string().trim().min(1, 'Name is missing').max(160),
  type: z.string().trim().toLowerCase().optional(),
  sku: z.string().trim().max(40).optional(),
  unit: z.string().trim().max(20).optional(),
  price: z.string().trim().optional(),
  gstRate: z.string().trim().optional(),
  hsnSac: z.string().trim().optional(),
  description: z.string().trim().max(2000).optional(),
});

router.post(
  '/items/import',
  requirePermission('catalog.item.create'),
  validate(z.object({ rows: z.array(z.record(z.unknown())).min(1).max(1000), onDuplicate: z.enum(['skip', 'update']).default('skip') })),
  tx(async (req, res) => {
    res.json(await importItems(req.ctx!, req.body));
  }),
);

/** Import rows for one business (used by the ERP and by the Console's onboarding import). */
export async function importItems(ctx: Pick<TenantCtx, 'tenantId' | 'userId'>, input: { rows: Record<string, unknown>[]; onDuplicate: 'skip' | 'update' }) {
    const { rows, onDuplicate } = input;
    const existing = await db().item.findMany({ select: { id: true, name: true, sku: true } });
    const byName = new Map(existing.map((e) => [e.name.trim().toLowerCase(), e.id]));
    const bySku = new Map(existing.filter((e) => e.sku).map((e) => [e.sku!.toLowerCase(), e.id]));
    const result = { created: 0, updated: 0, duplicates: [] as { row: number; name: string; reason: string }[], errors: [] as { row: number; message: string }[] };
    const toCreate: Prisma.ItemCreateManyInput[] = [];
    const toUpdate: { id: string; data: Prisma.ItemUpdateInput }[] = [];
    const seen = new Set<string>();

    rows.forEach((raw, i) => {
      const parsed = ItemImportRow.safeParse(Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, v == null || v === '' ? undefined : String(v)])));
      if (!parsed.success) return result.errors.push({ row: i + 1, message: parsed.error.issues[0].message });
      const r = parsed.data;
      const price = r.price === undefined ? 0 : Number(r.price.replace(/[₹,s]/g, ''));
      if (!Number.isFinite(price) || price < 0) return result.errors.push({ row: i + 1, message: 'Price must be a number' });
      const rate = r.gstRate === undefined ? 18 : Number(r.gstRate.replace('%', ''));
      const rateBp = Math.round(rate * 100);
      if (!(GST_RATES_BP as readonly number[]).includes(rateBp)) return result.errors.push({ row: i + 1, message: 'GST rate must be 0, 0.25, 3, 5, 12, 18 or 28' });
      const hsnProblem = r.hsnSac ? zHsnOrSac.safeParse(r.hsnSac).error?.issues[0]?.message : undefined;
      if (hsnProblem) return result.errors.push({ row: i + 1, message: hsnProblem });
      const type = r.type?.startsWith('serv') ? ('service' as const) : ('product' as const);
      const key = r.sku ? `sku:${r.sku.toLowerCase()}` : `name:${r.name.toLowerCase()}`;
      if (seen.has(key)) return result.duplicates.push({ row: i + 1, name: r.name, reason: 'Repeated in the file' });
      seen.add(key);
      const data = { name: r.name, type, sku: r.sku ?? null, unit: r.unit ?? (type === 'service' ? 'service' : 'pcs'), pricePaise: BigInt(Math.round(price * 100)), gstRateBp: rateBp, hsnSac: r.hsnSac ?? null, description: r.description ?? null };
      const existingId = (r.sku && bySku.get(r.sku.toLowerCase())) || byName.get(r.name.toLowerCase()) || null;
      if (existingId) {
        if (onDuplicate === 'update') return toUpdate.push({ id: existingId, data: { ...data, version: { increment: 1 } } });
        return result.duplicates.push({ row: i + 1, name: r.name, reason: 'Already in your catalogue' });
      }
      toCreate.push({ ...data, tenantId: ctx.tenantId, createdBy: ctx.userId });
    });

    await assertRecordLimit(ctx, 'items', async () => (await db().item.count()) + toCreate.length - 1, 'products and services');
    if (toCreate.length) {
      result.created = (await db().item.createMany({ data: toCreate })).count;
      await markOnboarding(ctx, 'firstItem');
    }
    for (const u of toUpdate) await db().item.update({ where: { id: u.id }, data: u.data });
    result.updated = toUpdate.length;
    await audit({ action: 'catalog.item.import', entity: 'item', after: { onDuplicate, created: result.created, updated: result.updated, duplicates: result.duplicates.length, errors: result.errors.length } });
    return result;
}

// ── Price lists ──

const PriceListInput = z.object({ name: z.string().trim().min(2, 'Use at least 2 characters').max(80), discountBp: z.number().int().min(0).max(10_000).default(0) });

router.get('/price-lists', requirePermission('catalog.price_list.view'), tx(async (_req, res) => {
  const rows = await db().priceList.findMany({ orderBy: { name: 'asc' }, include: { _count: { select: { items: true } } } });
  const customers = await db().contact.groupBy({ by: ['priceListId'], where: { priceListId: { not: null } }, _count: true });
  const counts = new Map(customers.map((c) => [c.priceListId, c._count]));
  res.json({ data: rows.map(({ _count, ...r }) => ({ ...r, itemCount: _count.items, customerCount: counts.get(r.id) ?? 0 })) });
}));
router.post('/price-lists', requirePermission('catalog.price_list.create'), validate(PriceListInput), tx(async (req, res) => {
  const list = await db().priceList.create({ data: { ...req.body, tenantId: req.ctx!.tenantId } });
  await audit({ action: 'catalog.price_list.create', entity: 'price_list', entityId: list.id, after: req.body });
  res.status(201).json(list);
}));
router.patch('/price-lists/:id', requirePermission('catalog.price_list.edit'), validate(IdParam, 'params'), validate(PriceListInput), tx(async (req, res) => {
  const list = await db().priceList.update({ where: { id: String(req.params.id) }, data: req.body });
  await audit({ action: 'catalog.price_list.edit', entity: 'price_list', entityId: list.id, after: req.body });
  res.json(list);
}));
router.delete('/price-lists/:id', requirePermission('catalog.price_list.delete'), validate(IdParam, 'params'), tx(async (req, res) => {
  await db().priceList.delete({ where: { id: String(req.params.id) } });
  await audit({ action: 'catalog.price_list.delete', entity: 'price_list', entityId: String(req.params.id) });
  res.status(204).end();
}));
// Exact prices on a list; an empty price takes the item back to the list's discount
router.get('/price-lists/:id/items', requirePermission('catalog.price_list.view'), validate(IdParam, 'params'), tx(async (req, res) => {
  const rows = await db().priceListItem.findMany({ where: { priceListId: String(req.params.id) } });
  res.json({ data: rows.map((r) => ({ itemId: r.itemId, pricePaise: r.pricePaise })) });
}));
router.put('/price-lists/:id/items/:itemId', requirePermission('catalog.price_list.edit'), validate(z.object({ id: z.string().uuid(), itemId: z.string().uuid() }), 'params'), validate(z.object({ pricePaise: Paise.nullable() })), tx(async (req, res) => {
  const priceListId = String(req.params.id);
  const itemId = String(req.params.itemId);
  if (req.body.pricePaise === null) await db().priceListItem.deleteMany({ where: { priceListId, itemId } });
  else await db().priceListItem.upsert({ where: { priceListId_itemId: { priceListId, itemId } }, create: { tenantId: req.ctx!.tenantId, priceListId, itemId, pricePaise: BigInt(req.body.pricePaise) }, update: { pricePaise: BigInt(req.body.pricePaise) } });
  res.status(204).end();
}));

export default router;
