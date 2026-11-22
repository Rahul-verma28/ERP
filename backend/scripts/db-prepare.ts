// Runs before `npm run dev`: gets a local PostgreSQL ready with no manual steps.
//   1. The database in DATABASE_URL doesn't exist → create it
//   2. Apply any pending migrations (the same SQL that built Neon, so tables, RLS and roles match)
//   3. Sync reference data from code (modules, plans, permissions, roles, templates)
// On a database that is already up to date it only checks and moves on.
// Neon (or any non-local URL) is left alone: there it's `npm run db:migrate` + `npm run db:seed`.
import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { Client } from 'pg';
import { isNeonUrl, runMigrations } from '../prisma/migrate';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

async function ensureDatabase(url: URL) {
  const name = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!name) throw new Error('DATABASE_URL has no database name');
  // Connect to the server's maintenance database to look for (and make) ours
  const admin = new URL(url.toString());
  admin.pathname = '/postgres';
  admin.search = '';
  const client = new Client({ connectionString: admin.toString(), connectionTimeoutMillis: 10_000 });
  try {
    await client.connect();
  } catch (e) {
    throw new Error(`Can't reach PostgreSQL at ${url.hostname}:${url.port || 5432}. Is the service running and the user/password in .env right? (${e instanceof Error ? e.message : e})`);
  }
  try {
    const { rowCount } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    if (rowCount) return false;
    await client.query(`CREATE DATABASE "${name.replace(/"/g, '""')}" ENCODING 'UTF8' TEMPLATE template0`);
    console.log(`✔ created database "${name}"`);
    return true;
  } finally {
    await client.end();
  }
}

/**
 * Neon runs in UTC. A local server takes the computer's zone (India), which shifts every
 * date-vs-timestamp comparison by 5½ hours, so the database is pinned to UTC like Neon.
 */
async function matchNeonSettings(url: URL) {
  const name = decodeURIComponent(url.pathname.replace(/^\//, ''));
  const client = new Client({ connectionString: url.toString(), connectionTimeoutMillis: 10_000 });
  await client.connect();
  try {
    const { rows } = await client.query<{ tz: string | null }>(
      `select (select s from unnest(setconfig) s where s like 'TimeZone=%') tz from pg_db_role_setting r join pg_database d on d.oid = r.setdatabase where d.datname = $1 and r.setrole = 0`,
      [name],
    );
    if (rows[0]?.tz !== 'TimeZone=UTC') {
      await client.query(`ALTER DATABASE "${name.replace(/"/g, '""')}" SET timezone TO 'UTC'`);
      console.log('db: time zone set to UTC (same as Neon)');
    }
  } finally {
    await client.end();
  }
}

async function main() {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error('DATABASE_URL is not set');
  if (isNeonUrl(raw)) return console.log('db: Neon in use, skipping local setup');
  const url = new URL(raw);
  if (!LOCAL_HOSTS.has(url.hostname)) return console.log(`db: ${url.hostname} is not local, skipping local setup`);

  const started = Date.now();
  const created = await ensureDatabase(url);
  await matchNeonSettings(url);
  const ran = await runMigrations(raw, (s) => console.log(`db: ${s}`));
  // Reference data follows the code; cheap on a local database, so it runs every start
  const seed = spawnSync(process.execPath, [require.resolve('tsx/cli'), join(__dirname, '..', 'prisma', 'seed.ts')], { stdio: 'inherit', env: process.env });
  if (seed.status !== 0) throw new Error('Seeding reference data failed');
  console.log(`db: ready${created ? ' (new database)' : ''}${ran ? `, ${ran} migration${ran === 1 ? '' : 's'} applied` : ''} in ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

main().catch((e) => {
  console.error(`db: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
