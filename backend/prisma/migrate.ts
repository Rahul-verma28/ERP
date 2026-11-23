// Applies pending Prisma migrations to PostgreSQL. Records each migration in `_prisma_migrations`
// exactly like `prisma migrate deploy`, so both tools can be used interchangeably.
//
//   npm run db:migrate        → this script (npm run dev and the container run it on start)
//   npx prisma migrate deploy → Prisma CLI
import 'dotenv/config';
import { createHash, randomUUID } from 'node:crypto';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { Pool as PgPool } from 'pg';

const dir = join(__dirname, 'migrations');
/** The whole schema in one migration; it replaced the 57 step-by-step migrations of Oct–Dec 2026 */
export const BASELINE = '20261202000000_baseline';

function openPool(url: string): PgPool {
  return new PgPool({ connectionString: url, connectionTimeoutMillis: 20_000 });
}

/** Apply every migration not yet recorded; returns how many ran. */
export async function runMigrations(url: string, log: (s: string) => void = console.log): Promise<number> {
  const pool = openPool(url);
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
      "id" VARCHAR(36) PRIMARY KEY NOT NULL,
      "checksum" VARCHAR(64) NOT NULL,
      "finished_at" TIMESTAMPTZ,
      "migration_name" VARCHAR(255) NOT NULL,
      "logs" TEXT,
      "rolled_back_at" TIMESTAMPTZ,
      "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
      "applied_steps_count" INTEGER NOT NULL DEFAULT 0)`);

    const { rows } = await pool.query<{ migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }>(
      'SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations"',
    );
    const failed = rows.find((r) => !r.finished_at && !r.rolled_back_at);
    if (failed) throw new Error(`Migration ${failed.migration_name} previously failed. Fix it and mark it rolled back before continuing.`);
    const applied = new Set(rows.filter((r) => r.finished_at).map((r) => r.migration_name));

    let pending = readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && existsSync(join(dir, d.name, 'migration.sql')))
      .map((d) => d.name)
      .sort()
      .filter((name) => !applied.has(name));

    // A database built from the old step-by-step migrations (all older than the baseline) already
    // has everything the baseline makes: record the baseline as applied instead of running it.
    if (pending[0] === BASELINE && applied.size > 0 && [...applied].every((name) => name < BASELINE)) {
      const sql = readFileSync(join(dir, BASELINE, 'migration.sql'), 'utf8');
      await pool.query(
        `INSERT INTO "_prisma_migrations" (id, checksum, migration_name, finished_at, applied_steps_count, logs) VALUES ($1, $2, $3, now(), 0, $4)`,
        [randomUUID(), createHash('sha256').update(sql).digest('hex'), BASELINE, 'Built from the earlier step-by-step migrations; baseline marked as applied'],
      );
      log(`✔ ${BASELINE} marked as applied (database built from the earlier migrations)`);
      pending = pending.slice(1);
    }

    if (!pending.length) {
      log(`No pending migrations (${applied.size} applied).`);
      return 0;
    }

    for (const name of pending) {
      const sql = readFileSync(join(dir, name, 'migration.sql'), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const id = randomUUID();
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('INSERT INTO "_prisma_migrations" (id, checksum, migration_name) VALUES ($1, $2, $3)', [id, checksum, name]);
        await client.query(sql);
        await client.query('UPDATE "_prisma_migrations" SET finished_at = now(), applied_steps_count = 1 WHERE id = $1', [id]);
        await client.query('COMMIT');
        log(`✔ applied ${name}`);
      } catch (e) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${name} failed: ${e instanceof Error ? e.message : e}`);
      } finally {
        client.release();
      }
    }
    return pending.length;
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  runMigrations(url).catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
