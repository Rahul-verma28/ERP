import { Router } from 'express';
import type { z } from 'zod';
import { IdParam } from '../../kernel/query';
import { validate } from '../../middleware/request';
import { requirePermission, tenantAuth, tx } from '../../middleware/auth';
import * as inventory from './service';

const router = Router();
router.use(tenantAuth);

// Godowns
router.get('/stock-locations', requirePermission('inventory.stock.view'), tx(async (req, res) => {
  res.json(await inventory.listLocations(req.ctx!));
}));
router.post('/stock-locations', requirePermission('inventory.warehouse.create'), validate(inventory.LocationInput), tx(async (req, res) => {
  res.status(201).json(await inventory.createLocation(req.ctx!, req.body));
}));
router.patch('/stock-locations/:id', requirePermission('inventory.warehouse.edit'), validate(IdParam, 'params'), validate(inventory.LocationPatch), tx(async (req, res) => {
  res.json(await inventory.updateLocation(req.ctx!, String(req.params.id), req.body));
}));

// Stock list and one item's ledger
router.get('/stock', requirePermission('inventory.stock.view'), validate(inventory.StockQuery, 'query'), tx(async (req, res) => {
  res.json(await inventory.stockSummary(req.ctx!, req.query as z.infer<typeof inventory.StockQuery>));
}));
router.get('/stock/items/:id', requirePermission('inventory.stock.view'), validate(IdParam, 'params'), validate(inventory.LedgerQuery, 'query'), tx(async (req, res) => {
  res.json(await inventory.itemLedger(req.ctx!, String(req.params.id), req.query as z.infer<typeof inventory.LedgerQuery>));
}));

// Entries made by hand. Each kind has its own permission.
const ENTRY_PERMISSION = { opening: 'inventory.receipt.create', stock_in: 'inventory.receipt.create', adjustment: 'inventory.stock_adjustment.create', transfer: 'inventory.transfer.create' } as const;
const byKind = Object.fromEntries(Object.entries(ENTRY_PERMISSION).map(([k, p]) => [k, requirePermission(p)]));
router.get('/stock/entries', requirePermission('inventory.stock.view'), validate(inventory.EntryList, 'query'), tx(async (req, res) => {
  res.json(await inventory.listEntries(req.ctx!, req.query as unknown as z.infer<typeof inventory.EntryList>));
}));
router.get('/stock/entries/:id', requirePermission('inventory.stock.view'), validate(IdParam, 'params'), tx(async (req, res) => {
  res.json(await inventory.getEntry(req.ctx!, String(req.params.id)));
}));
router.post(
  '/stock/entries',
  validate(inventory.EntryInput),
  (req, res, next) => byKind[(req.body as { kind: keyof typeof ENTRY_PERMISSION }).kind](req, res, next),
  tx(async (req, res) => {
    res.status(201).json(await inventory.postEntry(req.ctx!, req.body));
  }),
);
router.post('/stock/counts', requirePermission('inventory.stock_count.create'), validate(inventory.CountInput), tx(async (req, res) => {
  res.status(201).json(await inventory.postCount(req.ctx!, req.body));
}));

export default router;
