import { Router } from 'express';
import { z } from 'zod';
import { IdParam } from '../../kernel/query';
import { validate } from '../../middleware/request';
import { requirePermission, tenantAuth, tx } from '../../middleware/auth';
import * as pos from './service';

// POS counter billing (BIL-08): the counter screen, shifts, returns, bills on hold, the counter
// bills and shifts lists, the report and counter setup. A paid feature of Billing.

const router = Router();
router.use(tenantAuth);
const P = (a: 'view' | 'create' | 'edit' | 'approve') => requirePermission(`billing.pos.${a}`);
const id = (req: { params: Record<string, unknown> }) => String(req.params.id);
const Counter = z.object({ counterId: z.string().uuid() });

// ── Setup ──
router.get('/pos/setup', P('edit'), tx(async (req, res) => { res.json(await pos.setup(req.ctx!)); }));
router.post('/pos/counters', P('edit'), validate(pos.CounterInput), tx(async (req, res) => { res.status(201).json(await pos.saveCounter(req.ctx!, null, req.body)); }));
router.patch('/pos/counters/:id', P('edit'), validate(IdParam, 'params'), validate(pos.CounterInput), tx(async (req, res) => { res.json(await pos.saveCounter(req.ctx!, id(req), req.body)); }));

// ── The counter screen ──
router.get('/pos/register', P('view'), tx(async (req, res) => { res.json(await pos.register(req.ctx!)); }));
router.get('/pos/items', P('create'), validate(Counter, 'query'), tx(async (req, res) => { res.json(await pos.counterItems(req.ctx!, String(req.query.counterId))); }));
router.get('/pos/items/:id/serials', P('create'), validate(IdParam, 'params'), validate(Counter, 'query'), tx(async (req, res) => { res.json(await pos.counterSerials(req.ctx!, String(req.query.counterId), id(req))); }));
router.get('/pos/customers', P('create'), validate(z.object({ q: z.string().trim().min(2).max(60) }), 'query'), tx(async (req, res) => { res.json(await pos.findCustomers(req.ctx!, String(req.query.q))); }));
router.post('/pos/customers', P('create'), validate(pos.QuickCustomer), tx(async (req, res) => { res.status(201).json(await pos.quickCustomer(req.ctx!, req.body)); }));
router.post('/pos/sales', P('create'), validate(pos.SaleInput), tx(async (req, res) => { res.status(201).json(await pos.sell(req.ctx!, req.body)); }));
router.get('/pos/receipts/:id', P('view'), validate(IdParam, 'params'), tx(async (req, res) => { res.json(await pos.receipt(req.ctx!, id(req))); }));

// ── Shifts ──
router.post('/pos/shifts', P('create'), validate(pos.OpenInput), tx(async (req, res) => { res.status(201).json(await pos.openShift(req.ctx!, req.body)); }));
router.get('/pos/shifts', P('view'), validate(pos.ShiftList, 'query'), tx(async (req, res) => { res.json(await pos.listShifts(req.ctx!, req.query as unknown as z.infer<typeof pos.ShiftList>)); }));
router.get('/pos/shifts/:id', P('view'), validate(IdParam, 'params'), tx(async (req, res) => { res.json(await pos.shiftSummary(req.ctx!, id(req))); }));
router.post('/pos/shifts/:id/cash', P('create'), validate(IdParam, 'params'), validate(pos.CashMoveInput), tx(async (req, res) => { res.status(201).json(await pos.cashMove(req.ctx!, id(req), req.body)); }));
router.post('/pos/shifts/:id/close', P('create'), validate(IdParam, 'params'), validate(pos.CloseInput), tx(async (req, res) => { res.json(await pos.closeShift(req.ctx!, id(req), req.body)); }));

// ── Returns: goods back and money back need the refund permission ──
router.get('/pos/bills', requirePermission('billing.refund.create'), validate(z.object({ number: z.string().trim().min(1).max(30) }), 'query'), tx(async (req, res) => { res.json(await pos.findBill(req.ctx!, String(req.query.number))); }));
router.post('/pos/returns', requirePermission('billing.refund.create'), validate(pos.ReturnInput), tx(async (req, res) => { res.status(201).json(await pos.returnSale(req.ctx!, req.body)); }));

// ── Bills on hold ──
router.get('/pos/held', P('create'), validate(Counter, 'query'), tx(async (req, res) => { res.json(await pos.listHeld(req.ctx!, String(req.query.counterId))); }));
router.post('/pos/held', P('create'), validate(pos.HoldInput), tx(async (req, res) => { res.status(201).json(await pos.hold(req.ctx!, req.body)); }));
router.delete('/pos/held/:id', P('create'), validate(IdParam, 'params'), tx(async (req, res) => { await pos.dropHeld(req.ctx!, id(req)); res.status(204).end(); }));

// ── Lists and report ──
router.get('/pos/sales', P('view'), validate(pos.SalesList, 'query'), tx(async (req, res) => { res.json(await pos.listSales(req.ctx!, req.query as unknown as z.infer<typeof pos.SalesList>)); }));
router.get('/pos/report', P('view'), validate(pos.ReportQuery, 'query'), tx(async (req, res) => { res.json(await pos.report(req.ctx!, req.query as unknown as z.infer<typeof pos.ReportQuery>)); }));

export default router;
