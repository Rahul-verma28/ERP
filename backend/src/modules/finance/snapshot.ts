import { Prisma, type FinAccount, type FinLedger } from '@prisma/client';
import { db } from '../../kernel/db';
import type { TenantCtx } from '../../kernel/context';
import { dateOnly } from '../../kernel/gst';

// Everything Finance reads, in ONE database round trip. Each request runs in one transaction, where
// queries go one after another; with the database far away that is ~300 ms each, so a report that
// made 30 queries took 9 s. Balances, statements and reports are then worked out in memory.

export interface Snap {
  tenant: { gstin: string | null; billingStateCode: string | null; fyStartMonth: number; profile: unknown; preferences: unknown }
  accounts: FinAccount[]
  categories: { id: string; kind: string; name: string; position: number; budgetPaise: bigint | null }[]
  ledgers: FinLedger[]
  sales: { id: string; kind: string; status: string; number: string | null; issueDate: Date; taxablePaise: bigint; cgstPaise: bigint; sgstPaise: bigint; igstPaise: bigint; totalPaise: bigint; paidPaise: bigint; party: string | null }[]
  purchases: { id: string; kind: string; status: string; number: string; supplierRef: string | null; issueDate: Date; taxablePaise: bigint; cgstPaise: bigint; sgstPaise: bigint; igstPaise: bigint; totalPaise: bigint; paidPaise: bigint; returnedPaise: bigint; reverseCharge: boolean; party: string | null }[]
  payments: { id: string; number: string; paidOn: Date; amountPaise: bigint; method: string; accountId: string | null; contactId: string | null; documentId: string | null; reversesId: string | null; contactName: string | null; docKind: string | null; docNumber: string | null; buyerName: string | null }[]
  supplierPayments: { id: string; number: string; paidOn: Date; amountPaise: bigint; method: string; accountId: string | null; contactId: string; documentId: string | null; reversesId: string | null; contactName: string | null }[]
  expenses: { id: string; number: string | null; paidOn: Date; category: string; amountPaise: bigint; gstPaise: bigint | null; taxablePaise: bigint | null; vendorGstin: string | null; method: string; accountId: string | null; payee: string | null }[]
  incomes: { id: string; number: string; receivedOn: Date; category: string; amountPaise: bigint; accountId: string; payer: string | null }[]
  transfers: { id: string; number: string; transferOn: Date; fromAccountId: string; toAccountId: string; amountPaise: bigint; chargesPaise: bigint }[]
  journals: { id: string; number: string; journalOn: Date; narration: string; lines: { id: string; ledgerKey: string; debitPaise: bigint; creditPaise: bigint; description: string | null }[] }[]
  stock: { date: Date; opening: boolean; valuePaise: bigint }[]
}

type J = Record<string, unknown>
const b = (v: unknown) => BigInt((v as number | string | null) ?? 0)
const bn = (v: unknown) => (v === null || v === undefined ? null : BigInt(v as number | string))
const d = (v: unknown) => dateOnly(String(v).slice(0, 10))
const dn = (v: unknown) => (v ? d(v) : null)
const s = (v: unknown) => (v === null || v === undefined ? null : String(v))
const list = (v: unknown) => (Array.isArray(v) ? (v as J[]) : [])

