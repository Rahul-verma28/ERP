import express, { Router, type Request } from 'express';
import { z } from 'zod';
import { withPlatform } from '../../kernel/db';
import { IdParam } from '../../kernel/query';
import { validate } from '../../middleware/request';
import { publicRoute, requirePermission, tenantAuth, tx } from '../../middleware/auth';
import { publicLimiter, publicUploadLimiter } from '../../middleware/rateLimit';
import { saveUpload } from '../files/service';
import * as portal from './service';

// Customer portal routes. The customer's sign-in travels in X-Portal-Token and the chosen
// customer record in X-Portal-Account, so a staff login in the same browser never mixes in.

export const publicPortal = Router();
const Slug = z.object({ slug: z.string().regex(/^[a-z0-9-]{3,40}$/) });
const slug = (req: Request) => String(req.params.slug);
/** Runs fn for the signed-in customer of this portal */
const as = <T>(req: Request, fn: (x: Awaited<ReturnType<typeof portal.session>>) => Promise<T>) =>
  withPlatform(async () => fn(await portal.session(slug(req), req.header('x-portal-token') ?? undefined, String(req.header('x-portal-account') ?? ''))));

publicPortal.get('/public/portal/:slug', publicRoute, publicLimiter, validate(Slug, 'params'), async (req, res) => {
  res.json(await withPlatform(() => portal.publicInfo(slug(req))));
});
publicPortal.post('/public/portal/:slug/code', publicRoute, publicLimiter, validate(Slug, 'params'), validate(portal.OtpInput), async (req, res) => {
  res.json(await withPlatform(() => portal.requestCode(slug(req), req.body)));
});
publicPortal.post('/public/portal/:slug/verify', publicRoute, publicLimiter, validate(Slug, 'params'), validate(portal.VerifyInput), async (req, res) => {
  res.json(await withPlatform(() => portal.verifyCode(slug(req), req.body)));
});
publicPortal.post('/public/portal/:slug/link', publicRoute, publicLimiter, validate(Slug, 'params'), validate(portal.LinkInput), async (req, res) => {
  res.json(await withPlatform(() => portal.linkSignIn(slug(req), req.body)));
});
publicPortal.get('/public/portal/:slug/home', publicRoute, publicLimiter, validate(Slug, 'params'), async (req, res) => { res.json(await as(req, portal.home)); });
publicPortal.get('/public/portal/:slug/documents', publicRoute, publicLimiter, validate(Slug, 'params'), async (req, res) => { res.json(await as(req, portal.documents)); });
publicPortal.post('/public/portal/:slug/quotes/:id', publicRoute, publicLimiter, validate(Slug.extend({ id: z.string().uuid() }), 'params'), validate(portal.ReplyInput), async (req, res) => {
  res.json(await as(req, (x) => portal.replyToQuote(x, String(req.params.id), req.body)));
});
publicPortal.get('/public/portal/:slug/statement', publicRoute, publicLimiter, validate(Slug, 'params'), validate(portal.StatementQuery, 'query'), async (req, res) => {
  res.json(await as(req, (x) => portal.statement(x, req.query as z.infer<typeof portal.StatementQuery>)));
});
publicPortal.get('/public/portal/:slug/requests', publicRoute, publicLimiter, validate(Slug, 'params'), async (req, res) => { res.json(await as(req, portal.requests)); });
publicPortal.post('/public/portal/:slug/requests', publicRoute, publicLimiter, validate(Slug, 'params'), validate(portal.RequestInput), async (req, res) => {
  res.status(201).json(await as(req, (x) => portal.raiseRequest(x, req.body)));
});
// A photo or PDF for a request, uploaded before the request is sent (signed-in customers only)
publicPortal.post('/public/portal/:slug/files', publicRoute, publicUploadLimiter, validate(Slug, 'params'), express.raw({ type: () => true, limit: '6mb' }), async (req, res) => {
  const name = (() => { try { return decodeURIComponent(String(req.header('x-file-name') ?? 'file')); } catch { return 'file'; } })();
  res.status(201).json(await as(req, async (x) => {
    const f = await saveUpload({ tenantId: x.s.tenantId, userId: null, bytes: Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0), name, kind: 'customer', entityType: 'ticket', field: 'attachments' });
    return { id: f.id, name: f.name, size: f.size, mime: f.mime };
  }));
});
publicPortal.get('/public/portal/:slug/bookings', publicRoute, publicLimiter, validate(Slug, 'params'), async (req, res) => { res.json(await as(req, portal.bookings)); });

const router = Router();
router.use(tenantAuth);
router.get('/portal/settings', requirePermission('billing.invoice.view'), tx(async (req, res) => { res.json(await portal.getSettings(req.ctx!)); }));
router.put('/portal/settings', requirePermission('tenant.settings.edit'), validate(portal.SettingsInput), tx(async (req, res) => { res.json(await portal.saveSettings(req.ctx!, req.body)); }));
router.get('/customers/:id/portal', requirePermission('crm.contact.view'), validate(IdParam, 'params'), tx(async (req, res) => { res.json(await portal.contactPortal(req.ctx!, String(req.params.id))); }));
router.post('/customers/:id/portal-link', requirePermission('crm.contact.edit'), validate(IdParam, 'params'), tx(async (req, res) => { res.json(await portal.portalLink(req.ctx!, String(req.params.id))); }));
router.post('/customers/:id/portal-access', requirePermission('crm.contact.edit'), validate(IdParam, 'params'), validate(z.object({ blocked: z.boolean() })), tx(async (req, res) => {
  res.json(await portal.setBlocked(req.ctx!, String(req.params.id), req.body.blocked));
}));

export default router;
