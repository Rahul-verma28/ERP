import { relayOnce } from './modules/events/outbox';
import { runTrialExpiry } from './modules/subscription/jobs';
import { runBillingJobs } from './modules/platformBilling/jobs';
import { runAutoFollowups } from './modules/console/sales';

// Background work (LLD §2.1 worker.ts). Runs in-process in development; in production
// this becomes its own process with BullMQ queues and Redis-backed schedules.

const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 60_000;

let stopped = false;
let relayTimer: NodeJS.Timeout | undefined;
let hourlyTimer: NodeJS.Timeout | undefined;
let failures = 0;

/** Relay loop with exponential back-off while the database is unreachable (no log spam). */
async function relayLoop() {
  try {
    while ((await relayOnce()) > 0) {
      /* drain */
    }
    if (failures > 0) console.log('[worker] database reachable again, relay resumed');
    failures = 0;
  } catch (e) {
    failures++;
    // Log the first failure and then only every 10th, with the short reason
    if (failures === 1 || failures % 10 === 0) {
      const reason = e instanceof Error ? e.message.trim().split('\n').pop() : String(e);
      console.error(`[worker] relay failed (${failures}x), retrying with back-off: ${reason}`);
    }
  } finally {
    if (!stopped) {
      const delay = failures ? Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** Math.min(failures, 6)) : BASE_DELAY_MS;
      relayTimer = setTimeout(relayLoop, delay);
    }
  }
}

export function startWorker() {
  stopped = false;
  relayTimer = setTimeout(relayLoop, BASE_DELAY_MS);
  const short = (e: unknown) => (e instanceof Error ? e.message.split('\n').pop() : e);
  const hourly = async () => {
    await runTrialExpiry().catch((e) => console.error('[worker] trial expiry:', short(e)));
    await runBillingJobs().catch((e) => console.error('[worker] billing jobs:', short(e)));
    await runAutoFollowups().catch((e) => console.error('[worker] console follow-ups:', short(e)));
  };
  hourlyTimer = setInterval(hourly, 60 * 60 * 1000);
  setTimeout(hourly, 5000);
  console.log('⚙️  Worker started (outbox relay every 1s; trial expiry, renewals, dunning and reminders hourly)');
}

export function stopWorker() {
  stopped = true;
  clearTimeout(relayTimer);
  clearInterval(hourlyTimer);
}
