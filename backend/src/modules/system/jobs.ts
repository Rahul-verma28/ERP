import { prisma } from '../../kernel/db';
import { JobTally, reason } from '../../kernel/jobs';
import { runTrialExpiry } from '../subscription/jobs';
import { runBillingJobs } from '../platformBilling/jobs';
import { runAutoFollowups } from '../console/sales';
import { runCleanup } from './cleanup';
import { runSupportAutoClose } from '../support/jobs';

// The scheduled jobs and their last run (Console › System health). The worker runs them hourly;
// an Admin can run one now. Each job is safe to run again: it only acts on what is due, and each
// item in it runs on its own, so one bad business never stops the rest.

export const JOBS = {
  trial_expiry: { label: 'Trial endings', text: 'Ends free trials that are over and moves the business to Free', run: () => runTrialExpiry() },
  billing: { label: 'Renewals & payments', text: 'Renewal orders, overdue payments, unpaid orders, trial reminders and module switches that ended', run: () => runBillingJobs() },
  followups: { label: 'Sales follow-ups', text: 'Creates follow-up reminders for the Console sales team', run: () => runAutoFollowups() },
  support_auto_close: { label: 'Close solved tickets', text: 'Closes resolved tickets the customer did not reopen, after the days set in Customer Service', run: () => runSupportAutoClose() },
  cleanup: { label: 'Clean-up', text: 'Removes files nobody kept, used sign-in codes, old sessions and old background events', run: () => runCleanup() },
} as const satisfies Record<string, { label: string; text: string; run: () => Promise<JobTally> }>;
export type JobKey = keyof typeof JOBS;
export const JOB_KEYS = Object.keys(JOBS) as JobKey[];

/** Returned when the job is already running (on this or another server) */
export const ALREADY_RUNNING = 'Already running. Try again when this run ends.';

/** A run that dies holds its lock no longer than this */
const LEASE_MINUTES = 30;

/** Take the job's lock; false if another run holds it */
async function lock(key: JobKey) {
  await prisma.jobRun.createMany({ data: [{ name: key }], skipDuplicates: true });
  const taken = await prisma.$executeRaw`
    UPDATE job_runs SET locked_until = now() + make_interval(mins => ${LEASE_MINUTES}::int), last_started_at = now()
     WHERE name = ${key} AND (locked_until IS NULL OR locked_until < now())`;
  return taken === 1;
}

/**
 * Run one job and record the outcome. Never throws; returns the error text if it failed (a crash,
 * or any item that failed), or null. Runs at most once at a time, across every server.
 */
export async function runTracked(key: JobKey): Promise<string | null> {
  let locked: boolean;
  try {
    locked = await lock(key);
  } catch (e) {
    return `Could not start: ${reason(e)}`;
  }
  if (!locked) return ALREADY_RUNNING; // that run records its own outcome

  let tally: JobTally | null = null;
  let crash: string | null = null;
  try {
    tally = await JOBS[key].run();
  } catch (e) {
    crash = reason(e);
  }
  const failed = crash ?? (tally && tally.failed ? `${tally.failed} of ${tally.done + tally.failed} failed. ${tally.errors.join(' | ')}`.slice(0, 1000) : null);
  const now = new Date();
  await prisma.jobRun
    .update({
      where: { name: key },
      data: {
        lockedUntil: null,
        lastFinishedAt: now,
        runs: { increment: 1 },
        lastSummary: tally ? tally.summary() : 'Stopped with an error',
        ...(failed ? { lastError: failed, failures: { increment: 1 } } : { lastError: null, lastOkAt: now }),
      },
    })
    .catch((e) => console.error(`[jobs] could not record ${key}:`, reason(e)));
  if (tally && (tally.done || tally.failed || tally.notes.length)) console.log(`[jobs] ${key}: ${tally.summary()}`);
  return failed;
}
