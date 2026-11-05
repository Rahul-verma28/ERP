import { z } from 'zod';
import { db, prisma, withPlatform } from '../../kernel/db';
import { AppError } from '../../kernel/errors';
import { csv, xlsx, zip } from '../../kernel/zip';
import { financialYear } from '../../kernel/gst';
import { audit } from '../audit/service';
import { getFieldAccess } from '../access/service';
import { sendMessage } from '../notifications/service';
import { consumeOtp, sendOtp } from '../identity/otp';
import { transition } from '../subscription/stateMachine';
import type { TenantCtx } from '../../kernel/context';

// Settings › Data: import history, export, close and reopen the business.

// ── Import history (from the audit log) ──

export async function importHistory() {
  const rows = await db().auditLog.findMany({
    where: { action: { in: ['crm.contact.import', 'catalog.item.import'] } },
    orderBy: { at: 'desc' },
    take: 20,
  });
  const actors = await prisma.user.findMany({ where: { id: { in: rows.map((r) => r.actorId).filter((x): x is string => !!x) } }, select: { id: true, name: true } });
  const names = new Map(actors.map((a) => [a.id, a.name]));
  return rows.map((r) => {
    const a = (r.after ?? {}) as { created?: number; updated?: number; duplicates?: number; errors?: number; type?: string; onDuplicate?: string };
    return {
      id: r.id,
      at: r.at,
      what: r.action === 'catalog.item.import' ? 'Products & services' : a.type === 'supplier' ? 'Suppliers' : 'Customers',
      by: (r.actorId && names.get(r.actorId)) ?? null,
      created: a.created ?? 0,
      updated: a.updated ?? 0,
      skipped: a.onDuplicate === 'update' ? 0 : (a.duplicates ?? 0),
      errors: a.errors ?? 0,
    };
  });
}

// ── Export ──

export const EXPORT_KINDS = ['customers', 'invoices', 'payments', 'items'] as const;
export type ExportKind = (typeof EXPORT_KINDS)[number];
export const ExportQuery = z.object({
  what: z
    .string()
    .transform((v) => [...new Set(v.split(',').map((s) => s.trim()).filter(Boolean))])
    .pipe(z.array(z.enum(EXPORT_KINDS)).min(1, 'Choose what to export')),
  period: z.enum(['fy', 'all']).default('fy'),
  format: z.enum(['csv', 'xlsx']).default('csv'),
});

type Row = (string | number | null)[];
const money = (paise: bigint | number | null) => (paise === null ? null : Number(paise) / 100);
const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const addr = (a: unknown) => {
  const x = (a ?? {}) as Record<string, string>;
  return [x.line1, x.line2, x.city, x.pincode].filter(Boolean).join(', ') || null;
};

async function table(kind: ExportKind, since: Date | null, fields: Record<string, string>): Promise<{ name: string; rows: Row[] }> {
  const showPhone = !!fields['contact.phone_export'];
  const showCost = !!fields['item.cost_price'];
  if (kind === 'customers') {
    const list = await db().contact.findMany({ where: { isSample: false }, orderBy: { createdAt: 'asc' } });
    return {
      name: 'Customers',
      rows: [
        ['Name', 'Type', 'Company', ...(showPhone ? ['Mobile'] : []), 'Email', 'GSTIN', 'State code', 'Address', 'Status', 'Created'],
        ...list.map((c) => [c.name, c.type, c.companyName, ...(showPhone ? [c.phone] : []), c.email, c.gstin, c.stateCode, addr(c.address), c.isActive ? 'Active' : 'Inactive', day(c.createdAt)]),
      ],
    };
  }
  if (kind === 'items') {
    const list = await db().item.findMany({ orderBy: { createdAt: 'asc' } });
    return {
      name: 'Products and services',
      rows: [
        ['Name', 'Type', 'SKU', 'Unit', 'Price (₹)', ...(showCost ? ['Cost price (₹)'] : []), 'GST %', 'HSN/SAC', 'Duration (min)', 'Active'],
        ...list.map((i) => [i.name, i.type, i.sku, i.unit, money(i.pricePaise), ...(showCost ? [money(i.costPricePaise)] : []), i.gstRateBp / 100, i.hsnSac, i.durationMin, i.isActive ? 'Yes' : 'No']),
      ],
    };
  }
  if (kind === 'invoices') {
    const list = await db().salesDocument.findMany({ where: { kind: 'invoice', status: { not: 'draft' }, ...(since ? { issueDate: { gte: since } } : {}) }, orderBy: { issueDate: 'asc' } });
    return {
      name: 'Invoices',
      rows: [
        ['Number', 'Date', 'Due date', 'Customer', 'Customer GSTIN', 'Place of supply', 'Status', 'Taxable (₹)', 'CGST (₹)', 'SGST (₹)', 'IGST (₹)', 'Total (₹)', 'Paid (₹)', 'Credit notes (₹)', 'Balance (₹)'],
        ...list.map((d) => {
          const b = (d.buyer ?? {}) as { name?: string; gstin?: string };
          return [d.number, day(d.issueDate), day(d.dueDate), b.name ?? null, b.gstin ?? null, d.placeOfSupply, d.status, money(d.taxablePaise), money(d.cgstPaise), money(d.sgstPaise), money(d.igstPaise), money(d.totalPaise), money(d.paidPaise - d.creditedPaise), money(d.creditedPaise), money(d.totalPaise - d.paidPaise)];
        }),
      ],
    };
  }
  const list = await db().payment.findMany({ where: since ? { paidOn: { gte: since } } : {}, include: { document: { select: { number: true, buyer: true } } }, orderBy: { paidOn: 'asc' } });
  // Advances have no invoice, so their customer name comes from the contact
  const contactIds = [...new Set(list.filter((p) => !p.document && p.contactId).map((p) => p.contactId!))];
  const contacts = contactIds.length ? await db().contact.findMany({ where: { id: { in: contactIds } }, select: { id: true, name: true, companyName: true } }) : [];
  const contactName = new Map(contacts.map((c) => [c.id, c.companyName || c.name]));
  return {
    name: 'Payments',
    rows: [
      ['Receipt', 'Date', 'Invoice', 'Customer', 'Amount (₹)', 'Method', 'Reference'],
      ...list.map((p) => [p.number, day(p.paidOn), p.document?.number ?? 'Advance', p.document ? ((p.document.buyer ?? {}) as { name?: string }).name ?? null : contactName.get(p.contactId ?? '') ?? null, money(p.amountPaise), p.method, p.reference]),
    ],
  };
}

