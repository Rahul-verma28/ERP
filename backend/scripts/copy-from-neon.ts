// One-time copy of all rows from Neon (NEON_DATABASE_URL*) into the local database (DATABASE_URL).
// Neon is only read. The local database is emptied first, then filled table by table; foreign keys
// are switched off for the copy (session_replication_role), so table order doesn't matter.
//   npm run db:copy-from-neon
import 'dotenv/config';
import { Pool as NeonPool, neonConfig } from '@neondatabase/serverless';
import { Client } from 'pg';
import ws from 'ws';

neonConfig.webSocketConstructor = ws;
const BATCH = 1000;

async function main() {
  const from = process.env.NEON_DATABASE_URL_UNPOOLED ?? process.env.NEON_DATABASE_URL;
  const to = process.env.DATABASE_URL;
  if (!from) throw new Error('NEON_DATABASE_URL is not set');
  if (!to || /\.neon\.tech/.test(to)) throw new Error('DATABASE_URL must point at the local database');

  const neon = new NeonPool({ connectionString: from, max: 4, connectionTimeoutMillis: 20_000 });
  const local = new Client({ connectionString: to });
  await local.connect();
  const started = Date.now();
  try {
    const { rows: tables } = await local.query<{ t: string }>(
      `select c.relname t from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relname <> '_prisma_migrations' order by 1`,
    );
    await local.query('BEGIN');
    await local.query(`SET LOCAL session_replication_role = replica`);
    await local.query(`TRUNCATE ${tables.map((r) => `"${r.t}"`).join(', ')}`);
    let total = 0;
    for (const { t } of tables) {
      // Columns we can write (generated ones are computed again here)
      const { rows: cols } = await local.query<{ c: string }>(
        `select a.attname c from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relname = $1 and a.attnum > 0 and not a.attisdropped and a.attgenerated = '' order by a.attnum`,
        [t],
      );
      const list = cols.map((r) => `"${r.c}"`).join(', ');
      let copied = 0;
      for (let offset = 0; ; offset += BATCH) {
        const { rows } = await neon.query<{ j: unknown[] | null }>(`select json_agg(x) j from (select ${list} from "${t}" order by ctid limit ${BATCH} offset ${offset}) x`);
        const batch = rows[0]?.j ?? [];
        if (!batch.length) break;
        await local.query(`insert into "${t}" (${list}) select ${list} from json_populate_recordset(null::"${t}", $1::json)`, [JSON.stringify(batch)]);
        copied += batch.length;
        if (batch.length < BATCH) break;
      }
      if (copied) console.log(`  ${t}: ${copied}`);
      total += copied;
    }
    // Serial/identity counters continue after the copied rows
    const { rows: seqs } = await local.query<{ s: string; t: string; c: string }>(
      `select s.relname s, t.relname t, a.attname c from pg_class s join pg_depend d on d.objid = s.oid
       join pg_class t on t.oid = d.refobjid join pg_attribute a on a.attrelid = t.oid and a.attnum = d.refobjsubid
       where s.relkind = 'S'`,
    );
    for (const q of seqs) await local.query(`select setval('"${q.s}"', coalesce((select max("${q.c}") from "${q.t}"), 0) + 1, false)`);
    await local.query('COMMIT');
    console.log(`✔ copied ${total} rows from ${tables.length} tables in ${((Date.now() - started) / 1000).toFixed(0)}s`);
  } catch (e) {
    await local.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    await local.end();
    await neon.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
