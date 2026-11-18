import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { bundle, userNames, userPart } from '../../kernel/bundle';
import type { TenantCtx } from '../../kernel/context';

// A record's history for its detail page: what the audit log saw happen to it (issued, paid,
// cancelled, returned…), newest first, with who did it. Money and stock actions are logged
// against the document itself, or name it (a payment names its invoice), so both are matched.
// Reading it needs the record's own view permission.

export const HISTORY_KINDS = {
  item: { entities: ['item'], permission: 'catalog.item.view' },
  price_list: { entities: ['price_list'], permission: 'catalog.item.view' },
  customer: { entities: ['contact'], permission: 'crm.contact.view' },
  supplier: { entities: ['contact'], permission: 'inventory.supplier.view' },
  lead: { entities: ['contact', 'deal'], permission: 'crm.lead.view' },
  deal: { entities: ['deal'], permission: 'crm.deal.view' },
  sales_doc: { entities: ['invoice', 'sales_document', 'credit_note', 'debit_note', 'sales_order', 'delivery_challan', 'payment', 'advance_adjustment'], permission: 'billing.invoice.view' },
  quotation: { entities: ['sales_document', 'quotation'], permission: 'sales.quotation.view' },
  payment: { entities: ['payment', 'advance_adjustment'], permission: 'billing.payment.view' },
  purchase: { entities: ['purchase_document', 'supplier_payment'], permission: 'inventory.supplier_bill.view' },
  supplier_payment: { entities: ['supplier_payment'], permission: 'inventory.supplier_bill.view' },
  stock_entry: { entities: ['stock_entry'], permission: 'inventory.stock.view' },
  warehouse: { entities: ['stock_location'], permission: 'inventory.warehouse.view' },
  employee: { entities: ['employee', 'hr_action', 'hr_record', 'leave_application'], permission: 'hr.employee.view' },
  payroll: { entities: ['payroll_run'], permission: 'hr.payroll.view' },
  expense: { entities: ['expense', 'recurring_expense'], permission: 'finance.expense.view' },
  income: { entities: ['income'], permission: 'finance.expense.view' },
  journal: { entities: ['journal'], permission: 'finance.expense.view' },
  account: { entities: ['fin_ledger', 'fin_transfer'], permission: 'finance.expense.view' },
  project: { entities: ['task_project'], permission: 'tasks.task.view' },
  approval: { entities: ['approval_request'], permission: 'tasks.approval.view' },
  ticket: { entities: ['support_ticket'], permission: 'support.ticket.view' },
} as const;
export type HistoryKind = keyof typeof HISTORY_KINDS;

export const HistoryQuery = z.object({
  kind: z.enum(Object.keys(HISTORY_KINDS) as [HistoryKind, ...HistoryKind[]]),
  id: z.string().uuid(),
  /** The record's number or name, to find entries that name it (a payment names its invoice) */
  ref: z.string().trim().max(80).optional(),
});

/** Values in an entry that name another record, never shown as a change */
const LINK_KEYS = ['invoice', 'bill', 'from', 'creditNote', 'advance', 'number'];

export async function recordHistory(ctx: TenantCtx, q: z.infer<typeof HistoryQuery>) {
  const k = HISTORY_KINDS[q.kind];
  const t = ctx.tenantId;
  const named = q.ref ? Prisma.sql`or (${Prisma.join(LINK_KEYS.filter((x) => x !== 'number').map((key) => Prisma.sql`a.after->>${key} = ${q.ref}`), ' or ')})` : Prisma.empty;
  const b = await bundle({
    rows: Prisma.sql`
      select a.id, a.at, a.action, a.entity, a.entity_id, a.actor_kind, a.actor_id, a.before, a.after
      from audit_log a
      where a.tenant_id = ${t}::uuid and a.entity in (${Prisma.join(k.entities.map((e) => Prisma.sql`${e}`))})
        and (a.entity_id = ${q.id} ${named})
      order by a.at desc limit 100`,
    ...userPart(t),
  });
  const names = userNames(b);
  return {
    data: b.rows.map((r) => ({
      id: r.id as string,
      at: r.at as Date,
      action: r.action as string,
      /** Another record this entry is about (a payment on this invoice) */
      other: r.entityId !== q.id ? r.entity as string : null,
      by: r.actorKind === 'user' ? (r.actorId ? names.get(r.actorId) ?? 'Someone' : 'Someone') : r.actorKind === 'platform' ? 'AHEAD support' : 'System',
      details: details(r.before, r.after),
    })),
  };
}

/** What changed, as label/value pairs: the after values, or before → after where both are known */
function details(before: unknown, after: unknown) {
  const a = (after && typeof after === 'object' && !Array.isArray(after) ? after : {}) as Record<string, unknown>;
  const was = (before && typeof before === 'object' && !Array.isArray(before) ? before : {}) as Record<string, unknown>;
  const out: { key: string; value: unknown; was?: unknown }[] = [];
  for (const [key, value] of Object.entries(a)) {
    if (key === 'version' || key.endsWith('Id') || key === 'id' || value === null || value === undefined || typeof value === 'object') continue;
    if (LINK_KEYS.includes(key) && key !== 'number') { out.push({ key, value }); continue; }
    out.push(key in was && was[key] !== value ? { key, value, was: was[key] } : { key, value });
  }
  return out.slice(0, 8);
}
