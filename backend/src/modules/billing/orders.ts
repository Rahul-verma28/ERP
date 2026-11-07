import { z } from 'zod';
import { db } from '../../kernel/db';
import { AppError } from '../../kernel/errors';
import type { TenantCtx } from '../../kernel/context';
import { divRound } from '../../kernel/gst';
import { audit } from '../audit/service';
import { createDocument, getDocument, refreshOrderStatus, type DocInput } from './service';
import { reverseSource } from '../inventory/engine';

// Sales orders: take the order now, invoice it later, in one go or in parts.

const milli = (q: unknown) => BigInt(Math.round(Number(q) * 1000));

/** Each order line with how much is on invoices and challans (drafts count) and how much is left. */
export async function orderLines(ctx: TenantCtx, orderId: string) {
  const order = await getDocument(ctx, orderId, 'sales_order');
  const invoiced = await db().salesDocumentLine.findMany({
    where: { sourceLineId: { in: order.lines.map((l) => l.id) }, document: { kind: { in: ['invoice', 'delivery_challan'] }, status: { not: 'cancelled' } } },
    select: { sourceLineId: true, quantity: true },
  });
  return order.lines.map((line) => {
    const done = invoiced.filter((i) => i.sourceLineId === line.id).reduce((s, i) => s + milli(i.quantity), 0n);
    const left = milli(line.quantity) - done;
    return { ...line, quantityInvoiced: Number(done) / 1000, quantityLeft: Number(left > 0n ? left : 0n) / 1000 };
  });
}

export const OrderInvoiceInput = z.object({
  lines: z.array(z.object({ sourceLineId: z.string().uuid(), quantity: z.number().positive('Quantity must be more than 0').max(1e7) })).min(1, 'Choose at least one line').max(200),
});

/** Make a draft invoice, or a challan for goods going out, for part or all of an order. */
export async function invoiceFromOrder(ctx: TenantCtx, orderId: string, input: z.infer<typeof OrderInvoiceInput>, target: 'invoice' | 'delivery_challan' = 'invoice') {
  const order = await getDocument(ctx, orderId, 'sales_order');
  if (!['open', 'part_invoiced'].includes(order.status)) throw new AppError('CONFLICT', 'This order is already completed or cancelled.');
  const open = new Map((await orderLines(ctx, orderId)).map((l) => [l.id, l]));
  const seen = new Set<string>();
  const lines: DocInput['lines'] = input.lines.map((want, i) => {
    const line = open.get(want.sourceLineId);
    const refuse = (message: string) => new AppError('VALIDATION_FAILED', message, { fields: { [`lines.${i}.quantity`]: message } });
    if (!line || seen.has(want.sourceLineId)) throw refuse('Choose a line from this order');
    seen.add(want.sourceLineId);
    if (milli(want.quantity) > milli(line.quantityLeft)) throw refuse(`Only ${line.quantityLeft} ${line.unit} is left on this line`);
    return {
      sourceLineId: line.id, itemId: line.itemId, description: line.description, hsnSac: line.hsnSac, unit: line.unit, quantity: want.quantity, unitPricePaise: Number(line.unitPricePaise),
      discountPaise: Number(divRound(line.discountPaise * milli(want.quantity), milli(line.quantity))), gstRateBp: line.gstRateBp,
      freeQuantity: Math.round((Number(line.freeQuantity) * want.quantity * 1000) / Number(line.quantity)) / 1000,
    };
  });
  const invoice = await createDocument(
    ctx,
    target,
    { contactId: order.contactId, buyer: order.contactId ? undefined : (order.buyer as unknown as DocInput['buyer']), branchId: order.branchId, notes: order.notes, terms: order.terms, shipTo: order.shipTo as DocInput['shipTo'], lines },
    { sourceType: 'sales_order', sourceId: order.id },
  );
  await refreshOrderStatus(order.id);
  await audit({ action: target === 'invoice' ? 'sales.order.invoice' : 'sales.order.challan', entity: 'sales_order', entityId: order.id, after: { number: order.number, documentId: invoice.id } });
  return invoice;
}

