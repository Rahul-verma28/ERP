import { Router } from 'express';
import { z } from 'zod';
import type { Prisma, SalesDocKind } from '@prisma/client';
import { db, withPlatform } from '../../kernel/db';
import { AppError } from '../../kernel/errors';
import { randomToken } from '../../kernel/crypto';
import { DateStr, IdParam, ListQuery, page, pageArgs, scopeWhere } from '../../kernel/query';
import { validate } from '../../middleware/request';
import { publicRoute, requirePermission, tenantAuth, tx } from '../../middleware/auth';
import { publicLimiter } from '../../middleware/rateLimit';
import { audit } from '../audit/service';
import { todayIST } from '../../kernel/gst';
import * as billing from './service';
import * as creditNotes from './creditNotes';
import * as ledger from './ledger';
import * as orders from './orders';
import { sendOverdueReminders } from '../tenancy/messages';

// Quotations (sales module) and GST invoices + receipts (billing module).

export const publicBilling = Router();
publicBilling.get('/public/documents/:token', publicRoute, publicLimiter, async (req, res) => {
  res.json(await withPlatform(() => billing.publicDocument(String(req.params.token))));
});

const router = Router();
router.use(tenantAuth);

const DocList = ListQuery.extend({
  status: z.string().max(20).optional(),
  contactId: z.string().uuid().optional(),
  from: DateStr.optional(),
  to: DateStr.optional(),
  unpaid: z.enum(['true', 'false']).optional(),
  overdue: z.enum(['true', 'false']).optional(),
  /** Credit notes of one invoice */
  sourceId: z.string().uuid().optional(),
  /** Include the number of matching rows ("Showing 1–25 of 64") */
  withTotal: z.enum(['1']).optional(),
});

const OPEN: Prisma.SalesDocumentWhereInput = { status: { in: ['issued', 'partially_paid'] } };
const overdueWhere = (): Prisma.SalesDocumentWhereInput => ({ ...OPEN, dueDate: { lt: new Date(`${todayIST()}T00:00:00Z`) } });

const SUMMARY_SELECT = {
  id: true, kind: true, status: true, number: true, contactId: true, buyer: true, issueDate: true, dueDate: true,
  totalPaise: true, paidPaise: true, createdAt: true, createdBy: true, branchId: true, noteType: true, sourceId: true, sourceNumber: true,
} satisfies Prisma.SalesDocumentSelect;

function registerReadRoutes(kind: SalesDocKind, base: string, module: 'sales.quotation' | 'billing.invoice' | 'billing.credit_note' | 'sales.order' | 'sales.delivery') {
  router.get(base, requirePermission(`${module}.view`), validate(DocList, 'query'), tx(async (req, res) => {
    const q = req.query as unknown as z.infer<typeof DocList>;
    const where: Prisma.SalesDocumentWhereInput = {
      AND: [
        { kind },
        scopeWhere(req.ctx!, billing.SCOPE_FIELDS),
        q.status ? { status: q.status as Prisma.EnumSalesDocStatusFilter['equals'] } : {},
        q.unpaid === 'true' ? OPEN : {},
        q.overdue === 'true' ? overdueWhere() : {},
        q.contactId ? { contactId: q.contactId } : {},
        q.sourceId ? { sourceId: q.sourceId } : {},
        q.from || q.to ? { issueDate: { gte: q.from ? new Date(q.from) : undefined, lte: q.to ? new Date(q.to) : undefined } } : {},
        q.q
          ? {
              OR: [
                { number: { contains: q.q, mode: 'insensitive' } },
                { buyer: { path: ['name'], string_contains: q.q } },
                { buyer: { path: ['phone'], string_contains: q.q.replace(/\s/g, '') } },
                { buyer: { path: ['gstin'], string_contains: q.q.toUpperCase() } },
              ],
            }
          : {},
      ],
    };
    const [rows, total] = await Promise.all([
      db().salesDocument.findMany({ where, select: SUMMARY_SELECT, ...pageArgs(q) }),
      q.withTotal ? db().salesDocument.count({ where }) : Promise.resolve(undefined),
    ]);
    res.json({ ...page(rows, q.limit), ...(total !== undefined ? { total } : {}) });
  }));

  // Tab counts on the list page (All · 64, Overdue · 18 …), within the user's scope
  router.get(`${base}/counts`, requirePermission(`${module}.view`), tx(async (req, res) => {
    const scope = scopeWhere(req.ctx!, billing.SCOPE_FIELDS);
    const [byStatus, overdue] = await Promise.all([
      db().salesDocument.groupBy({ by: ['status'], where: { AND: [{ kind }, scope] }, _count: { _all: true } }),
      kind === 'invoice' ? db().salesDocument.count({ where: { AND: [{ kind }, scope, overdueWhere()] } }) : Promise.resolve(0),
    ]);
    const counts: Record<string, number> = { all: 0, unpaid: 0, overdue };
    for (const g of byStatus) {
      counts[g.status] = g._count._all;
      counts.all += g._count._all;
      if (g.status === 'issued' || g.status === 'partially_paid') counts.unpaid += g._count._all;
    }
    res.json(counts);
  }));

  router.get(`${base}/:id`, requirePermission(`${module}.view`), validate(IdParam, 'params'), tx(async (req, res) => {
    res.json(await billing.getDocument(req.ctx!, String(req.params.id), kind));
  }));
}

