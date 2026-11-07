import { Router } from 'express';
import { prisma } from '../kernel/db';
import identityRoutes, { meHandler } from '../modules/identity/routes';
import accountRoutes from '../modules/account/routes';
import tenancyRoutes from '../modules/tenancy/routes';
import catalogRoutes from '../modules/catalog/routes';
import crmRoutes from '../modules/crm/routes';
import billingRoutes, { publicBilling } from '../modules/billing/routes';
import financeRoutes from '../modules/finance/routes';
import taskRoutes from '../modules/tasks/routes';
import bookingRoutes from '../modules/bookings/routes';
import reportRoutes from '../modules/reports/routes';
import inventoryRoutes from '../modules/inventory/routes';
import purchaseRoutes from '../modules/purchase/routes';
import consoleRoutes from '../modules/console/routes';
import { publicPayments, tenantPayments } from '../modules/platformBilling/routes';

const router = Router();

// Health check endpoint (includes a DB round-trip)
router.get('/health', async (_req, res) => {
  const started = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok', database: 'up', uptime: process.uptime(), dbLatencyMs: Date.now() - started, timestamp: new Date().toISOString() });
  } catch (e) {
    res.status(503).json({ status: 'degraded', database: 'down', reason: e instanceof Error ? e.message.trim().split('\n').pop() : String(e), timestamp: new Date().toISOString() });
  }
});

router.use('/auth', identityRoutes);
router.use('/me', meHandler);
router.use('/account', accountRoutes); // My account: every business
router.use('/console', consoleRoutes); // AHEAD team workspace; before the tenant routers
router.use('/', publicBilling); // public share links, before any authenticated router
router.use('/', publicPayments); // gateway webhooks (+ dev test gateway), signed, no login
router.use('/', tenantPayments); // what the client owes AHEAD
router.use('/', tenancyRoutes);
router.use('/', catalogRoutes);
router.use('/', crmRoutes);
router.use('/', billingRoutes);
router.use('/', financeRoutes);
router.use('/', taskRoutes);
router.use('/', bookingRoutes);
router.use('/', reportRoutes);
router.use('/', inventoryRoutes);
router.use('/', purchaseRoutes);

export default router;