/** Cancel an order that has no live invoice. */
export async function cancelOrder(ctx: TenantCtx, id: string, reason: string) {
  const order = await getDocument(ctx, id, 'sales_order');
  if (order.status === 'cancelled') throw new AppError('CONFLICT', 'This order is already cancelled.');
  const live = await db().salesDocument.count({ where: { kind: { in: ['invoice', 'delivery_challan'] }, sourceId: id, status: { not: 'cancelled' } } });
  if (live) throw new AppError('CONFLICT', 'This order has invoices or challans. Cancel or delete them first.');
  await db().salesDocument.update({ where: { id }, data: { status: 'cancelled', cancelledAt: new Date(), cancelReason: reason, version: { increment: 1 } } });
  await audit({ action: 'sales.order.cancel', entity: 'sales_order', entityId: id, before: { status: order.status }, after: { reason } });
  return getDocument(ctx, id, 'sales_order');
}

/** Bill a challan: a draft invoice with the same lines and rates. */
export async function invoiceFromChallan(ctx: TenantCtx, id: string) {
  const challan = await getDocument(ctx, id, 'delivery_challan');
  if (challan.status !== 'issued') throw new AppError('CONFLICT', 'This challan is already invoiced or cancelled.');
  const invoice = await createDocument(
    ctx,
    'invoice',
    {
      contactId: challan.contactId, buyer: challan.contactId ? undefined : (challan.buyer as unknown as DocInput['buyer']), branchId: challan.branchId, notes: challan.notes, terms: challan.terms,
      shipTo: challan.shipTo as DocInput['shipTo'], roundOff: challan.roundOffPaise !== 0n,
      lines: challan.lines.map((l) => ({ sourceLineId: l.id, itemId: l.itemId, description: l.description, hsnSac: l.hsnSac, unit: l.unit, quantity: Number(l.quantity), unitPricePaise: Number(l.unitPricePaise), discountPaise: Number(l.discountPaise), gstRateBp: l.gstRateBp, freeQuantity: Number(l.freeQuantity), batchId: l.batchId, serials: l.serials })),
    },
    { sourceType: 'delivery_challan', sourceId: challan.id },
  );
  // The challan took the stock out: its batches print on the invoice too
  for (const [i, l] of invoice.lines.entries()) {
    const from = challan.lines[i];
    if (from?.batches) await db().salesDocumentLine.update({ where: { id: l.id }, data: { batches: from.batches as object } });
  }
  await db().salesDocument.update({ where: { id }, data: { status: 'converted', version: { increment: 1 } } });
  await audit({ action: 'sales.delivery.invoice', entity: 'delivery_challan', entityId: id, after: { number: challan.number, invoiceId: invoice.id } });
  return invoice;
}

/** Cancel a challan that is not billed; its quantity goes back to the order. */
export async function cancelChallan(ctx: TenantCtx, id: string, reason: string) {
  const challan = await getDocument(ctx, id, 'delivery_challan');
  if (challan.status === 'cancelled') throw new AppError('CONFLICT', 'This challan is already cancelled.');
  if (challan.status === 'converted') throw new AppError('CONFLICT', 'This challan is invoiced. Cancel or delete the invoice first.');
  await db().salesDocument.update({ where: { id }, data: { status: 'cancelled', cancelledAt: new Date(), cancelReason: reason, version: { increment: 1 } } });
  if (challan.sourceType === 'sales_order' && challan.sourceId) await refreshOrderStatus(challan.sourceId);
  await reverseSource(ctx, id);
  await audit({ action: 'sales.delivery.cancel', entity: 'delivery_challan', entityId: id, after: { reason } });
  return getDocument(ctx, id, 'delivery_challan');
}