function registerDocRoutes(kind: 'invoice' | 'quotation' | 'sales_order' | 'delivery_challan', base: string, module: 'sales.quotation' | 'billing.invoice' | 'sales.order' | 'sales.delivery') {
  registerReadRoutes(kind, base, module);

  router.post(base, requirePermission(`${module}.create`), validate(billing.DocInput.extend({ issue: z.boolean().default(false) })), tx(async (req, res) => {
    const { issue, ...input } = req.body as billing.DocInput & { issue: boolean };
    res.status(201).json(await billing.createDocument(req.ctx!, kind, input, { issue }));
  }));

  router.put(`${base}/:id`, requirePermission(`${module}.edit`), validate(IdParam, 'params'), validate(billing.DocInput.extend({ version: z.number().int() })), tx(async (req, res) => {
    const { version, ...input } = req.body as billing.DocInput & { version: number };
    res.json(await billing.updateDocument(req.ctx!, String(req.params.id), kind, input, version));
  }));

  // Drafts can be discarded; issued invoices never are (BIL-02/BIL-04)
  router.delete(`${base}/:id`, requirePermission(`${module}.edit`), validate(IdParam, 'params'), tx(async (req, res) => {
    const doc = await billing.getDocument(req.ctx!, String(req.params.id), kind);
    if (doc.status !== 'draft') throw new AppError('CONFLICT', 'Only drafts can be deleted.');
    await db().salesDocumentLine.deleteMany({ where: { documentId: doc.id } });
    await db().salesDocument.delete({ where: { id: doc.id } });
    if (doc.sourceType === 'sales_order' && doc.sourceId) await billing.refreshOrderStatus(doc.sourceId);
    if (doc.sourceType === 'delivery_challan' && doc.sourceId) await billing.reopenChallan(doc.sourceId);
    await audit({ action: `${module}.delete_draft`, entity: kind, entityId: doc.id, before: { number: doc.number } });
    res.status(204).end();
  }));
}

registerDocRoutes('quotation', '/quotations', 'sales.quotation');
registerDocRoutes('invoice', '/invoices', 'billing.invoice');
registerDocRoutes('sales_order', '/sales-orders', 'sales.order');
registerDocRoutes('delivery_challan', '/delivery-challans', 'sales.delivery');
registerReadRoutes('debit_note', '/debit-notes', 'billing.credit_note');
registerReadRoutes('credit_note', '/credit-notes', 'billing.credit_note');

// ── Quotation lifecycle ──
router.post(
  '/quotations/:id/status',
  requirePermission('sales.quotation.edit'),
  validate(IdParam, 'params'),
  validate(z.object({ status: z.enum(['sent', 'accepted', 'declined']) })),
  tx(async (req, res) => {
    const q = await billing.getDocument(req.ctx!, String(req.params.id), 'quotation');
    if (q.status === 'converted') throw new AppError('CONFLICT', 'This quotation is already converted.');
    await db().salesDocument.update({
      where: { id: q.id },
      data: { status: req.body.status, shareToken: q.shareToken ?? randomToken(18), version: { increment: 1 } },
    });
    res.json(await billing.getDocument(req.ctx!, q.id, 'quotation'));
  }),
);

router.post('/quotations/:id/convert', requirePermission('billing.invoice.create'), validate(IdParam, 'params'), tx(async (req, res) => {
  res.status(201).json(await billing.convertQuotation(req.ctx!, String(req.params.id)));
}));

router.post('/quotations/:id/convert-order', requirePermission('sales.order.create'), validate(IdParam, 'params'), tx(async (req, res) => {
  res.status(201).json(await billing.convertQuotation(req.ctx!, String(req.params.id), 'sales_order'));
}));

// ── Sales orders ──
router.get('/sales-orders/:id/open-lines', requirePermission('sales.order.view'), validate(IdParam, 'params'), tx(async (req, res) => {
  res.json(await orders.orderLines(req.ctx!, String(req.params.id)));
}));
router.post('/sales-orders/:id/invoice', requirePermission('billing.invoice.create'), validate(IdParam, 'params'), validate(orders.OrderInvoiceInput), tx(async (req, res) => {
  res.status(201).json(await orders.invoiceFromOrder(req.ctx!, String(req.params.id), req.body));
}));
router.post('/sales-orders/:id/cancel', requirePermission('sales.order.edit'), validate(IdParam, 'params'), validate(z.object({ reason: z.string().trim().min(3).max(300) })), tx(async (req, res) => {
  res.json(await orders.cancelOrder(req.ctx!, String(req.params.id), req.body.reason));
}));

