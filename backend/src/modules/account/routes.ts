import { Router } from 'express';
import { z } from 'zod';
import { db, withPlatform } from '../../kernel/db';
import { AppError } from '../../kernel/errors';
import { authenticate } from '../../middleware/auth';
import { accountLimiter } from '../../middleware/rateLimit';
import { validate } from '../../middleware/request';
import { zEmail, zMobileIN, zPersonName } from '../../kernel/zodRules';
import { DATE_FORMATS, TEAM_EVENTS } from '../../contracts/account';
import { FONTS } from '../../contracts/workspace';
import { clearRefreshCookie } from '../identity/tokens';
import { cache } from '../../kernel/cache';
import { audit } from '../audit/service';
import * as account from './service';

// /api/v1/account — the signed-in person, in every business (My account).

const router = Router();
router.use(authenticate);

const me = (req: Parameters<Parameters<typeof router.get>[1]>[0]) => req.auth!.sub;
const run = <T>(fn: () => Promise<T>) => withPlatform(fn);

router.get('/', async (req, res) => {
  const out = await run(() => account.accountOverview(me(req), req.auth!.sid));
  const trusted = await account.trustedUserAgents(me(req));
  res.json({ ...out, trustedDevices: trusted.size });
});

router.patch('/profile', validate(z.object({ name: zPersonName })), async (req, res) => {
  await run(() => account.updateProfile(me(req), req.body.name));
  res.json({ name: req.body.name });
});

const teamKeys = TEAM_EVENTS.map((e) => e.key) as [string, ...string[]];
const Preferences = z.object({
  theme: z.enum(['workspace', 'light', 'dark', 'system']),
  font: z.enum(['workspace', ...FONTS.map((f) => f.key)] as [string, ...string[]]),
  density: z.enum(['workspace', 'comfortable', 'compact']),
  startPage: z.string().regex(/^[a-z_]{2,30}$/, 'Choose a start page'),
  dateFormat: z.enum(DATE_FORMATS.map((d) => d.key) as [string, ...string[]]),
  mutedAlerts: z.object({ email: z.array(z.enum(teamKeys)).max(20), inApp: z.array(z.enum(teamKeys)).max(20) }),
  defaultTenantId: z.string().uuid().nullish(),
}).partial(); // A choice can be saved on its own; what isn't sent stays as stored

router.put('/preferences', validate(Preferences), async (req, res) => {
  const { defaultTenantId, ...prefs } = req.body as z.infer<typeof Preferences>;
  const saved = await run(() => account.updatePreferences(me(req), prefs as never, defaultTenantId));
  res.json({ preferences: saved });
});

// ── Email / mobile change ──

