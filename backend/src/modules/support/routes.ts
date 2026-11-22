import express, { Router } from 'express';
import { z } from 'zod';
import { withPlatform } from '../../kernel/db';
import { DateStr, IdParam } from '../../kernel/query';
import { validate } from '../../middleware/request';
import { publicRoute, requirePermission, tenantAuth, tx } from '../../middleware/auth';
import { publicLimiter, publicUploadLimiter } from '../../middleware/rateLimit';
import { saveUpload } from '../files/service';
import * as sp from './service';

// Customer Service (SUP-01…SUP-06): tickets, replies, the knowledge base, setup and the report;
// and the public request form and tracking link. Logic lives in service.ts.

/** The public request form and the customer's private tracking link: no login, rate-limited */
export const publicSupport = Router();
publicSupport.get('/public/support/:slug', publicRoute, publicLimiter, async (req, res) => {
  res.json(await withPlatform(() => sp.publicForm(String(req.params.slug))));
});
publicSupport.post('/public/support/:slug', publicRoute, publicLimiter, validate(sp.PublicTicketInput), async (req, res) => {
  res.status(201).json(await withPlatform(() => sp.publicCreate(String(req.params.slug), req.body)));
});
const Token = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{20,40}$/) });
// A photo or PDF the customer adds before sending the form or a reply (5 MB, photos and PDFs only)
const rawFile = express.raw({ type: () => true, limit: '6mb' });
const fileName = (req: express.Request) => { try { return decodeURIComponent(String(req.header('x-file-name') ?? 'file')); } catch { return 'file'; } };
const customerUpload = (tenantId: string, req: express.Request) =>
  saveUpload({ tenantId, userId: null, bytes: Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0), name: fileName(req), kind: 'customer', entityType: 'ticket', field: 'attachments' }).then((f) => ({ id: f.id, name: f.name, size: f.size, mime: f.mime }));
publicSupport.post('/public/support/:slug/files', publicRoute, publicUploadLimiter, rawFile, async (req, res) => {
  res.status(201).json(await withPlatform(async () => customerUpload((await sp.bySlug(String(req.params.slug))).tenantId, req)));
});
publicSupport.post('/public/requests/:token/files', publicRoute, publicUploadLimiter, validate(Token, 'params'), rawFile, async (req, res) => {
  res.status(201).json(await withPlatform(async () => customerUpload(await sp.ticketTenant(String(req.params.token)), req)));
});
publicSupport.get('/public/requests/:token', publicRoute, publicLimiter, validate(Token, 'params'), async (req, res) => {
  res.json(await withPlatform(() => sp.publicTicket(String(req.params.token))));
});
publicSupport.post('/public/requests/:token/reply', publicRoute, publicLimiter, validate(Token, 'params'), validate(sp.PublicReplyInput), async (req, res) => {
  res.json(await withPlatform(() => sp.publicReply(String(req.params.token), req.body)));
});
publicSupport.post('/public/requests/:token/rate', publicRoute, publicLimiter, validate(Token, 'params'), validate(sp.RateInput), async (req, res) => {
  res.json(await withPlatform(() => sp.publicRate(String(req.params.token), req.body)));
});

const router = Router();
router.use(tenantAuth);
const T = (a: string) => requirePermission(`support.ticket.${a}`);
const id = (req: { params: Record<string, unknown> }) => String(req.params.id);

// ── Tickets ──
router.get('/support/agents', T('view'), tx(async (req, res) => { res.json({ data: await sp.agents(req.ctx!), me: req.ctx!.userId }); }));
router.get('/support/tickets', T('view'), validate(sp.TicketList, 'query'), tx(async (req, res) => {
  res.json(await sp.listTickets(req.ctx!, req.query as unknown as z.infer<typeof sp.TicketList>));
}));
router.post('/support/tickets', T('create'), validate(sp.TicketInput), tx(async (req, res) => { res.status(201).json(await sp.createTicket(req.ctx!, req.body)); }));
router.get('/support/tickets/:id', T('view'), validate(IdParam, 'params'), tx(async (req, res) => { res.json(await sp.getTicket(req.ctx!, id(req))); }));
router.patch('/support/tickets/:id', T('edit'), validate(IdParam, 'params'), validate(sp.TicketPatch), tx(async (req, res) => { res.json(await sp.updateTicket(req.ctx!, id(req), req.body)); }));
router.post('/support/tickets/:id/replies', T('edit'), validate(IdParam, 'params'), validate(sp.ReplyInput), tx(async (req, res) => { res.status(201).json(await sp.reply(req.ctx!, id(req), req.body)); }));
router.delete('/support/tickets/:id', T('delete'), validate(IdParam, 'params'), tx(async (req, res) => { await sp.deleteTicket(req.ctx!, id(req)); res.status(204).end(); }));

// ── Report ──
router.get('/support/report', T('view'), validate(z.object({ from: DateStr, to: DateStr, by: z.enum(['category', 'agent', 'channel', 'day', 'customer']).default('category') }), 'query'), tx(async (req, res) => {
  res.json(await sp.supportReport(req.ctx!, req.query as never));
}));

// ── Knowledge base and saved replies ──
router.get('/support/articles', requirePermission('support.kb.view'), validate(z.object({ kind: z.enum(['article', 'reply']).optional(), q: z.string().trim().max(100).optional() }), 'query'), tx(async (req, res) => {
  res.json(await sp.listArticles(req.ctx!, req.query as never));
}));
router.post('/support/articles', requirePermission('support.kb.create'), validate(sp.ArticleInput), tx(async (req, res) => { res.status(201).json(await sp.saveArticle(req.ctx!, null, req.body)); }));
router.patch('/support/articles/:id', requirePermission('support.kb.edit'), validate(IdParam, 'params'), validate(sp.ArticleInput), tx(async (req, res) => { res.json(await sp.saveArticle(req.ctx!, id(req), req.body)); }));
router.delete('/support/articles/:id', requirePermission('support.kb.edit'), validate(IdParam, 'params'), tx(async (req, res) => { await sp.deleteArticle(req.ctx!, id(req)); res.status(204).end(); }));

// ── Setup: categories, SLA, warranty, the public form ──
router.get('/support/settings', requirePermission('support.ticket.view'), tx(async (req, res) => { res.json(await sp.getSettings(req.ctx!)); }));
router.put('/support/settings', requirePermission('support.sla.edit'), validate(sp.SettingsInput), tx(async (req, res) => { res.json(await sp.saveSettings(req.ctx!, req.body)); }));

export default router;
