import type { Prisma } from '@prisma/client';
import { prisma } from '../../kernel/db';
import { runTrialExpiry } from '../subscription/jobs';
import { runBillingJobs } from '../platformBilling/jobs';
import { runAutoFollowups } from '../console/sales';

// The scheduled jobs and their last run (Console › System health). The worker runs them hourly;
// an Admin can run one now. Each job is safe to run again: it only acts on what is due.

export const JOBS = {
  trial_expiry: { label: 'Trial endings', text: 'Ends free trials that are over and moves the business to Free', run: () => runTrialExpiry() },
  billing: { label: 'Renewals & payments', text: 'Renewal orders, overdue payments, unpaid orders, trial reminders and module switches that ended', run: () => runBillingJobs() },
  followups: { label: 'Sales follow-ups', text: 'Creates follow-up reminders for the Console sales team', run: () => runAutoFollowups() },
} as const;
export type JobKey = keyof typeof JOBS;
export const JOB_KEYS = Object.keys(JOBS) as JobKey[];

/** Run one job and record the outcome. Never throws; returns the error text if it failed. */
export async function runTracked(key: JobKey): Promise<string | null> {
  // Recording is best effort: a database outage must not hide the job's own error
  const lastLine = (e: unknown) => (e instanceof Error ? e.message : String(e)).trim().split('\n').pop()?.slice(0, 1000) || 'Failed';
  // Prisma checks both branches of an upsert, so the create side gets plain counts
  const record = (create: { runs: number; failures: number }, update: Prisma.JobRunUpdateInput) =>
    prisma.jobRun
      .upsert({ where: { name: key }, create: { name: key, ...(update as object), ...create }, update })
      .catch((e) => console.error(`[jobs] could not record ${key}:`, lastLine(e)));
  await record({ runs: 0, failures: 0 }, { lastStartedAt: new Date() });
  try {
    await JOBS[key].run();
    const now = new Date();
    await record({ runs: 1, failures: 0 }, { lastFinishedAt: now, lastOkAt: now, lastError: null, runs: { increment: 1 } });
    return null;
  } catch (e) {
    const message = lastLine(e);
    await record({ runs: 1, failures: 1 }, { lastFinishedAt: new Date(), lastError: message, runs: { increment: 1 }, failures: { increment: 1 } });
    return message;
  }
}