async function fetch(ctx: Pick<TenantCtx, 'tenantId'>) {
  const t = ctx.tenantId;
  const rows = await db().$queryRaw<J[]>(Prisma.sql`
    select
      (select row_to_json(x) from (select gstin, billing_state_code, fy_start_month, profile, preferences from tenants where id = ${t}::uuid) x) as tenant,
      (select coalesce(json_agg(a order by a.created_at), '[]') from fin_accounts a where a.tenant_id = ${t}::uuid) as accounts,
      (select coalesce(json_agg(c order by c.position, c.name), '[]') from fin_categories c where c.tenant_id = ${t}::uuid) as categories,
      (select coalesce(json_agg(l order by l.code nulls last, l.name), '[]') from fin_ledgers l where l.tenant_id = ${t}::uuid) as ledgers,
      (select coalesce(json_agg(x), '[]') from (
        select id, kind::text as kind, status::text as status, number, issue_date, taxable_paise, cgst_paise, sgst_paise, igst_paise, total_paise, paid_paise, buyer->>'name' as party
        from sales_documents where tenant_id = ${t}::uuid and kind::text in ('invoice', 'credit_note', 'debit_note', 'opening_balance') and status::text not in ('draft', 'cancelled')) x) as sales,
      (select coalesce(json_agg(x), '[]') from (
        select id, kind, status, number, supplier_ref, issue_date, taxable_paise, cgst_paise, sgst_paise, igst_paise, total_paise, paid_paise, returned_paise, reverse_charge, supplier->>'name' as party
        from purchase_documents where tenant_id = ${t}::uuid and ((kind = 'purchase_bill' and status not in ('draft', 'cancelled')) or (kind = 'purchase_return' and status = 'issued'))) x) as purchases,
      (select coalesce(json_agg(x), '[]') from (
        select p.id, p.number, p.paid_on, p.amount_paise, p.method::text as method, p.account_id, p.contact_id, p.document_id, p.reverses_id,
               coalesce(nullif(c.company_name, ''), c.name) as contact_name, d.kind::text as doc_kind, d.number as doc_number, d.buyer->>'name' as buyer_name
        from payments_received p left join contacts c on c.id = p.contact_id left join sales_documents d on d.id = p.document_id
        where p.tenant_id = ${t}::uuid) x) as payments,
      (select coalesce(json_agg(x), '[]') from (
        select p.id, p.number, p.paid_on, p.amount_paise, p.method, p.account_id, p.contact_id, p.document_id, p.reverses_id, coalesce(nullif(c.company_name, ''), c.name) as contact_name
        from supplier_payments p left join contacts c on c.id = p.contact_id where p.tenant_id = ${t}::uuid) x) as supplier_payments,
      (select coalesce(json_agg(x order by x.paid_on desc, x.id desc), '[]') from (
        select id, number, paid_on, category, amount_paise, gst_paise, taxable_paise, vendor_gstin, method::text as method, account_id, payee from expenses where tenant_id = ${t}::uuid) x) as expenses,
      (select coalesce(json_agg(x), '[]') from (select id, number, received_on, category, amount_paise, account_id, payer from incomes where tenant_id = ${t}::uuid) x) as incomes,
      (select coalesce(json_agg(x), '[]') from (select id, number, transfer_on, from_account_id, to_account_id, amount_paise, charges_paise from fin_transfers where tenant_id = ${t}::uuid) x) as transfers,
      (select coalesce(json_agg(x), '[]') from (
        select j.id, j.number, j.journal_on, j.narration,
               (select coalesce(json_agg(l order by l.position), '[]') from (select id, ledger_key, debit_paise, credit_paise, description, position from journal_lines where journal_id = j.id) l) as lines
        from journals j where j.tenant_id = ${t}::uuid) x) as journals,
      (select coalesce(json_agg(x), '[]') from (select move_date, kind = 'opening' as opening, sum(value_paise) as value from stock_moves where tenant_id = ${t}::uuid group by 1, 2) x) as stock
  `);
  return rows[0];
}

