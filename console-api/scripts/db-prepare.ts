// Runs before the Console API starts: creates the ahead_console database if missing, pins it to
// UTC, applies pending migrations and syncs reference data (plans, settings). Cheap when up to date.
import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { Client } from 'pg';
import { runMigrations } from '../prisma/migrate';

const WAIT_MS = 60_000;
const quoteIdent = (name: string) => `"${name.replace(/"/g, '""')}"`;
const dbName = (url: URL) => decodeURIComponent(url.pathname.replace(/^\//, ''));

/** Connect, retrying while the server comes up (a fresh container takes a few seconds) */
async function connect(connectionString: string, where: URL): Promise<Client> {
  const until = Date.now() + WAIT_MS;
  let said = false;
  for (;;) {
    const client = new Client({ connectionString, connectionTimeoutMillis: 5_000 });
    try {
      await client.connect();
      return client;
    } catch (e) {
      await client.end().catch(() => undefined);
      const reason = e instanceof Error ? e.message : String(e);
      // A wrong password or missing role won't fix itself by waiting
      if (/password|authentication|role .* does not exist/i.test(reason) || Date.now() > until) {
        throw new Error(`Can't connect to PostgreSQL at ${where.hostname}:${where.port || 5432}. Is it running, and are the user and password in DATABASE_URL right? (${reason})`);
      }
      if (!said) console.log(`db: waiting for PostgreSQL at ${where.hostname}:${where.port || 5432}…`);
      said = true;
      await new Promise((r) => setTimeout(r, 1_000));
    }
  }
}

async function ensureDatabase(url: URL) {
  const name = dbName(url);
  if (!name) throw new Error('DATABASE_URL has no database name');
  // The server's maintenance database, to look for (and make) ours
  const admin = new URL(url.toString());
  admin.pathname = '/postgres';
  admin.search = '';
  const client = await connect(admin.toString(), url);
  try {
    const { rowCount } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    if (rowCount) return false;
    await client.query(`CREATE DATABASE ${quoteIdent(name)} ENCODING 'UTF8' TEMPLATE template0`);
    console.log(`db: ✔ created database "${name}"`);
    return true;
  } finally {
    await client.end();
  }
}

/**
 * Dates are compared with timestamps all over the reports; the server's own zone (India on this
 * computer) would shift them by 5½ hours, so the database always works in UTC.
 */
async function pinUtc(url: URL) {
  const name = dbName(url);
  const client = await connect(url.toString(), url);
  try {
    const { rows } = await client.query<{ tz: string | null }>(
      `select (select s from unnest(setconfig) s where s like 'TimeZone=%') tz from pg_db_role_setting r join pg_database d on d.oid = r.setdatabase where d.datname = $1 and r.setrole = 0`,
      [name],
    );
    if (rows[0]?.tz !== 'TimeZone=UTC') {
      await client.query(`ALTER DATABASE ${quoteIdent(name)} SET timezone TO 'UTC'`);
      console.log('db: time zone set to UTC');
    }
  } finally {
    await client.end();
  }
}

async function main() {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error('DATABASE_URL is not set');
  const url = new URL(raw);
  const started = Date.now();
  const created = await ensureDatabase(url);
  await pinUtc(url);
  const ran = await runMigrations(raw, (s) => console.log(`db: ${s}`));
  // Plans and settings follow the code on first run; edits made in the Console are kept
  const seed = spawnSync(process.execPath, [require.resolve('tsx/cli'), join(__dirname, '..', 'prisma', 'seed.ts')], { stdio: 'inherit', env: process.env });
  if (seed.status !== 0) throw new Error('Seeding reference data failed');
  console.log(`db: ready${created ? ' (new database)' : ''}${ran ? `, ${ran} migration${ran === 1 ? '' : 's'} applied` : ''} in ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

main().catch((e) => {
  console.error(`db: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