// ── Delivery challans ──
router.post('/sales-orders/:id/challan', requirePermission('sales.delivery.create'), validate(IdParam, 'params'), validate(orders.OrderInvoiceInput), tx(async (req, res) => {
  res.status(201).json(await orders.invoiceFromOrder(req.ctx!, String(req.params.id), req.body, 'delivery_challan'));
}));
router.post('/delivery-challans/:id/invoice', requirePermission('billing.invoice.create'), validate(IdParam, 'params'), tx(async (req, res) => {
  res.status(201).json(await orders.invoiceFromChallan(req.ctx!, String(req.params.id)));
}));
router.post('/delivery-challans/:id/cancel', requirePermission('sales.delivery.edit'), validate(IdParam, 'params'), validate(z.object({ reason: z.string().trim().min(3).max(300) })), tx(async (req, res) => {
  res.json(await orders.cancelChallan(req.ctx!, String(req.params.id), req.body.reason));
}));

// ── Invoice lifecycle ──
router.post(
  '/invoices/cash-bill',
  requirePermission('billing.payment.create'),
  requirePermission('billing.invoice.create'),
  validate(billing.DocInput.extend({ receive: z.object({ method: billing.PaymentInput.shape.method, reference: z.string().trim().max(100).optional().nullable() }) })),
  tx(async (req, res) => {
    const { receive, ...input } = req.body as billing.DocInput & { receive: { method: 'cash'; reference?: string | null } };
    res.status(201).json(await billing.createCashBill(req.ctx!, input, receive));
  }),
);
router.post('/invoices/:id/issue', requirePermission('billing.invoice.create'), validate(IdParam, 'params'), tx(async (req, res) => {
  res.json(await billing.issueInvoice(req.ctx!, String(req.params.id)));
}));
// Someone allowed to approve can go over a customer's credit limit
router.post('/invoices/:id/issue-over-limit', requirePermission('billing.invoice.create'), requirePermission('billing.invoice.approve'), validate(IdParam, 'params'), tx(async (req, res) => {
  const invoice = await billing.issueInvoice(req.ctx!, String(req.params.id), { skipCreditLimit: true });
  await audit({ action: 'billing.invoice.over_credit_limit', entity: 'invoice', entityId: invoice.id, after: { number: invoice.number, totalPaise: invoice.totalPaise } });
  res.json(invoice);
}));

router.post(
  '/invoices/:id/cancel',
  requirePermission('billing.invoice.approve'),
  validate(IdParam, 'params'),
  validate(z.object({ reason: z.string().trim().min(3).max(300) })),
  tx(async (req, res) => {
    res.json(await billing.cancelInvoice(req.ctx!, String(req.params.id), req.body.reason));
  }),
);

// Overdue reminders from the dashboard and the dues list (Invoice overdue template)
router.post('/invoices/remind', requirePermission('billing.invoice.edit'), validate(z.object({ ids: z.array(z.string().uuid()).min(1, 'Choose at least one invoice').max(100) })), tx(async (req, res) => {
  // Only invoices inside the person's scope
  const allowed = await db().salesDocument.findMany({ where: { AND: [{ id: { in: req.body.ids } }, scopeWhere(req.ctx!, { owner: ['createdBy'], branch: 'branchId' })] }, select: { id: true } });
  res.json(await sendOverdueReminders(req.ctx!.tenantId, allowed.map((d) => d.id)));
}));
router.post('/invoices/:id/payments', requirePermission('billing.payment.create'), validate(IdParam, 'params'), validate(billing.PaymentInput), tx(async (req, res) => {
  res.status(201).json(await billing.recordPayment(req.ctx!, String(req.params.id), req.body));
}));
// ── Customer ledger and opening balance ──
router.get('/customers/:id/ledger', requirePermission('billing.dues.view'), validate(IdParam, 'params'), validate(z.object({ from: DateStr.optional(), to: DateStr.optional() }), 'query'), tx(async (req, res) => {
  const q = req.query as { from?: string; to?: string };
  res.json(await ledger.customerLedger(req.ctx!, String(req.params.id), q));
}));
router.put('/customers/:id/opening-balance', requirePermission('billing.invoice.approve'), validate(IdParam, 'params'), validate(ledger.OpeningBalanceInput), tx(async (req, res) => {
  res.json(await ledger.setOpeningBalance(req.ctx!, String(req.params.id), req.body));
}));
router.delete('/customers/:id/opening-balance', requirePermission('billing.invoice.approve'), validate(IdParam, 'params'), tx(async (req, res) => {
  await ledger.removeOpeningBalance(req.ctx!, String(req.params.id));
  res.status(204).end();
}));
router.post('/opening-balances/:id/payments', requirePermission('billing.payment.create'), validate(IdParam, 'params'), validate(billing.PaymentInput), tx(async (req, res) => {
  res.status(201).json(await billing.recordPayment(req.ctx!, String(req.params.id), req.body, 'opening_balance'));
}));

