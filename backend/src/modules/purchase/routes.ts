import { Router, type NextFunction, type Request, type Response } from 'express';
import { prisma } from '../../kernel/db';
import { AppError, notFound } from '../../kernel/errors';
import { z } from 'zod';
import { IdParam } from '../../kernel/query';
import { validate } from '../../middleware/request';
import { requirePermission, tenantAuth, tx } from '../../middleware/auth';
import * as purchase from './service';
import * as payments from './payments';
import * as reports from './reports';

// Purchase lives under the Inventory module and its permissions:
// suppliers inventory.supplier.*, orders inventory.purchase_order.*, GRNs inventory.receipt.*,
// bills, returns and payments inventory.supplier_bill.create, cancelling a bill or payment .approve.

const router = Router();
router.use(tenantAuth);

// Suppliers
router.get('/suppliers', requirePermission('inventory.supplier.view'), validate(purchase.SupplierList, 'query'), tx(async (req, res) => {
  res.json(await purchase.listSuppliers(req.ctx!, req.query as unknown as z.infer<typeof purchase.SupplierList>));
}));
router.post('/suppliers', requirePermission('inventory.supplier.create'), validate(purchase.SupplierInput.required({ stateCode: true })), tx(async (req, res) => {
  res.status(201).json(await purchase.createSupplier(req.ctx!, req.body));
}));
router.get('/suppliers/:id', requirePermission('inventory.supplier.view'), validate(IdParam, 'params'), tx(async (req, res) => {
  res.json(await purchase.getSupplier(req.ctx!, String(req.params.id)));
}));
router.patch('/suppliers/:id', requirePermission('inventory.supplier.edit'), validate(IdParam, 'params'), validate(purchase.SupplierPatch), tx(async (req, res) => {
  res.json(await purchase.updateSupplier(req.ctx!, String(req.params.id), req.body));
}));
router.get('/suppliers/:id/ledger', requirePermission('inventory.supplier_bill.view'), validate(IdParam, 'params'), tx(async (req, res) => {
  const q = req.query as Record<string, string | undefined>;
  res.json(await reports.supplierLedger(req.ctx!, String(req.params.id), { from: q.from, to: q.to }));
}));

// Reports (before /purchases/:id)
router.get('/purchases/payables', requirePermission('inventory.supplier_bill.view'), tx(async (req, res) => {
  res.json(await reports.payables(req.ctx!));
}));
router.get('/purchases/register', requirePermission('inventory.supplier_bill.view'), validate(reports.RangeQuery, 'query'), tx(async (req, res) => {
  res.json(await reports.purchaseRegister(req.ctx!, req.query as z.infer<typeof reports.RangeQuery>));
}));
router.get('/purchases/itc', requirePermission('inventory.supplier_bill.view'), validate(reports.RangeQuery, 'query'), tx(async (req, res) => {
  res.json(await reports.itcRegister(req.ctx!, req.query as z.infer<typeof reports.RangeQuery>));
}));
router.get('/purchases/pending', requirePermission('inventory.purchase_order.view'), tx(async (req, res) => {
  res.json(await reports.pendingOrders(req.ctx!));
}));
router.get('/purchases/reorder', requirePermission('inventory.purchase_order.view'), tx(async (req, res) => {
  res.json(await reports.reorderList(req.ctx!));
}));
router.post('/purchases/reorder', requirePermission('inventory.purchase_order.create'), validate(reports.DraftOrdersInput), tx(async (req, res) => {
  res.status(201).json(await reports.ordersFromReorder(req.ctx!, req.body));
}));

// Documents. Each kind has its own permission.
const KIND = z.object({ kind: z.enum(['purchase_order', 'goods_receipt', 'purchase_bill', 'purchase_return']) });
const PERM: Record<purchase.PurchaseKind, { view: string; create: string; cancel: string }> = {
  purchase_order: { view: 'inventory.purchase_order.view', create: 'inventory.purchase_order.create', cancel: 'inventory.purchase_order.delete' },
  goods_receipt: { view: 'inventory.receipt.view', create: 'inventory.receipt.create', cancel: 'inventory.receipt.create' },
  purchase_bill: { view: 'inventory.supplier_bill.view', create: 'inventory.supplier_bill.create', cancel: 'inventory.supplier_bill.approve' },
  purchase_return: { view: 'inventory.supplier_bill.view', create: 'inventory.supplier_bill.create', cancel: 'inventory.supplier_bill.approve' },
};
const checks = Object.fromEntries(Object.entries(PERM).map(([k, p]) => [k, { view: requirePermission(p.view), create: requirePermission(p.create), cancel: requirePermission(p.cancel) }]));
const byKind = (action: 'view' | 'create' | 'cancel', from: 'query' | 'body' | 'doc') => async (req: Request, res: Response, next: NextFunction) => {
  let kind: string | undefined;
  if (from === 'doc') {
    // Kind of an existing document, read before the transaction
    kind = (await prisma.purchaseDocument.findFirst({ where: { id: String(req.params.id), tenantId: req.ctx!.tenantId }, select: { kind: true } }))?.kind;
    if (!kind) return next(notFound('Purchase document'));
  } else {
    kind = String((from === 'query' ? req.query.kind : (req.body as { kind?: string }).kind) ?? '');
  }
  const c = checks[kind];
  if (!c) return next(new AppError('VALIDATION_FAILED', 'Unknown document kind.', { fields: { kind: 'Unknown' } }));
  return c[action](req, res, next);
};

