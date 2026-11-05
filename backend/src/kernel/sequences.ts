import { db } from './db';
import { financialYear } from './gst';
import { withDefaults } from '../contracts/workspace';

// BIL-02: per-tenant document number series per financial year, never reused.
// The row lock from UPDATE ... RETURNING serialises concurrent callers.
// The prefix comes from the workspace preferences (Settings › Documents, default INV/{FY}/);
// changing it applies to the next number, and the running count carries on.

const PREFIX_KEY = { invoice: 'invoicePrefix', quotation: 'quotationPrefix', receipt: 'receiptPrefix', credit_note: 'creditNotePrefix', sales_order: 'salesOrderPrefix' } as const;

export async function allocateNumber(tenantId: string, docType: keyof typeof PREFIX_KEY, fyStartMonth: number, at = new Date()) {
  const fy = financialYear(at, fyStartMonth);
  const tx = db();
  const tenant = await tx.tenant.findUnique({ where: { id: tenantId }, select: { preferences: true } });
  const prefix = withDefaults(tenant?.preferences).documents[PREFIX_KEY[docType]].replace(/\{FY\}/g, fy);
  await tx.$executeRaw`INSERT INTO tenant_sequences (tenant_id, doc_type, fy, prefix, next_no) VALUES (${tenantId}::uuid, ${docType}, ${fy}, ${prefix}, 1)
    ON CONFLICT (tenant_id, doc_type, fy) DO UPDATE SET prefix = EXCLUDED.prefix`;
  const rows = await tx.$queryRaw<{ prefix: string; allocated: number }[]>`
    UPDATE tenant_sequences SET next_no = next_no + 1
     WHERE tenant_id = ${tenantId}::uuid AND doc_type = ${docType} AND fy = ${fy}
    RETURNING prefix, (next_no - 1)::int AS allocated`;
  const { prefix: p, allocated } = rows[0];
  // GST invoice numbers are at most 16 characters (e.g. INV/26-27/000123); prefixes are checked on save
  return { fy, number: `${p}${String(allocated).padStart(4, '0')}` };
}