// ── Debit notes ──
router.post('/invoices/:id/debit-notes', requirePermission('billing.credit_note.create'), validate(IdParam, 'params'), validate(creditNotes.DebitNoteInput), tx(async (req, res) => {
  res.status(201).json(await creditNotes.createDebitNote(req.ctx!, String(req.params.id), req.body));
}));
router.post('/debit-notes/:id/cancel', requirePermission('billing.credit_note.approve'), validate(IdParam, 'params'), validate(z.object({ reason: z.string().trim().min(3).max(300) })), tx(async (req, res) => {
  res.json(await creditNotes.cancelDebitNote(req.ctx!, String(req.params.id), req.body.reason));
}));
router.post('/debit-notes/:id/payments', requirePermission('billing.payment.create'), validate(IdParam, 'params'), validate(billing.PaymentInput), tx(async (req, res) => {
  res.status(201).json(await billing.recordPayment(req.ctx!, String(req.params.id), req.body, 'debit_note'));
}));

// ── Credit notes and sales returns ──
router.get('/invoices/:id/credit-note-lines', requirePermission('billing.credit_note.create'), validate(IdParam, 'params'), tx(async (req, res) => {
  res.json((await creditNotes.creditableLines(req.ctx!, String(req.params.id))).map(({ line, quantityLeft, taxableLeftPaise }) => ({ ...line, quantityLeft, taxableLeftPaise })));
}));
router.post('/invoices/:id/credit-notes', requirePermission('billing.credit_note.create'), validate(IdParam, 'params'), validate(creditNotes.CreditNoteInput), tx(async (req, res) => {
  res.status(201).json(await creditNotes.createCreditNote(req.ctx!, String(req.params.id), req.body));
}));
router.post('/credit-notes/:id/cancel', requirePermission('billing.credit_note.approve'), validate(IdParam, 'params'), validate(z.object({ reason: z.string().trim().min(3).max(300) })), tx(async (req, res) => {
  res.json(await creditNotes.cancelCreditNote(req.ctx!, String(req.params.id), req.body.reason));
}));
router.post('/credit-notes/:id/refund', requirePermission('billing.refund.create'), validate(IdParam, 'params'), validate(billing.PaymentInput), tx(async (req, res) => {
  res.status(201).json(await creditNotes.refundCreditNote(req.ctx!, String(req.params.id), req.body));
}));

router.post('/payments/:id/reverse', requirePermission('billing.payment.approve'), validate(IdParam, 'params'), tx(async (req, res) => {
  res.json({ invoice: await billing.reversePayment(req.ctx!, String(req.params.id)) });
}));

// ── Advances ──
router.get('/advances', requirePermission('billing.payment.view'), validate(z.object({ contactId: z.string().uuid() }), 'query'), tx(async (req, res) => {
  res.json(await billing.listAdvances(req.ctx!, String(req.query.contactId)));
}));
router.post('/advances', requirePermission('billing.payment.create'), validate(billing.AdvanceInput), tx(async (req, res) => {
  res.status(201).json(await billing.recordAdvance(req.ctx!, req.body));
}));
router.post('/invoices/:id/advances', requirePermission('billing.payment.create'), validate(IdParam, 'params'), validate(billing.UseAdvanceInput), tx(async (req, res) => {
  res.status(201).json(await billing.useAdvance(req.ctx!, String(req.params.id), req.body));
}));
router.post('/advance-adjustments/:id/reverse', requirePermission('billing.payment.approve'), validate(IdParam, 'params'), tx(async (req, res) => {
  res.json(await billing.removeAdvanceUse(req.ctx!, String(req.params.id)));
}));

router.get(
  '/payments',
  requirePermission('billing.payment.view'),
  validate(ListQuery.extend({ from: DateStr.optional(), to: DateStr.optional() }), 'query'),
  tx(async (req, res) => {
    const q = req.query as unknown as z.infer<typeof ListQuery> & { from?: string; to?: string };
    const rows = await db().payment.findMany({
      where: { AND: [scopeWhere(req.ctx!, { owner: ['createdBy'] }), q.from || q.to ? { paidOn: { gte: q.from ? new Date(q.from) : undefined, lte: q.to ? new Date(q.to) : undefined } } : {}] },
      include: { document: { select: { id: true, number: true, buyer: true } } },
      ...pageArgs(q),
    });
    res.json(page(rows, q.limit));
  }),
);

export default router;
