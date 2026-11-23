import { app } from './app';
import { env } from './config/env';
import { runTracked } from './kernel/jobs';
import { runDeliveries } from './modules/erp/deliveries';
import { runLicenceJobs } from './modules/licences/jobs';

const server = app.listen(env.PORT, () => {
  console.log(`🧭 Console API on http://localhost:${env.PORT} (ERP: ${env.ERP_URL}, deployment ${env.DEPLOYMENT_ID})`);
});

// The worker: calls to the ERP every few seconds, licences and trials every hour
if (env.RUN_WORKER) {
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const t = await runDeliveries();
      if (t.done || t.failed) console.log(`[deliveries] ${t.summary()}`);
    } catch (e) {
      console.error('[deliveries]', e instanceof Error ? e.message : e);
    } finally {
      busy = false;
    }
  };
  const hourly = async () => {
    const err = await runTracked('licences', () => runLicenceJobs());
    if (err && err !== 'Already running.') console.error('[licences]', err);
  };
  setInterval(() => void tick(), 3_000).unref();
  setInterval(() => void hourly(), 3_600_000).unref();
  setTimeout(() => void hourly(), 10_000).unref();
  console.log('⚙️  Worker: ERP calls every 3 s, licences and trials hourly');
}

for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => server.close(() => process.exit(0)));
