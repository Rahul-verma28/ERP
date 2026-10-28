import { Router, type Request, type Response } from 'express';
import { describePasswordPolicy } from '../../contracts/account';
import { applyNewPassword, checkSecondFactor, isTrustedDevice, passwordExpired, trustDevice } from '../account/service';
import { personalPolicy } from '../account/policy';
import { logSignIn } from '../account/signin';
import { z } from 'zod';
import { db, withPlatform } from '../../kernel/db';
import { AppError } from '../../kernel/errors';
import { hashPassword, normaliseEmail, normaliseMobile } from '../../kernel/crypto';
import { validate } from '../../middleware/request';
import { authenticate, publicRoute } from '../../middleware/auth';
import { loginLimiter, otpLimiter } from '../../middleware/rateLimit';
import { getMember } from '../access/service';
import { getPlatformMember } from '../console/service';
import { createTenant } from '../tenancy/createTenant';
import { audit } from '../audit/service';
import { consumeOtp, sendOtp } from './otp';
import { zEmail, zMobileIN, zPassword, zPersonName } from '../../kernel/zodRules';
import { BusinessSignup, signupToTenant } from '../tenancy/workspace';
import { referralAcquisition } from '../console/referral';
import { REFRESH_COOKIE, clearRefreshCookie, rotateSession, signAccessToken, signPurposeToken, startSession, verifyPurposeToken } from './tokens';
import { buildMe, checkPassword, completeLogin, sendEmailVerification } from './service';

const router = Router();

const Mobile = z.string().trim().transform(normaliseMobile).pipe(z.string().regex(/^\+[1-9]\d{7,14}$/, 'Enter a valid mobile number'));
const Password = z.string().min(8, 'Use at least 8 characters').max(128);
const Target = z.string().trim().min(3).transform((v) => (v.includes('@') ? normaliseEmail(v) : normaliseMobile(v)));

// ── OTP ──

router.post(
  '/otp/send',
  publicRoute,
  otpLimiter,
  validate(z.object({ target: Target, purpose: z.enum(['signup', 'login', 'reset', 'invite']) })),
  async (req, res) => {
    const { target, purpose } = req.body as { target: string; purpose: 'signup' | 'login' | 'reset' | 'invite' };
    const result = await withPlatform(async () => {
      const existing = await db().user.findFirst({ where: target.includes('@') ? { email: target } : { mobile: target } });
      if ((purpose === 'signup' || purpose === 'invite') && target.includes('@')) throw new AppError('VALIDATION_FAILED', 'Use a mobile number.', { fields: { target: 'Use a mobile number' } });
      if (purpose === 'signup' && existing) throw new AppError('MOBILE_TAKEN', 'An account with this mobile number already exists. Please sign in.');
      // login/reset: never reveal whether the account exists
      if ((purpose === 'login' || purpose === 'reset') && !existing) return { channel: target.includes('@') ? 'email' : 'sms' };
      return sendOtp(target, purpose);
    });
    res.json({ sent: true, ...result });
  },
);