export async function buildExport(ctx: TenantCtx, q: z.infer<typeof ExportQuery>) {
  const tenant = await db().tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { name: true, fyStartMonth: true } });
  const fy = financialYear(new Date(), tenant.fyStartMonth);
  const now = new Date();
  const startYear = now.getMonth() + 1 >= tenant.fyStartMonth ? now.getFullYear() : now.getFullYear() - 1;
  const since = q.period === 'fy' ? new Date(Date.UTC(startYear, tenant.fyStartMonth - 1, 1)) : null;
  const fields = await getFieldAccess(ctx.roleId);
  const tables = [];
  for (const kind of q.what) tables.push(await table(kind, since, fields));

  const base = `${tenant.name.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'export'}-${q.period === 'fy' ? `FY${fy}` : 'all-time'}`;
  await audit({ action: 'tenant.data.export', entity: 'tenant', entityId: ctx.tenantId, after: { what: q.what, period: q.period, format: q.format, rows: tables.map((t) => t.rows.length - 1) } });
  if (q.format === 'xlsx') {
    return { filename: `${base}.xlsx`, type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', body: xlsx(tables) };
  }
  if (tables.length === 1) {
    return { filename: `${base}-${q.what[0]}.csv`, type: 'text/csv; charset=utf-8', body: Buffer.from(csv(tables[0].rows), 'utf8') };
  }
  return { filename: `${base}.zip`, type: 'application/zip', body: zip(tables.map((t, i) => ({ name: `${q.what[i]}.csv`, data: csv(t.rows) }))) };
}

// ── Close and reopen (Owner only) ──

async function ownerOnly(ctx: TenantCtx) {
  const t = await db().tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { name: true, ownerUserId: true, status: true } });
  if (t.ownerUserId !== ctx.userId) throw new AppError('PERMISSION_DENIED', 'Only the Owner can close or reopen the business.');
  return t;
}

export async function startClose(ctx: TenantCtx) {
  const t = await ownerOnly(ctx);
  if (t.status === 'closed') throw new AppError('CONFLICT', 'This business is already closed.');
  const owner = await prisma.user.findUniqueOrThrow({ where: { id: ctx.userId }, select: { mobile: true } });
  const sent = await withPlatform(() => sendOtp(owner.mobile, 'close_account'));
  return { mobile: owner.mobile.replace(/^(\+91)(\d{5})(\d{5})$/, '$1 $2 $3'), devCode: sent.devCode };
}

export const CloseInput = z.object({
  name: z.string().trim().min(1, 'Type the business name'),
  code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code'),
});

export async function closeBusiness(ctx: TenantCtx, input: z.infer<typeof CloseInput>) {
  const t = await ownerOnly(ctx);
  if (input.name.toLowerCase() !== t.name.trim().toLowerCase()) {
    throw new AppError('VALIDATION_FAILED', "The name doesn't match.", { fields: { name: "The name doesn't match" } });
  }
  const owner = await prisma.user.findUniqueOrThrow({ where: { id: ctx.userId }, select: { mobile: true, name: true } });
  const purgeAt = await withPlatform(async () => {
    await consumeOtp(owner.mobile, 'close_account', input.code);
    await transition(ctx.tenantId, 'owner_closed');
    // Everyone else is signed out right away
    await db().userSession.updateMany({ where: { tenantId: ctx.tenantId, revokedAt: null, userId: { not: ctx.userId } }, data: { revokedAt: new Date() } });
    const sub = await db().subscription.findUniqueOrThrow({ where: { tenantId: ctx.tenantId }, select: { purgeAt: true } });
    return sub.purgeAt;
  });
  await audit({ action: 'tenant.close', entity: 'tenant', entityId: ctx.tenantId, after: { purgeAt } });
  const admins = await prisma.tenantMember.findMany({ where: { tenantId: ctx.tenantId, status: 'active', role: { key: { in: ['owner', 'admin'] } } }, select: { user: { select: { email: true, name: true } } } });
  for (const a of admins) {
    await sendMessage({
      channel: 'email', to: a.user.email, template: 'tenant.closed', subject: `${t.name} was closed`,
      text: `Hi ${a.user.name}, ${owner.name} closed ${t.name} on AHEAD. It can be reopened until ${purgeAt?.toDateString()}; after that all data is deleted.`,
    });
  }
  return { status: 'closed', purgeAt };
}

export async function reopenBusiness(ctx: TenantCtx) {
  const t = await ownerOnly(ctx);
  if (t.status !== 'closed') throw new AppError('CONFLICT', 'This business is not closed.');
  await withPlatform(() => transition(ctx.tenantId, 'owner_restored'));
  await audit({ action: 'tenant.reopen', entity: 'tenant', entityId: ctx.tenantId });
  return { status: 'free' };
}
