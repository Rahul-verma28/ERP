import { Router } from 'express';
import { z } from 'zod';
import { consoleApi } from '../../kernel/consoleClient';
import { publicRoute, requirePermission, tenantAuth } from '../../middleware/auth';
import { validate } from '../../middleware/request';
import { publicLimiter } from '../../middleware/rateLimit';

// The owner's Plan & billing and the plans on the signup page. AHEAD's plans, bills and invoices
// live in the Console; this ERP only passes the owner's requests on (signed) for their own business.

export const publicPlans = Router();

publicPlans.get('/billing/plans', publicRoute, publicLimiter, async (_req, res) => {
  res.json(await consoleApi('GET', '/plans'));
});

publicPlans.get('/public/coupons/:code', publicRoute, publicLimiter, validate(z.object({ code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{2,20}$/, 'Use letters and digits') }), 'params'), async (req, res) => {
  res.json(await consoleApi('GET', `/coupons/${encodeURIComponent(String(req.params.code))}`));
});

const router = Router();
router.use(...tenantAuth);

const Order = z.object({
  planKey: z.string().min(1, 'Choose a plan').max(40),
  cycle: z.enum(['monthly', 'yearly']),
  extraUsers: z.number().int().min(0).max(500).default(0),
  couponCode: z.string().trim().toUpperCase().max(20).nullish(),
});

router.get('/billing', requirePermission('tenant.billing.view'), async (req, res) => {
  res.json(await consoleApi('GET', `/businesses/${req.ctx!.tenantId}/billing`));
});
router.post('/billing/quote', requirePermission('tenant.billing.view'), validate(Order), async (req, res) => {
  res.json(await consoleApi('POST', `/businesses/${req.ctx!.tenantId}/billing/quote`, req.body));
});
router.post('/billing/orders', requirePermission('tenant.billing.edit'), validate(Order), async (req, res) => {
  res.status(201).json(await consoleApi('POST', `/businesses/${req.ctx!.tenantId}/billing/orders`, req.body));
});
router.post('/billing/orders/:id/link', requirePermission('tenant.billing.edit'), validate(z.object({ id: z.string().uuid() }), 'params'), async (req, res) => {
  res.json(await consoleApi('POST', `/businesses/${req.ctx!.tenantId}/billing/orders/${String(req.params.id)}/link`));
});
router.get('/billing/invoices/:id', requirePermission('tenant.billing.view'), validate(z.object({ id: z.string().uuid() }), 'params'), async (req, res) => {
  res.json(await consoleApi('GET', `/businesses/${req.ctx!.tenantId}/invoices/${String(req.params.id)}`));
});

export default router;
