import { Router } from 'express';
import { prisma } from '../../kernel/db';
import { allow, requireStaff } from '../../middleware/auth';
import { MAX_ATTEMPTS } from '../erp/deliveries';
import { erp } from '../erp/client';

// System health for Admin and Staff: is the ERP reachable, are calls to it going through,
// did the scheduled jobs run.

const router = Router();
router.use(requireStaff, allow('admin', 'staff'));

router.get('/health', async (_req, res) => {
  const started = Date.now();
  const erpOk = await erp('GET', '/tenants?ids=00000000-0000-7000-8000-000000000000', undefined, 5_000).then(
    () => true,
    () => false,
  );
  const [waiting, stuck, jobs] = await Promise.all([
    prisma.delivery.count({ where: { doneAt: null, attempts: { lt: MAX_ATTEMPTS } } }),
    prisma.delivery.findMany({ where: { doneAt: null, attempts: { gte: MAX_ATTEMPTS } }, orderBy: { createdAt: 'desc' }, take: 20, select: { id: true, kind: true, businessId: true, lastError: true, createdAt: true } }),
    prisma.jobRun.findMany({ orderBy: { name: 'asc' } }),
  ]);
  res.json({ erp: { reachable: erpOk, ms: Date.now() - started }, deliveries: { waiting, stuck }, jobs });
});

/** Try a stuck call again (after the cause was fixed) */
router.post('/deliveries/:id/retry', async (req, res) => {
  await prisma.delivery.update({ where: { id: String(req.params.id) }, data: { attempts: 0, nextAttemptAt: new Date(), lastError: null } });
  res.status(202).json({ queued: true });
});

export default router;
