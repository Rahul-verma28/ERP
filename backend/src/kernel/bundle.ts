import { Prisma } from '@prisma/client';
import { db } from './db';

// Reads in ONE database round trip. Every request runs in one transaction, where queries go one
// after another; with the database far away each costs ~300 ms, so a list that made 8 queries took
// 3 s. A bundle sends every SELECT a page needs as one statement and gets back one row of JSON.
//
// Rows come back shaped like Prisma's: camelCase keys, dates as Date, *Paise and `amount` as BigInt.
// Only top-level keys are revived; JSON built inside a part (json_build_object) comes back as written.

const DATE = /^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/;
const camel = (k: string) => k.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());

function revive(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    const key = camel(k);
    if (typeof v === 'string' && DATE.test(v)) out[key] = new Date(v.length === 10 ? `${v}T00:00:00.000Z` : v);
    else if ((key.endsWith('Paise') || key === 'amount') && typeof v === 'number') out[key] = BigInt(Math.round(v));
    else out[key] = v;
  }
  return out;
}

// Callers know each part's shape; rows are typed loosely on purpose (like a raw query)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Row = Record<string, any>;

/** Runs every SELECT in `parts` as one statement. Each part returns its rows (possibly none). */
export async function bundle<K extends string>(parts: Record<K, Prisma.Sql>): Promise<Record<K, Row[]>> {
  const keys = Object.keys(parts) as K[];
  const cols = keys.map((k) => Prisma.sql`(select coalesce(json_agg(x), '[]'::json) from (${parts[k]}) x) as ${Prisma.raw(`"${k}"`)}`);
  const [row] = await db().$queryRaw<Record<K, Record<string, unknown>[]>[]>(Prisma.sql`select ${Prisma.join(cols, ', ')}`);
  const out = {} as Record<K, Row[]>;
  for (const k of keys) out[k] = (row[k] ?? []).map(revive);
  return out;
}

/** The people (logins) of this business, to turn created_by ids into names. Spread into a bundle. */
export const userPart = (tenantId: string) => ({
  _user: Prisma.sql`select u.id, u.name from users u join tenant_members m on m.user_id = u.id where m.tenant_id = ${tenantId}::uuid`,
});
export const userNames = (b: { _user: Row[] }) => new Map<string, string>(b._user.map((r) => [r.id as string, r.name as string]));