function shape(r: J): Snap {
  const tn = (r.tenant ?? {}) as J;
  return {
    tenant: { gstin: s(tn.gstin), billingStateCode: s(tn.billing_state_code), fyStartMonth: Number(tn.fy_start_month ?? 4), profile: tn.profile ?? {}, preferences: tn.preferences ?? {} },
    accounts: list(r.accounts).map((a) => ({
      id: String(a.id), tenantId: String(a.tenant_id), name: String(a.name), kind: String(a.kind), bankName: s(a.bank_name), accountNo: s(a.account_no), ifsc: s(a.ifsc), upiId: s(a.upi_id),
      openingPaise: b(a.opening_paise), openingDate: dn(a.opening_date), isDefault: !!a.is_default, isActive: !!a.is_active, notes: s(a.notes),
      createdAt: new Date(String(a.created_at)), updatedAt: new Date(String(a.updated_at)), version: Number(a.version),
    })),
    categories: list(r.categories).map((c) => ({ id: String(c.id), kind: String(c.kind), name: String(c.name), position: Number(c.position), budgetPaise: bn(c.budget_paise) })),
    ledgers: list(r.ledgers).map((l) => ({ id: String(l.id), tenantId: String(l.tenant_id), name: String(l.name), group: String(l.group), code: s(l.code), description: s(l.description), isActive: !!l.is_active, version: Number(l.version), createdAt: new Date(String(l.created_at)) })),
    sales: list(r.sales).map((x) => ({ id: String(x.id), kind: String(x.kind), status: String(x.status), number: s(x.number), issueDate: d(x.issue_date), taxablePaise: b(x.taxable_paise), cgstPaise: b(x.cgst_paise), sgstPaise: b(x.sgst_paise), igstPaise: b(x.igst_paise), totalPaise: b(x.total_paise), paidPaise: b(x.paid_paise), party: s(x.party) })),
    purchases: list(r.purchases).map((x) => ({ id: String(x.id), kind: String(x.kind), status: String(x.status), number: String(x.number), supplierRef: s(x.supplier_ref), issueDate: d(x.issue_date), taxablePaise: b(x.taxable_paise), cgstPaise: b(x.cgst_paise), sgstPaise: b(x.sgst_paise), igstPaise: b(x.igst_paise), totalPaise: b(x.total_paise), paidPaise: b(x.paid_paise), returnedPaise: b(x.returned_paise), reverseCharge: !!x.reverse_charge, party: s(x.party) })),
    payments: list(r.payments).map((x) => ({ id: String(x.id), number: String(x.number), paidOn: d(x.paid_on), amountPaise: b(x.amount_paise), method: String(x.method), accountId: s(x.account_id), contactId: s(x.contact_id), documentId: s(x.document_id), reversesId: s(x.reverses_id), contactName: s(x.contact_name), docKind: s(x.doc_kind), docNumber: s(x.doc_number), buyerName: s(x.buyer_name) })),
    supplierPayments: list(r.supplier_payments).map((x) => ({ id: String(x.id), number: String(x.number), paidOn: d(x.paid_on), amountPaise: b(x.amount_paise), method: String(x.method), accountId: s(x.account_id), contactId: String(x.contact_id), documentId: s(x.document_id), reversesId: s(x.reverses_id), contactName: s(x.contact_name) })),
    expenses: list(r.expenses).map((x) => ({ id: String(x.id), number: s(x.number), paidOn: d(x.paid_on), category: String(x.category), amountPaise: b(x.amount_paise), gstPaise: bn(x.gst_paise), taxablePaise: bn(x.taxable_paise), vendorGstin: s(x.vendor_gstin), method: String(x.method), accountId: s(x.account_id), payee: s(x.payee) })),
    incomes: list(r.incomes).map((x) => ({ id: String(x.id), number: String(x.number), receivedOn: d(x.received_on), category: String(x.category), amountPaise: b(x.amount_paise), accountId: String(x.account_id), payer: s(x.payer) })),
    transfers: list(r.transfers).map((x) => ({ id: String(x.id), number: String(x.number), transferOn: d(x.transfer_on), fromAccountId: String(x.from_account_id), toAccountId: String(x.to_account_id), amountPaise: b(x.amount_paise), chargesPaise: b(x.charges_paise) })),
    journals: list(r.journals).map((x) => ({ id: String(x.id), number: String(x.number), journalOn: d(x.journal_on), narration: String(x.narration), lines: list(x.lines).map((l) => ({ id: String(l.id), ledgerKey: String(l.ledger_key), debitPaise: b(l.debit_paise), creditPaise: b(l.credit_paise), description: s(l.description) })) })),
    stock: list(r.stock).map((x) => ({ date: d(x.move_date), opening: !!x.opening, valuePaise: b(x.value) })),
  };
}

/** One read of everything Finance needs; makes the first cash and bank accounts if there are none */
export async function loadSnapshot(ctx: Pick<TenantCtx, 'tenantId'>): Promise<Snap> {
  let snap = shape(await fetch(ctx));
  if (!snap.accounts.length) {
    const { ensureFinance } = await import('./service');
    await ensureFinance(ctx);
    snap = shape(await fetch(ctx));
  }
  return snap;
}