router.get('/purchases', validate(purchase.PurchaseList, 'query'), byKind('view', 'query'), tx(async (req, res) => {
  res.json(await purchase.listPurchases(req.ctx!, req.query as unknown as z.infer<typeof purchase.PurchaseList>));
}));
router.post('/purchases', validate(purchase.PurchaseInput.extend({ ...KIND.shape, draft: z.boolean().optional() })), byKind('create', 'body'), tx(async (req, res) => {
  const { kind, draft, ...input } = req.body as purchase.PurchaseInput & { kind: purchase.PurchaseKind; draft?: boolean };
  res.status(201).json(await purchase.createPurchase(req.ctx!, kind, purchase.PurchaseInput.parse(input), { draft }));
}));
router.put('/purchases/:id/draft', requirePermission('inventory.supplier_bill.create'), validate(IdParam, 'params'), validate(purchase.PurchaseInput.extend({ version: z.number().int(), post: z.boolean().optional() })), tx(async (req, res) => {
  const { version, post, ...input } = req.body as purchase.PurchaseInput & { version: number; post?: boolean };
  res.json(await purchase.updateBillDraft(req.ctx!, String(req.params.id), input, version, post));
}));
router.post('/purchases/:id/post', requirePermission('inventory.supplier_bill.create'), validate(IdParam, 'params'), validate(z.object({ version: z.number().int() })), tx(async (req, res) => {
  res.json(await purchase.postBill(req.ctx!, String(req.params.id), req.body.version));
}));
router.post('/purchases/:id/approve', requirePermission('inventory.supplier_bill.approve'), validate(IdParam, 'params'), validate(z.object({ version: z.number().int() })), tx(async (req, res) => {
  res.json(await purchase.approveReturn(req.ctx!, String(req.params.id), req.body.version));
}));
router.post('/purchases/:id/complete', requirePermission('inventory.supplier_bill.create'), validate(IdParam, 'params'), validate(z.object({ version: z.number().int() })), tx(async (req, res) => {
  res.json(await purchase.completeReturn(req.ctx!, String(req.params.id), req.body.version));
}));
router.delete('/purchases/:id', requirePermission('inventory.supplier_bill.create'), validate(IdParam, 'params'), tx(async (req, res) => {
  await purchase.deleteBillDraft(req.ctx!, String(req.params.id));
  res.status(204).end();
}));
router.get('/purchases/:id', validate(IdParam, 'params'), byKind('view', 'doc'), tx(async (req, res) => {
  res.json(await purchase.purchaseView(req.ctx!, String(req.params.id)));
}));
router.put('/purchases/:id', requirePermission('inventory.purchase_order.edit'), validate(IdParam, 'params'), validate(purchase.PurchaseInput.extend({ version: z.number().int() })), tx(async (req, res) => {
  const { version, ...input } = req.body as purchase.PurchaseInput & { version: number };
  res.json(await purchase.updateOrder(req.ctx!, String(req.params.id), input, version));
}));
router.post('/purchases/:id/cancel', validate(IdParam, 'params'), validate(z.object({ reason: z.string().trim().min(3, 'Say why').max(300) })), byKind('cancel', 'doc'), tx(async (req, res) => {
  res.json(await purchase.cancelPurchase(req.ctx!, String(req.params.id), req.body.reason));
}));
router.post('/purchases/:id/close', requirePermission('inventory.purchase_order.edit'), validate(IdParam, 'params'), tx(async (req, res) => {
  res.json(await purchase.closeOrder(req.ctx!, String(req.params.id)));
}));
router.post('/purchases/:id/payments', requirePermission('inventory.supplier_bill.create'), validate(IdParam, 'params'), validate(purchase.SupplierPaymentInput), tx(async (req, res) => {
  res.status(201).json(await purchase.paySupplier(req.ctx!, String(req.params.id), req.body));
}));
// ── Payments made: one payment over a supplier's open invoices ──
router.get('/payments-made', requirePermission('inventory.supplier_bill.view'), validate(payments.PaymentList, 'query'), tx(async (req, res) => {
  res.json(await payments.listSupplierPayments(req.ctx!, req.query as unknown as z.infer<typeof payments.PaymentList>));
}));
router.get('/payments-made/:id', requirePermission('inventory.supplier_bill.view'), validate(IdParam, 'params'), tx(async (req, res) => {
  res.json(await payments.getSupplierPayment(req.ctx!, String(req.params.id)));
}));
router.post('/payments-made', requirePermission('inventory.supplier_bill.create'), validate(payments.PayInput), tx(async (req, res) => {
  res.status(201).json(await payments.paySuppliers(req.ctx!, req.body));
}));
router.post('/payments-made/:id/reverse', requirePermission('inventory.supplier_bill.approve'), validate(IdParam, 'params'), tx(async (req, res) => {
  res.json(await payments.reverseSupplierPaymentGroup(req.ctx!, String(req.params.id)));
}));
router.get('/suppliers/:id/open-bills', requirePermission('inventory.supplier_bill.create'), validate(IdParam, 'params'), tx(async (req, res) => {
  res.json({ data: await payments.openSupplierBills(req.ctx!, String(req.params.id)) });
}));
router.post('/supplier-payments/:id/reverse', requirePermission('inventory.supplier_bill.approve'), validate(IdParam, 'params'), tx(async (req, res) => {
  res.json(await purchase.reverseSupplierPayment(req.ctx!, String(req.params.id)));
}));

export default router;