router.post('/email/start', accountLimiter, validate(z.object({ value: zEmail, password: z.string().min(1, 'Enter your password') })), async (req, res) => {
  res.json(await run(() => account.startContactChange(me(req), 'email', req.body.value, req.body.password)));
});
router.post('/mobile/start', accountLimiter, validate(z.object({ value: zMobileIN, password: z.string().min(1, 'Enter your password') })), async (req, res) => {
  res.json(await run(() => account.startContactChange(me(req), 'mobile', req.body.value, req.body.password)));
});
const Confirm = z.object({ changeToken: z.string().min(10), code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code') });
router.post('/email/confirm', accountLimiter, validate(Confirm), async (req, res) => {
  res.json(await run(() => account.confirmContactChange(req, me(req), 'email', req.body.changeToken, req.body.code)));
});
router.post('/mobile/confirm', accountLimiter, validate(Confirm), async (req, res) => {
  res.json(await run(() => account.confirmContactChange(req, me(req), 'mobile', req.body.changeToken, req.body.code)));
});

// ── Password ──

router.post(
  '/password',
  accountLimiter,
  validate(z.object({ current: z.string().min(1, 'Enter your current password'), password: z.string().min(1, 'Enter a new password').max(64, 'Use up to 64 characters'), signOutOthers: z.boolean().default(true) })),
  async (req, res) => {
    res.json(await run(() => account.changePassword(req, me(req), req.auth!.sid, req.body.current, req.body.password, req.body.signOutOthers)));
  },
);

// ── Sessions & sign-in history ──

router.get('/sessions', async (req, res) => {
  const [sessions, current, trusted] = await Promise.all([
    account.listSessions({ userId: me(req) }),
    withPlatform(() => db().userSession.findUnique({ where: { id: req.auth!.sid }, select: { familyId: true } })),
    account.trustedUserAgents(me(req)),
  ]);
  res.json({
    sessions: sessions.map(({ userAgent, ...s }) => ({ ...s, current: s.familyId === current?.familyId, trusted: trusted.has(userAgent ?? '') })),
    trustedCount: trusted.size,
  });
});

router.delete('/sessions/:familyId', validate(z.object({ familyId: z.string().uuid() }), 'params'), async (req, res) => {
  const familyId = String(req.params.familyId);
  const current = await withPlatform(() => db().userSession.findUnique({ where: { id: req.auth!.sid }, select: { familyId: true } }));
  if (current?.familyId === familyId) throw new AppError('VALIDATION_FAILED', 'Use Sign out to end this session.');
  const n = await run(() => account.revokeFamily(familyId, me(req)));
  if (!n) throw new AppError('NOT_FOUND', 'That session has already ended.');
  res.status(204).end();
});

router.post('/sessions/sign-out-others', async (req, res) => {
  res.json({ signedOut: await run(() => account.signOutOtherSessions(me(req), req.auth!.sid)) });
});

router.post('/sessions/not-me', async (req, res) => {
  const n = await run(() => account.notMe(req, me(req)));
  clearRefreshCookie(res);
  res.json({ signedOut: n });
});

router.get('/sign-ins', async (req, res) => {
  res.json({ events: await account.listSignIns(me(req)) });
});

// ── My businesses ──

router.post('/businesses/:tenantId/leave', validate(z.object({ tenantId: z.string().uuid() }), 'params'), async (req, res) => {
  const tenantId = String(req.params.tenantId);
  await run(async () => {
    const m = await db().tenantMember.findUnique({ where: { tenantId_userId: { tenantId, userId: me(req) } }, include: { tenant: { select: { ownerUserId: true, name: true } } } });
    if (!m || m.status !== 'active') throw new AppError('NOT_FOUND', "You're not a member of this business.");
    if (m.tenant.ownerUserId === me(req)) throw new AppError('PERMISSION_DENIED', `You own ${m.tenant.name}. Transfer ownership before leaving, or close the business.`);
    await db().tenantMember.update({ where: { id: m.id }, data: { status: 'deactivated', deactivatedAt: new Date(), version: { increment: 1 } } });
    await db().userSession.updateMany({ where: { userId: me(req), tenantId, revokedAt: null, id: { not: req.auth!.sid } }, data: { revokedAt: new Date() } });
    await audit({ tenantId, actorId: me(req), action: 'member.leave', entity: 'tenant_member', entityId: m.id });
  });
  cache.del(`member:${tenantId}:${me(req)}`);
  res.json({ left: true });
});

// ── Two-step verification ──

router.post('/mfa/start', accountLimiter, validate(z.object({ password: z.string().min(1, 'Enter your password') })), async (req, res) => {
  res.json(await run(() => account.startMfaSetup(me(req), req.body.password)));
});
router.post('/mfa/confirm', accountLimiter, validate(z.object({ setupToken: z.string().min(10), code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code') })), async (req, res) => {
  res.json(await run(() => account.confirmMfaSetup(req, me(req), req.body.setupToken, req.body.code)));
});
router.post('/mfa/disable', accountLimiter, validate(z.object({ password: z.string().min(1, 'Enter your password'), code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code') })), async (req, res) => {
  await run(() => account.disableMfa(req, me(req), req.body.password, req.body.code));
  res.json({ mfaEnabled: false });
});
router.post('/mfa/backup-codes', accountLimiter, validate(z.object({ password: z.string().min(1, 'Enter your password') })), async (req, res) => {
  res.json(await run(() => account.regenerateBackupCodes(req, me(req), req.body.password)));
});

export default router;
