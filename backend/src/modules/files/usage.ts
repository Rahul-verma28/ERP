import { db } from '../../kernel/db';
import { AppError } from '../../kernel/errors';
import { getEntitlements } from '../licensing/entitlements';

// Storage per business: the plan's limit (Console › Plans), what is used (every uploaded file),
// and where each file is used. Database rows (bills, customers…) are not counted: plans limit
// those by users, items and invoices.

const MB = 1024 * 1024;

export interface StorageUsage {
  usedBytes: number;
  files: number;
  /** null = no limit */
  limitBytes: number | null;
  percent: number | null;
}

export async function storageUsage(tenantId: string): Promise<StorageUsage> {
  const [agg, ent] = await Promise.all([db().storedFile.aggregate({ where: { tenantId }, _sum: { sizeBytes: true }, _count: true }), getEntitlements(tenantId)]);
  const usedBytes = agg._sum.sizeBytes ?? 0;
  const limitMb = (ent.limits as { storageMb?: number | null }).storageMb;
  const limitBytes = limitMb == null ? null : limitMb * MB;
  return { usedBytes, files: agg._count, limitBytes, percent: limitBytes ? Math.min(100, Math.round((usedBytes / limitBytes) * 1000) / 10) : null };
}

const human = (bytes: number) => (bytes >= 1024 * MB ? `${(bytes / 1024 / MB).toFixed(bytes % (1024 * MB) ? 1 : 0)} GB` : `${Math.max(1, Math.round(bytes / MB))} MB`);

/** Refuse an upload that would go over the plan's storage (files already there stay and open) */
export async function assertRoom(tenantId: string, addBytes: number) {
  const u = await storageUsage(tenantId);
  if (u.limitBytes != null && u.usedBytes + addBytes > u.limitBytes) {
    throw new AppError('LIMIT_REACHED', `Your ${human(u.limitBytes)} of file storage is full. Remove files you no longer need in Settings › Files & storage, or upgrade your plan.`, { limit: 'storage', usedBytes: u.usedBytes, limitBytes: u.limitBytes });
  }
  return u;
}

/** After an upload: tell the owner once a month when storage passes 80% and when it is full */
export async function alertIfNearlyFull(tenantId: string, before: StorageUsage, addedBytes: number) {
  if (before.limitBytes == null) return;
  const after = (before.usedBytes + addedBytes) / before.limitBytes;
  const was = before.usedBytes / before.limitBytes;
  const level = after >= 1 ? 100 : after >= 0.8 ? 80 : null;
  if (!level || was >= level / 100) return;
  const t = await db().tenant.findUnique({ where: { id: tenantId }, select: { ownerUserId: true } });
  if (!t?.ownerUserId) return;
  const title = level === 100 ? 'File storage is full' : 'File storage is 80% used';
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  if (await db().notification.findFirst({ where: { tenantId, userId: t.ownerUserId, title, createdAt: { gte: monthStart } }, select: { id: true } })) return;
  await db().notification.create({
    data: {
      tenantId, userId: t.ownerUserId, title, link: '/app/settings/files',
      body: `${human(before.usedBytes + addedBytes)} of ${human(before.limitBytes)} used. ${level === 100 ? 'New uploads stop until space is freed or the plan is upgraded.' : 'Remove old files or upgrade before it fills up.'}`,
    },
  });
}

// ── Where files are used ──

export interface FileUse {
  table: string;
  rowId: string;
}

/**
 * For each file id, the records that point at it: any text column named url or *_url holding
 * "file:<id>", and any JSON column containing it (an HR document keeps its scan in data.url).
 * Found from the database itself, so a column added later is covered. Only tables the current
 * role may read are looked at (a business sees its own rows through row-level security).
 */
export async function fileReferences(): Promise<Map<string, FileUse[]>> {
  const cols = await db().$queryRaw<{ table_name: string; column_name: string; data_type: string }[]>`
    SELECT c.table_name, c.column_name, c.data_type FROM information_schema.columns c
      JOIN information_schema.columns idc ON idc.table_schema = c.table_schema AND idc.table_name = c.table_name AND idc.column_name = 'id'
     WHERE c.table_schema = 'public' AND c.table_name <> 'files'
       AND has_table_privilege(format('%I.%I', c.table_schema, c.table_name), 'SELECT')
       AND ((c.data_type IN ('text', 'character varying') AND (c.column_name = 'url' OR c.column_name LIKE '%\\_url'))
            OR c.data_type IN ('json', 'jsonb'))`;
  const ident = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const uses = new Map<string, FileUse[]>();
  for (const c of cols) {
    const t = ident(c.table_name);
    const col = ident(c.column_name);
    const sql =
      c.data_type === 'json' || c.data_type === 'jsonb'
        ? `SELECT DISTINCT (regexp_matches(${col}::text, 'file:([0-9a-f-]{36})', 'g'))[1] AS id, id::text AS row_id FROM ${t} WHERE ${col}::text LIKE '%file:%'`
        : `SELECT substring(${col} from 6) AS id, id::text AS row_id FROM ${t} WHERE ${col} LIKE 'file:%'`;
    const rows = await db().$queryRawUnsafe<{ id: string; row_id: string }[]>(sql);
    for (const r of rows) {
      const key = r.id.toLowerCase();
      const list = uses.get(key) ?? [];
      list.push({ table: c.table_name, rowId: r.row_id });
      uses.set(key, list);
    }
  }
  return uses;
}

