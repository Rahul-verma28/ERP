import type { PermissionScope } from '@prisma/client';
import { db } from '../../kernel/db';
import type { TenantCtx } from '../../kernel/context';
import { scopeWhere } from '../../kernel/query';
import { getFieldAccess, getRolePermissions } from '../access/service';
import { getEntitlements } from '../licensing/entitlements';

// Ctrl+K search (wireframe 5.8-D): customers and leads, invoices, quotations, appointments and
// items the person may see, each filtered by its module's data scope. Mobiles are masked
// unless the role can see phone numbers in exports.

const mask = (phone: string | null) => (phone ? phone.replace(/^(\+91)?(\d{2})\d{6}(\d{2})$/, (_m, cc: string | undefined, a: string, z: string) => `${cc ? '+91 ' : ''}${a}•• ••• •${z}`) : null);
const rupees = (p: bigint) => `₹${(Number(p) / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

export async function search(ctx: TenantCtx, q: string) {
  const [perms, ent, fields] = await Promise.all([getRolePermissions(ctx.roleId), getEntitlements(ctx.tenantId), getFieldAccess(ctx.roleId)]);
  const scoped = (key: string): TenantCtx | null => {
    const scope = perms.get(key) as PermissionScope | undefined;
    const m = key.split('.')[0] as keyof typeof ent.modules;
    if (!scope || ent.modules[m]?.status === 'inactive') return null;
    return { ...ctx, scope };
  };
  const like = { contains: q, mode: 'insensitive' as const };
  const digits = q.replace(/\D/g, '');
  const contacts = scoped('crm.contact.view');
  const inv = scoped('billing.invoice.view');
  const quo = scoped('sales.quotation.view');
  const appt = scoped('bookings.appointment.view');
  const items = scoped('catalog.item.view');
  const showPhone = !!fields['contact.phone_export'];

  // Invoices and quotations of customers whose name matches (the buyer copy on a document
  // can't be searched case-insensitively)
  const named = inv || quo ? await db().contact.findMany({ where: { OR: [{ name: like }, { companyName: like }] }, take: 20, select: { id: true } }) : [];
  const namedIds = named.map((x) => x.id);
  const [c, i, qt, a, it] = await Promise.all([
    contacts
      ? db().contact.findMany({
          where: { AND: [scopeWhere(contacts, { owner: ['ownerId', 'createdBy'], branch: 'branchId' }), { OR: [{ name: like }, { companyName: like }, { email: like }, ...(digits.length >= 4 ? [{ phone: { contains: digits } }] : []), { gstin: { contains: q.toUpperCase() } }] }] },
          take: 5,
          orderBy: { updatedAt: 'desc' },
          select: { id: true, name: true, type: true, phone: true, email: true },
        })
      : [],
    inv
      ? db().salesDocument.findMany({
          where: { AND: [scopeWhere(inv, { owner: ['createdBy'], branch: 'branchId' }), { kind: 'invoice', status: { not: 'draft' }, OR: [{ number: like }, { buyer: { path: ['name'], string_contains: q } }, ...(namedIds.length ? [{ contactId: { in: namedIds } }] : [])] }] },
          take: 5,
          orderBy: { issueDate: 'desc' },
          select: { id: true, number: true, buyer: true, totalPaise: true, paidPaise: true, status: true, dueDate: true },
        })
      : [],
    quo
      ? db().salesDocument.findMany({
          where: { AND: [scopeWhere(quo, { owner: ['createdBy'], branch: 'branchId' }), { kind: 'quotation', OR: [{ number: like }, { buyer: { path: ['name'], string_contains: q } }, ...(namedIds.length ? [{ contactId: { in: namedIds } }] : [])] }] },
          take: 3,
          orderBy: { issueDate: 'desc' },
          select: { id: true, number: true, buyer: true, totalPaise: true, status: true },
        })
      : [],
    appt
      ? db().appointment.findMany({
          where: { AND: [scopeWhere(appt, { owner: ['createdBy', 'staffId'], branch: 'branchId' }), { title: like, startAt: { gte: new Date(Date.now() - 7 * 86_400_000) } }] },
          take: 3,
          orderBy: { startAt: 'asc' },
          select: { id: true, title: true, startAt: true },
        })
      : [],
    items ? db().item.findMany({ where: { isActive: true, OR: [{ name: like }, { sku: like }] }, take: 4, orderBy: { name: 'asc' }, select: { id: true, name: true, type: true, pricePaise: true } }) : [],
  ]);

  const today = new Date();
  const name = (b: unknown) => ((b ?? {}) as { name?: string }).name ?? '';
  return {
    records: [
      ...c.map((x) => ({ type: 'contact', id: x.id, title: x.name, detail: [x.type === 'lead' ? 'lead' : 'customer', showPhone ? x.phone : mask(x.phone), x.email].filter(Boolean).join(' · '), href: `/app/m/crm/${x.id}` })),
      ...i.map((x) => ({
        type: 'invoice', id: x.id, title: x.number ?? 'Invoice',
        detail: [name(x.buyer), rupees(x.totalPaise), x.status === 'paid' ? 'paid' : x.dueDate && x.dueDate < today && x.status !== 'cancelled' ? 'overdue' : x.status.replace('_', ' ')].filter(Boolean).join(' · '),
        href: `/app/m/billing/${x.id}`,
      })),
      ...qt.map((x) => ({ type: 'quotation', id: x.id, title: x.number ?? 'Draft quotation', detail: [name(x.buyer), rupees(x.totalPaise), x.status].filter(Boolean).join(' · '), href: `/app/m/sales/${x.id}` })),
      ...a.map((x) => ({ type: 'appointment', id: x.id, title: x.title, detail: `appointment · ${x.startAt.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' })}`, href: '/app/m/bookings' })),
      ...it.map((x) => ({ type: 'item', id: x.id, title: x.name, detail: `${x.type} · ${rupees(x.pricePaise)}`, href: '/app/m/catalog' })),
    ],
    // "New invoice for Meera" when one customer matches and the role can bill
    contactForActions: c.length && scoped('billing.invoice.create') ? { id: c[0].id, name: c[0].name } : null,
  };
}
