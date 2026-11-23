import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { prisma } from '../../kernel/db';
import { normaliseEmail } from '../../kernel/crypto';
import { readStep } from '../../kernel/tokens';
import { validate } from '../../middleware/request';
import { requireStaff } from '../../middleware/auth';
import { testing } from '../../config/env';
import { enableMfa, linkInfo, login, loginWithCode, logout, mfaSecretFor, refresh, sendAccountLink, setPassword } from './service';

const router = Router();
// Ten tries a minute per address for anything that checks a secret
const limiter = rateLimit({ windowMs: 60_000, limit: testing ? 10_000 : 10, standardHeaders: true, legacyHeaders: false, message: { error: { code: 'RATE_LIMITED', message: 'Too many tries. Wait a minute and try again.' } } });

const Email = z.string().trim().email('Enter a valid email').transform(normaliseEmail);
const Code = z.string().regex(/^\d{6}$/, 'Enter the 6-digit code');

router.post('/login', limiter, validate(z.object({ email: Email, password: z.string().min(1, 'Enter your password').max(128) })), async (req, res) => {
  res.json(await login(req, res, req.body.email, req.body.password));
});

router.post('/mfa', limiter, validate(z.object({ mfaToken: z.string(), code: Code })), async (req, res) => {
  res.json(await loginWithCode(req, res, readStep('mfa', req.body.mfaToken), req.body.code));
});

/** Two-step setup during sign-in (roles that must have it) */
router.post('/mfa/setup', limiter, validate(z.object({ setupToken: z.string() })), async (req, res) => {
  res.json(await mfaSecretFor(readStep('mfa_setup', req.body.setupToken)));
});
router.post('/mfa/enable', limiter, validate(z.object({ setupToken: z.string(), code: Code })), async (req, res) => {
  res.json(await enableMfa(req, res, readStep('mfa_setup', req.body.setupToken), req.body.code));
});

router.post('/refresh', async (req, res) => {
  res.json(await refresh(req, res));
});

router.post('/logout', async (req, res) => {
  await logout(req, res);
  res.status(204).end();
});

/** Forgot password: the same answer whether or not the email has an account here */
router.post('/forgot', limiter, validate(z.object({ email: Email })), async (req, res) => {
  const user = await prisma.consoleUser.findUnique({ where: { email: req.body.email }, select: { id: true, status: true } });
  if (user && user.status !== 'disabled') await sendAccountLink(user.id, 'reset');
  res.json({ sent: true });
});

router.get('/link/:token', limiter, async (req, res) => {
  const l = await linkInfo(String(req.params.token));
  res.json({ name: l.user.name, email: l.user.email, purpose: l.purpose });
});
router.post('/link/:token', limiter, validate(z.object({ password: z.string().min(1).max(128) })), async (req, res) => {
  await setPassword(String(req.params.token), req.body.password);
  res.json({ done: true });
});

export default router;

/** The signed-in person */
export const meRoute = Router().get('/', requireStaff, async (req, res) => {
  const u = await prisma.consoleUser.findUniqueOrThrow({
    where: { id: req.staff!.id },
    select: { id: true, name: true, email: true, mobile: true, role: true, referralCode: true, mfaEnabledAt: true, partner: { select: { id: true, name: true, code: true } } },
  });
  res.json({ ...u, mfaEnabled: !!u.mfaEnabledAt });
});
