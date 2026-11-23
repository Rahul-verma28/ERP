import { prisma } from './db';

/**
 * What one scheduled job did. Every item (a business, an order, a file) runs on its own: one that
 * fails is counted and its reason kept, and the rest still run. A job with any failed item is
 * recorded as failed, so a partial run never shows as fine (System health).
 */
export class JobTally {
  done = 0;
  failed = 0;
  /** The first few reasons, enough to find the problem */
  readonly errors: string[] = [];
  /** Counts worth showing, e.g. "3 trials ended" */
  readonly notes: string[] = [];

  /** Run one item; a failure is counted, never thrown */
  async item(label: string, fn: () => Promise<unknown>) {
    try {
      await fn();
      this.done++;
      return true;
    } catch (e) {
      this.failed++;
      if (this.errors.length < 5) this.errors.push(`${label}: ${reason(e)}`);
      console.error(`[job] ${label}:`, reason(e));
      return false;
    }
  }

  note(text: string | false | null | undefined | 0) {
    if (text) this.notes.push(text);
  }

  /** Add another part's counts (a job made of steps) */
  add(other: JobTally, step?: string) {
    this.done += other.done;
    this.failed += other.failed;
    for (const e of other.errors) if (this.errors.length < 5) this.errors.push(step ? `${step} · ${e}` : e);
    this.notes.push(...other.notes);
    return this;
  }

  summary() {
    const parts = [...this.notes, `${this.done} done`];
    if (this.failed) parts.push(`${this.failed} failed`);
    return parts.join(', ');
  }
}

/** The useful last line of an error */
export const reason = (e: unknown) => ((e instanceof Error ? e.message : String(e)).trim().split('\n').pop() || 'Failed').slice(0, 500);

/** A run that dies holds its lock no longer than this */
const LEASE_MINUTES = 30;

/**
 * Run a job at most once at a time (across servers) and record how it went. Never throws;
 * returns the error text, or null when it went fine.
 */
export async function runTracked(name: string, run: () => Promise<JobTally>): Promise<string | null> {
  await prisma.jobRun.createMany({ data: [{ name }], skipDuplicates: true });
  const taken = await prisma.$executeRaw`UPDATE job_runs SET locked_until = now() + make_interval(mins => ${LEASE_MINUTES}::int), last_started_at = now() WHERE name = ${name} AND (locked_until IS NULL OR locked_until < now())`;
  if (taken !== 1) return 'Already running.';
  let error: string | null = null;
  let summary: string | null = null;
  try {
    const t = await run();
    summary = t.summary();
    if (t.failed) error = t.errors.join(' · ');
  } catch (e) {
    error = reason(e);
  }
  await prisma.jobRun.update({ where: { name }, data: { lockedUntil: null, lastFinishedAt: new Date(), lastError: error, lastSummary: summary } }).catch(() => undefined);
  return error;
}
