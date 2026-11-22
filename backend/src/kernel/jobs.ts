import { withPlatform } from './db';

/**
 * What one scheduled job did. Every item (a business, an order, a file) runs on its own: one that
 * fails is counted and its reason kept, and the rest still run. A job with any failed item is
 * recorded as failed, so a partial run never shows as fine (Console › System health).
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

  /** Run one item in its own platform transaction (it commits or rolls back alone) */
  itemTx(label: string, fn: () => Promise<unknown>) {
    return this.item(label, () => withPlatform(fn, { kind: 'platform' }, { timeoutMs: 60_000 }));
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
