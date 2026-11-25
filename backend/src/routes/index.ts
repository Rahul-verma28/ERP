import { Router } from 'express';
import { prisma } from '../kernel/db';
import identityRoutes, { meHandler } from '../modules/identity/routes';
import accountRoutes from '../modules/account/routes';
import tenancyRoutes from '../modules/tenancy/routes';
import catalogRoutes from '../modules/catalog/routes';
import crmRoutes from '../modules/crm/routes';
import billingRoutes, { publicBilling } from '../modules/billing/routes';
import financeRoutes from '../modules/finance/routes';
import hrRoutes from '../modules/hr/routes';
import taskRoutes from '../modules/tasks/routes';
import bookingRoutes, { publicBookings } from '../modules/bookings/routes';
import supportRoutes, { publicSupport } from '../modules/support/routes';
import portalRoutes, { publicPortal } from '../modules/portal/routes';
import reportRoutes from '../modules/reports/routes';
import inventoryRoutes from '../modules/inventory/routes';
import purchaseRoutes from '../modules/purchase/routes';
import posRoutes from '../modules/pos/routes';
import fileRoutes, { publicFiles } from '../modules/files/routes';
import provisionRoutes from '../modules/licensing/provisionRoutes';
import billingPlanRoutes, { publicPlans } from '../modules/licensing/billingRoutes';
import { isDev } from '../config/env';
import { getDevOutbox } from '../modules/notifications/service';

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
router.use('/internal/v1', provisionRoutes); // the Console's signed calls into this ERP, no login
router.use('/', publicFiles); // signed file links: an <img> or a download sends no login header
router.use('/', publicBilling); // public share links, before any authenticated router
router.use('/', publicBookings); // the online booking page, no login
router.use('/', publicSupport); // the request form and tracking link, no login
router.use('/', publicPortal); // the customer portal: its own sign-in, never a staff login
// Development only: messages that would have gone by SMS or email (sign-in codes, invitations)
router.get('/dev/messages', (_req, res) => { if (!isDev) { res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found.' } }); return; } res.json({ data: getDevOutbox() }); });
router.use('/', publicPlans); // plans and coupons for the signup page, from the Console
router.use('/', billingPlanRoutes); // the owner's Plan & billing, from the Console
router.use('/', tenancyRoutes);
router.use('/', fileRoutes);
router.use('/', catalogRoutes);
router.use('/', crmRoutes);
router.use('/', billingRoutes);
router.use('/', financeRoutes);
router.use('/', hrRoutes);
router.use('/', taskRoutes);
router.use('/', bookingRoutes);
router.use('/', supportRoutes);
router.use('/', portalRoutes);
router.use('/', reportRoutes);
router.use('/', inventoryRoutes);
router.use('/', purchaseRoutes);
router.use('/', posRoutes);

export default router;