// What a file is used for, in words, and where to open it
const ENTITY_USE: Record<string, { label: string; href?: (id: string) => string }> = {
  task: { label: 'Task' },
  ticket: { label: 'Support ticket', href: (id) => `/app/m/support/${id}` },
  customer: { label: 'Customer papers', href: (id) => `/app/m/sales/customers/${id}` },
  supplier: { label: 'Supplier papers', href: (id) => `/app/m/purchase/suppliers/${id}` },
  item: { label: 'Item photos & files', href: (id) => `/app/m/catalog/${id}` },
};
const TABLE_USE: Record<string, { label: string; href?: (id: string) => string }> = {
  expenses: { label: 'Expense bill', href: (id) => `/app/m/finance/expenses/${id}` },
  incomes: { label: 'Income proof' },
  payments_received: { label: 'Payment received' },
  supplier_payments: { label: 'Supplier payment' },
  purchase_documents: { label: 'Purchase bill', href: (id) => `/app/m/purchase/${id}` },
  stock_entries: { label: 'Stock entry' },
  appointments: { label: 'Appointment' },
  hr_loans: { label: 'Loan agreement' },
  leave_applications: { label: 'Leave proof' },
  employees: { label: 'Employee photo', href: (id) => `/app/m/hr/employees/${id}` },
  hr_actions: { label: 'HR letter' },
  hr_posts: { label: 'HR document' },
  hr_candidates: { label: 'Resume' },
  hr_records: { label: 'Employee document' },
  approval_requests: { label: 'Approval' },
  items: { label: 'Item photo', href: (id) => `/app/m/catalog/${id}` },
  tenants: { label: 'Business logo', href: () => '/app/settings/branding' },
};

export function describeUse(f: { entityType: string | null; entityId: string | null }, uses: FileUse[] | undefined) {
  if (f.entityType && f.entityId) {
    const e = ENTITY_USE[f.entityType];
    return { used: true, label: e?.label ?? f.entityType, href: e?.href?.(f.entityId) ?? null };
  }
  const u = uses?.[0];
  if (!u) return { used: false, label: 'Not used', href: null };
  const t = TABLE_USE[u.table];
  return { used: true, label: t?.label ?? u.table.replace(/_/g, ' '), href: t?.href?.(u.rowId) ?? null };
}

/** Group key for the "by area" breakdown */
export const areaOf = (label: string) =>
  /employee|hr |resume|leave|loan/i.test(label) ? 'HR' : /expense|income|payment|purchase|supplier/i.test(label) ? 'Money' : /item|stock/i.test(label) ? 'Items & stock' : /ticket|task|appointment|approval/i.test(label) ? 'Work' : /customer/i.test(label) ? 'Customers' : /logo/i.test(label) ? 'Branding' : 'Other';


// ── Settings › Files & storage: every file of the business ──

const kindOf = (mime: string) => (mime.startsWith('image/') ? 'Photo' : mime === 'application/pdf' ? 'PDF' : /sheet|excel/.test(mime) ? 'Excel' : /word/.test(mime) ? 'Word' : 'Other');

export async function fileLibrary(tenantId: string, signed: (id: string) => string) {
  const [files, uses, usage] = await Promise.all([
    db().storedFile.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' }, take: 5000 }),
    fileReferences(),
    storageUsage(tenantId),
  ]);
  const people = new Map((await db().user.findMany({ where: { id: { in: [...new Set(files.map((f) => f.uploadedBy).filter((x): x is string => !!x))] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const data = files.map((f) => {
    const use = describeUse(f, uses.get(f.id.toLowerCase()));
    return {
      id: f.id, ref: `file:${f.id}`, name: f.name, mime: f.mime, kind: kindOf(f.mime), size: f.sizeBytes, url: signed(f.id), createdAt: f.createdAt,
      uploadedBy: f.uploadedBy ? people.get(f.uploadedBy) ?? 'Someone' : 'Customer',
      used: use.used, usedFor: use.label, href: use.href, area: use.used ? areaOf(use.label) : 'Not used',
    };
  });
  const sum = (rows: typeof data) => rows.reduce((n, r) => n + r.size, 0);
  const group = (key: (r: (typeof data)[number]) => string) =>
    Object.entries(data.reduce<Record<string, typeof data>>((m, r) => ((m[key(r)] ??= []).push(r), m), {}))
      .map(([name, rows]) => ({ name, files: rows.length, bytes: sum(rows) }))
      .sort((a, b) => b.bytes - a.bytes);
  return { usage, byKind: group((r) => r.kind), byArea: group((r) => r.area), unusedBytes: sum(data.filter((r) => !r.used)), data };
}

/** Delete from Files & storage: only a file nothing uses (a used one is removed on its record) */
export async function assertUnused(tenantId: string, id: string) {
  const f = await db().storedFile.findFirst({ where: { id, tenantId } });
  if (!f) throw new AppError('NOT_FOUND', 'File not found.');
  const use = describeUse(f, (await fileReferences()).get(id.toLowerCase()));
  if (use.used) throw new AppError('CONFLICT', `This file is in use (${use.label}). Remove it there first, so that record stays correct.`);
  return f;
}