router.post(
  '/otp/verify',
  publicRoute,
  otpLimiter,
  validate(z.object({ target: Mobile, purpose: z.enum(['signup', 'invite']), code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code') })),
  async (req, res) => {
    const { target, purpose, code } = req.body;
    const otpId = await withPlatform(() => consumeOtp(target, purpose, code));
    const verificationToken = signPurposeToken('mobile_verified', { mobile: target, otpId, purpose }, 10 * 60);
    res.json({ verificationToken });
  },
);

// ── Signup v2 (Phase 1): account + business steps, verified mobile ──

const SIGNUP_TX_TIMEOUT_MS = 30_000;

const SignupBody = z.intersection(
  z.object({
    name: zPersonName,
    email: zEmail,
    mobile: zMobileIN,
    password: zPassword,
    mobileVerificationToken: z.string().min(10),
  }),
  BusinessSignup,
);

router.post('/signup', publicRoute, loginLimiter, validate(SignupBody), async (req, res) => {
  const body = req.body as z.infer<typeof SignupBody>;
  const proof = verifyPurposeToken<{ mobile: string; otpId: string; purpose: string }>('mobile_verified', body.mobileVerificationToken);
  if (proof.mobile !== body.mobile || proof.purpose !== 'signup') throw new AppError('OTP_TOKEN_INVALID', 'Please verify your mobile number again.');
  const passwordHash = await hashPassword(body.password);

  const result = await withPlatform(async () => {
    // Single use: the OTP row is deleted when the token is redeemed
    const used = await db().otpCode.deleteMany({ where: { id: proof.otpId, consumedAt: { not: null } } });
    if (!used.count) throw new AppError('OTP_TOKEN_INVALID', 'Please verify your mobile number again.');
    // A valid vendor / sales referral credits them; otherwise it is a plain self-signup
    const referral = await referralAcquisition(body.referralCode, body.referralVia);
    const created = await createTenant({
      owner: { kind: 'new', name: body.name, email: body.email, mobile: body.mobile, passwordHash, mobileVerified: true },
      ...signupToTenant(body),
      acquisition: { byType: 'self', method: 'signup', ...referral, couponCode: body.couponCode ?? undefined },
    });
    const accessToken = await startSession(req, res, created.user.id, created.tenant.id, created.ownerRoleId);
    await sendEmailVerification(created.user);
    return { ...created, accessToken };
    // ~25 sequential queries; the database is far from the API today (see TASKS "Latency")
  }, undefined, { timeoutMs: SIGNUP_TX_TIMEOUT_MS });

  res.status(201).json({
    user: { id: result.user.id, name: result.user.name, emailVerified: false },
    tenant: { id: result.tenant.id, name: result.tenant.name, status: result.tenant.status, trialEndsAt: result.subscription.trialEndsAt },
    accessToken: result.accessToken,
  });
});

// "Add another business" for a signed-in user: same business steps, no new account.
// The one-trial rule still applies (same mobile/email), so this usually needs a paid plan.
router.post('/businesses', authenticate, loginLimiter, validate(BusinessSignup), async (req, res) => {
  const body = req.body as z.infer<typeof BusinessSignup>;
  const created = await withPlatform(
    () =>
      createTenant({
        owner: { kind: 'existing', userId: req.auth!.sub },
        ...signupToTenant(body),
        acquisition: { byType: 'self', method: 'signup', couponCode: body.couponCode ?? undefined },
      }),
    undefined,
    { timeoutMs: SIGNUP_TX_TIMEOUT_MS },
  );
  await withPlatform(() => db().userSession.update({ where: { id: req.auth!.sid }, data: { tenantId: created.tenant.id, workspace: 'tenant' } }));
  res.status(201).json({
    tenant: { id: created.tenant.id, name: created.tenant.name, status: created.tenant.status },
    accessToken: signAccessToken({ sub: req.auth!.sub, tid: created.tenant.id, rid: created.ownerRoleId, sid: req.auth!.sid, ws: 'tenant' }),
  });
});

// ── Login ──

const LoginBody = z.union([
  z.object({ identifier: z.string().trim().min(3), password: z.string().min(1) }),
  z.object({ mobile: Mobile, otp: z.string().regex(/^\d{6}$/) }),
]);

/**
 * After the password or mobile OTP: a password past the business's expiry must be changed
 * first, then the app code is asked unless this device is trusted. Each step hands the
 * browser a short-lived token for the next one.
 */
async function afterFirstFactor(req: Request, res: Response, userId: string, method: string) {
  const user = await db().user.findUniqueOrThrow({ where: { id: userId } });
  if (method === 'password') {
    const policy = await personalPolicy(userId);
    if (await passwordExpired(user, policy.password.expiryDays)) {
      await logSignIn(req, { userId, identifier: user.email, outcome: 'expired_password', method });
      return {
        passwordExpired: true,
        changeToken: signPurposeToken('password_expired', { sub: userId, method }, 10 * 60),
        policy: policy.password,
        policyText: describePasswordPolicy(policy.password),
      };
    }
  }
  if (user.mfaEnabled && !(await isTrustedDevice(req, userId))) {
    await logSignIn(req, { userId, identifier: user.email, outcome: 'mfa_challenge', method });
    return { mfaRequired: true, mfaToken: signPurposeToken('mfa_login', { sub: userId, method }, 5 * 60), email: user.email };
  }
  return completeLogin(req, res, userId, method);
}

router.post('/login', publicRoute, loginLimiter, validate(LoginBody), async (req, res) => {
  const body = req.body as z.infer<typeof LoginBody>;
  const out = await withPlatform(async () => {
    let userId: string;
    if ('password' in body) {
      const id = body.identifier.includes('@') ? { email: normaliseEmail(body.identifier) } : { mobile: normaliseMobile(body.identifier) };
      userId = (await checkPassword(id, body.password, req)).id;
    } else {
      const user = await db().user.findUnique({ where: { mobile: body.mobile } });
      if (!user) throw new AppError('INVALID_CREDENTIALS', 'Incorrect mobile number or code.');
      await consumeOtp(body.mobile, 'login', body.otp);
      userId = user.id;
    }
    return afterFirstFactor(req, res, userId, 'password' in body ? 'password' : 'otp');
  });
  res.json(out);
});

// Second step: the authenticator code or a backup code
router.post(
  '/mfa/verify',
  publicRoute,
  loginLimiter,
  validate(
    z
      .object({
        mfaToken: z.string().min(10),
        code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code').optional(),
        backupCode: z.string().trim().regex(/^[A-Za-z0-9]{4}-?[A-Za-z0-9]{4}$/, 'Backup codes look like 7KQ2-9MZD').optional(),
        trustDevice: z.boolean().default(false),
      })
      .refine((b) => b.code || b.backupCode, { message: 'Enter the 6-digit code', path: ['code'] }),
  ),
  async (req, res) => {
    const p = verifyPurposeToken<{ sub: string; method: string }>('mfa_login', req.body.mfaToken);
    const out = await withPlatform(async () => {
      let left: number;
      try {
        left = (await checkSecondFactor(p.sub, { code: req.body.code, backupCode: req.body.backupCode })).backupCodesLeft;
      } catch (e) {
        const locked = e instanceof AppError && e.code === 'ACCOUNT_LOCKED';
        await logSignIn(req, { userId: p.sub, outcome: locked ? 'mfa_locked' : 'mfa_failed', method: req.body.backupCode ? 'backup_code' : 'app' });
        throw e;
      }
      if (req.body.trustDevice) await trustDevice(req, res, p.sub);
      const login = await completeLogin(req, res, p.sub, `${p.method}+${req.body.backupCode ? 'backup_code' : 'app'}`);
      return { ...login, backupCodesLeft: req.body.backupCode ? left : undefined };
    });
    res.json(out);
  },
);

// Password past the business's expiry: set a new one, then carry on signing in
router.post(
  '/password/expired',
  publicRoute,
  loginLimiter,
  validate(z.object({ changeToken: z.string().min(10), password: z.string().min(1, 'Enter a new password').max(64) })),
  async (req, res) => {
    const p = verifyPurposeToken<{ sub: string; method: string }>('password_expired', req.body.changeToken);
    const out = await withPlatform(async () => {
      await applyNewPassword(p.sub, req.body.password);
      await audit({ tenantId: null, actorId: p.sub, action: 'auth.password_expired_change', ip: req.ip });
      return afterFirstFactor(req, res, p.sub, `${p.method}+renewed`);
    });
    res.json(out);
  },
);

router.post('/refresh', publicRoute, async (req, res) => {
  const refresh = req.cookies?.[REFRESH_COOKIE];
  if (!refresh) throw new AppError('UNAUTHENTICATED', 'Please sign in.');
  const accessToken = await withPlatform(async () => {
    const session = await rotateSession(req, res, refresh);
    if (session.workspace === 'console') {
      // Removed from the AHEAD team since the last refresh: fall back to a session without a workspace
      const platform = await getPlatformMember(session.userId);
      if (platform?.status === 'active') return signAccessToken({ sub: session.userId, tid: null, rid: platform.roleId, sid: session.id, ws: 'console' });
      await db().userSession.update({ where: { id: session.id }, data: { workspace: 'tenant' } });
    }
    let tenantId = session.tenantId;
    let roleId: string | null = null;
    if (tenantId) {
      const member = await getMember(tenantId, session.userId);
      if (member?.status === 'active') roleId = member.roleId;
      else tenantId = null;
    }
    return signAccessToken({ sub: session.userId, tid: tenantId, rid: roleId, sid: session.id, ws: 'tenant' });
  }).catch((e) => {
    clearRefreshCookie(res);
    throw e;
  });
  res.json({ accessToken });
});

router.post('/logout', authenticate, async (req, res) => {
  await withPlatform(() => db().userSession.updateMany({ where: { id: req.auth!.sid, revokedAt: null }, data: { revokedAt: new Date() } }));
  clearRefreshCookie(res);
  res.status(204).end();
});

router.post('/switch-tenant', authenticate, validate(z.object({ tenantId: z.string().uuid() })), async (req, res) => {
  const { tenantId } = req.body;
  const member = await getMember(tenantId, req.auth!.sub);
  if (!member || member.status !== 'active') throw new AppError('TENANT_FORBIDDEN', 'You are not a member of this business.');
  await withPlatform(async () => {
    await db().userSession.update({ where: { id: req.auth!.sid }, data: { tenantId, workspace: 'tenant' } });
    await db().user.update({ where: { id: req.auth!.sub }, data: { lastTenantId: tenantId } });
  });
  res.json({ accessToken: signAccessToken({ sub: req.auth!.sub, tid: tenantId, rid: member.roleId, sid: req.auth!.sid, ws: 'tenant' }) });
});

// Design v2: AHEAD team members switch between their businesses and the Console
router.post('/switch-console', authenticate, async (req, res) => {
  const platform = await getPlatformMember(req.auth!.sub);
  if (!platform || platform.status !== 'active') throw new AppError('PERMISSION_DENIED', 'You are not an active member of the AHEAD team.');
  await withPlatform(async () => {
    await db().userSession.update({ where: { id: req.auth!.sid }, data: { tenantId: null, workspace: 'console' } });
    await audit({ tenantId: null, actorId: req.auth!.sub, action: 'auth.switch_console' });
  });
  res.json({ accessToken: signAccessToken({ sub: req.auth!.sub, tid: null, rid: platform.roleId, sid: req.auth!.sid, ws: 'console' }) });
});

// ── Email verification & password reset ──

router.post('/email/verify', publicRoute, validate(z.object({ token: z.string().min(10) })), async (req, res) => {
  const p = verifyPurposeToken<{ sub: string; email: string }>('email_verify', req.body.token);
  await withPlatform(async () => {
    const user = await db().user.findUnique({ where: { id: p.sub } });
    if (!user || user.email !== p.email) throw new AppError('OTP_TOKEN_INVALID', 'This link is no longer valid.');
    if (!user.emailVerifiedAt) await db().user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });
  });
  res.json({ verified: true });
});

router.post('/email/resend', authenticate, otpLimiter, async (req, res) => {
  await withPlatform(async () => {
    const user = await db().user.findUniqueOrThrow({ where: { id: req.auth!.sub } });
    if (!user.emailVerifiedAt) await sendEmailVerification(user);
  });
  res.json({ sent: true });
});

router.post(
  '/password/reset',
  publicRoute,
  otpLimiter,
  validate(z.object({ target: Target, code: z.string().regex(/^\d{6}$/), password: Password })),
  async (req, res) => {
    const { target, code, password } = req.body;
    await withPlatform(async () => {
      const user = await db().user.findFirst({ where: target.includes('@') ? { email: target } : { mobile: target } });
      if (!user) throw new AppError('OTP_INVALID', 'The code is incorrect.');
      await consumeOtp(target, 'reset', code);
      await applyNewPassword(user.id, password);
      await db().userSession.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
      await audit({ tenantId: null, actorId: user.id, action: 'auth.password_reset' });
    });
    res.json({ reset: true });
  },
);

export const meHandler = Router().get('/', authenticate, async (req, res) => {
  res.json(await buildMe(req.auth!.sub, req.auth!.tid, req.auth!.ws));
});

export default router;
