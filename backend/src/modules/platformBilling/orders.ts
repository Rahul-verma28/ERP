import type { PlatformOrderStatus, Prisma } from '@prisma/client';
import { db } from '../../kernel/db';
import { notFound } from '../../kernel/errors';
import type { ConsoleCtx } from '../../kernel/context';
import { scopedTenantFilter } from '../console/service';
import { listArgs, listPage } from '../../kernel/query';

// Console → Payments: orders, payments and AHEAD invoices, within the caller's client scope.
// Runs inside consoleTx.

const n = (v: bigint | null) => (v === null ? null : Number(v));

async function tenantIdsInScope(ctx: ConsoleCtx): Promise<string[] | null> {
  const filter = await scopedTenantFilter(ctx);
  if (!Object.keys(filter).length) return null; // all clients
  return (await db().tenant.findMany({ where: filter, select: { id: true } })).map((t) => t.id);
}

const orderView = (o: Prisma.PlatformOrderGetPayload<object>) => ({
  id: o.id,
  tenantId: o.tenantId,
  kind: o.kind,
  status: o.status,
  cycle: o.cycle,
  items: o.items,
  listPaise: n(o.listPaise),
  discountBp: o.discountBp,
  couponCode: o.couponCode,
  discountPaise: n(o.discountPaise),
  taxablePaise: n(o.taxablePaise),
  cgstPaise: n(o.cgstPaise),
  sgstPaise: n(o.sgstPaise),
  igstPaise: n(o.igstPaise),
  totalPaise: n(o.totalPaise),
  billTo: o.billTo,
  createdBy: o.createdBy,
  approvedAt: o.approvedAt,
  cancelledReason: o.cancelledReason,
  expiresAt: o.expiresAt,
  paidAt: o.paidAt,
  paymentLinkUrl: o.paymentLinkUrl,
  createdAt: o.createdAt,
});

export async function listOrders(ctx: ConsoleCtx, q: { status?: PlatformOrderStatus; tenantId?: string; limit: number; cursor?: string; page?: number }) {
  const ids = await tenantIdsInScope(ctx);
  const tenantFilter = q.tenantId ? (ids && !ids.includes(q.tenantId) ? { in: [] } : q.tenantId) : ids ? { in: ids } : undefined;
  const where = { ...(tenantFilter ? { tenantId: tenantFilter } : {}), ...(q.status ? { status: q.status } : {}) };
  const [rows, total] = await Promise.all([
    db().platformOrder.findMany({ where, ...listArgs(q, { id: 'desc' as const }), include: { invoice: { select: { id: true, number: true } } } }),
    q.page ? db().platformOrder.count({ where }) : null,
  ]);
  const { data: pageRows, nextCursor } = listPage(rows, q);
  const tenants = new Map((await db().tenant.findMany({ where: { id: { in: pageRows.map((r) => r.tenantId) } }, select: { id: true, name: true } })).map((t) => [t.id, t.name]));
  const people = new Map((await db().user.findMany({ where: { id: { in: pageRows.map((r) => r.createdBy) } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const plans = new Map((await db().plan.findMany({ select: { id: true, name: true } })).map((p) => [p.id, p.name]));
  return {
    data: pageRows.map((o) => ({ ...orderView(o), planName: plans.get(o.planId) ?? null, clientName: tenants.get(o.tenantId) ?? null, createdByName: people.get(o.createdBy) ?? null, invoice: o.invoice })),
    nextCursor,
    total,
  };
}

export async function orderDetail(ctx: ConsoleCtx, id: string) {
  const order = await db().platformOrder.findUnique({ where: { id }, include: { payments: true, invoice: true } });
  const ids = await tenantIdsInScope(ctx);
  if (!order || (ids && !ids.includes(order.tenantId))) throw notFound('Order');
  const tenant = await db().tenant.findUnique({ where: { id: order.tenantId }, select: { name: true, status: true } });
  const people = new Map((await db().user.findMany({ where: { id: { in: [order.createdBy, order.approvedBy, ...order.payments.map((p) => p.recordedBy)].filter(Boolean) as string[] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  return {
    ...orderView(order),
    client: tenant,
    createdByName: people.get(order.createdBy) ?? null,
    approvedByName: order.approvedBy ? people.get(order.approvedBy) ?? null : null,
    payments: order.payments.map((p) => ({ id: p.id, method: p.method, amountPaise: Number(p.amountPaise), reference: p.reference, receivedAt: p.receivedAt, recordedBy: p.recordedBy ? people.get(p.recordedBy) ?? null : 'Gateway' })),
    invoice: order.invoice && invoiceView(order.invoice),
  };
}

const invoiceView = (i: Prisma.PlatformInvoiceGetPayload<object>) => ({
  id: i.id, number: i.number, fy: i.fy, tenantId: i.tenantId, orderId: i.orderId, seller: i.seller, billTo: i.billTo, lines: i.lines,
  taxablePaise: Number(i.taxablePaise), cgstPaise: Number(i.cgstPaise), sgstPaise: Number(i.sgstPaise), igstPaise: Number(i.igstPaise), totalPaise: Number(i.totalPaise), issuedAt: i.issuedAt,
});

export async function invoiceDetail(ctx: ConsoleCtx, id: string) {
  const invoice = await db().platformInvoice.findUnique({ where: { id } });
  const ids = await tenantIdsInScope(ctx);
  if (!invoice || (ids && !ids.includes(invoice.tenantId))) throw notFound('Invoice');
  return invoiceView(invoice);
}

/** For the client detail screen */
export async function clientOrders(tenantId: string) {
  const rows = await db().platformOrder.findMany({ where: { tenantId }, orderBy: { id: 'desc' }, include: { invoice: { select: { id: true, number: true } } }, take: 20 });
  return rows.map((o) => ({ id: o.id, status: o.status, cycle: o.cycle, totalPaise: Number(o.totalPaise), createdAt: o.createdAt, paidAt: o.paidAt, expiresAt: o.expiresAt, invoice: o.invoice }));
}
