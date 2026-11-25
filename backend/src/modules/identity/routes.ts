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
import { createWorkspace } from '../licensing/provision';
import { consoleApi } from '../../kernel/consoleClient';
import { audit } from '../audit/service';
import { checkOtp, consumeOtp, sendOtp } from './otp';
import { zEmail, zMobileIN, zPassword, zPersonName } from '../../kernel/zodRules';
import { BusinessSignup, signupToTenant } from '../tenancy/workspace';
import { REFRESH_COOKIE, clearRefreshCookie, rotateSession, signAccessToken, signPurposeToken, startSession, verifyPurposeToken } from './tokens';
import { buildMe, checkPassword, completeLogin, sendEmailVerification } from './service';
import { linkInfo, usableLink, useLink } from './accessLinks';

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
      // Sign-in and reset: no code goes out for an account that doesn't exist, and the person is told
      // so plainly. (Sign-up already says when a mobile is taken, so hiding it here would protect
      // nothing; the OTP rate limit stops anyone trying numbers in bulk.)
      if ((purpose === 'login' || purpose === 'reset') && !existing) {
        const field = target.includes('@') ? 'email' : 'mobile number';
        throw new AppError('NOT_FOUND', `No account uses this ${field}. Check it, or create an account.`, { fields: { target: `No account with this ${field}` } });
      }
      return sendOtp(target, purpose);
    });
    res.json({ sent: true, ...result });
  },
);

// Check a code before the rest of the form is shown (invitation: then the password). Not used up.
router.post(
  '/otp/check',
  publicRoute,
  otpLimiter,
  validate(z.object({ target: Mobile, purpose: z.enum(['invite']), code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code') })),
  async (req, res) => {
    await withPlatform(() => checkOtp(req.body.target, req.body.purpose, req.body.code));
    res.json({ ok: true });
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
  // Checked before asking the Console, so a used code or a taken email never leaves a half-made business
  await withPlatform(async () => {
    if (!(await db().otpCode.findFirst({ where: { id: proof.otpId, consumedAt: { not: null } }, select: { id: true } }))) throw new AppError('OTP_TOKEN_INVALID', 'Please verify your mobile number again.');
    if (await db().user.findUnique({ where: { email: body.email }, select: { id: true } })) throw new AppError('EMAIL_TAKEN', 'An account with this email already exists. Please sign in.');
    if (await db().user.findUnique({ where: { mobile: body.mobile }, select: { id: true } })) throw new AppError('MOBILE_TAKEN', 'An account with this mobile number already exists. Please sign in.');
  });
  const passwordHash = await hashPassword(body.password);
  const t = signupToTenant(body);

  // The Console registers the business (one-trial rule, referral, plan) and signs its licence
  const reg = await consoleApi<{ businessId: string; licence: string; trial: boolean }>('POST', '/signups', {
    name: t.businessName, legalName: t.legalName, industryKey: t.industryKey, gstin: t.gstin ?? null, stateCode: t.billingStateCode,
    owner: { name: body.name, email: body.email, mobile: body.mobile }, referralCode: body.referralCode ?? null, couponCode: body.couponCode ?? null,
  });

  const result = await withPlatform(async () => {
    // Single use: the code is gone once the account exists
    const used = await db().otpCode.deleteMany({ where: { id: proof.otpId, consumedAt: { not: null } } });
    if (!used.count) throw new AppError('OTP_TOKEN_INVALID', 'Please verify your mobile number again.');
    const made = await createWorkspace({
      id: reg.businessId, name: t.businessName, industryKey: t.industryKey, legalName: t.legalName, gstin: t.gstin ?? null, stateCode: t.billingStateCode, profile: t.profile,
      owner: { kind: 'new', name: body.name, email: body.email, mobile: body.mobile, passwordHash, mobileVerified: true }, licence: reg.licence,
    });
    const user = await db().user.findUniqueOrThrow({ where: { id: made.ownerUserId } });
    const accessToken = await startSession(req, res, user.id, made.tenantId, made.ownerRoleId);
    await sendEmailVerification(user);
    const tenant = await db().tenant.findUniqueOrThrow({ where: { id: made.tenantId }, select: { id: true, name: true, status: true } });
    return { user, tenant, accessToken };
  }, undefined, { timeoutMs: SIGNUP_TX_TIMEOUT_MS });

  // Not confirmed now (Console unreachable for a moment): its hourly check finds the business and confirms it
  await consoleApi('POST', `/signups/${reg.businessId}/confirm`).catch(() => undefined);
  res.status(201).json({
    user: { id: result.user.id, name: result.user.name, emailVerified: false },
    tenant: { ...result.tenant, trial: reg.trial },
    accessToken: result.accessToken,
  });
});

// "Add another business" for a signed-in user: same business steps, no new account.
// The one-trial rule still applies (same mobile/email), so a second business starts on Free.
router.post('/businesses', authenticate, loginLimiter, validate(BusinessSignup), async (req, res) => {
  const body = req.body as z.infer<typeof BusinessSignup>;
  const owner = await withPlatform(() => db().user.findUniqueOrThrow({ where: { id: req.auth!.sub }, select: { id: true, name: true, email: true, mobile: true } }));
  const t = signupToTenant(body);
  const reg = await consoleApi<{ businessId: string; licence: string; trial: boolean }>('POST', '/signups', {
    name: t.businessName, legalName: t.legalName, industryKey: t.industryKey, gstin: t.gstin ?? null, stateCode: t.billingStateCode,
    owner: { name: owner.name, email: owner.email, mobile: owner.mobile }, referralCode: body.referralCode ?? null, couponCode: body.couponCode ?? null,
  });
  const made = await withPlatform(
    () => createWorkspace({ id: reg.businessId, name: t.businessName, industryKey: t.industryKey, legalName: t.legalName, gstin: t.gstin ?? null, stateCode: t.billingStateCode, profile: t.profile, owner: { kind: 'existing', userId: owner.id }, licence: reg.licence }),
    undefined,
    { timeoutMs: SIGNUP_TX_TIMEOUT_MS },
  );
  await consoleApi('POST', `/signups/${reg.businessId}/confirm`).catch(() => undefined);
  await withPlatform(() => db().userSession.update({ where: { id: req.auth!.sid }, data: { tenantId: made.tenantId } }));
  const tenant = await withPlatform(() => db().tenant.findUniqueOrThrow({ where: { id: made.tenantId }, select: { id: true, name: true, status: true } }));
  res.status(201).json({
    tenant: { ...tenant, trial: reg.trial },
    accessToken: signAccessToken({ sub: req.auth!.sub, tid: made.tenantId, rid: made.ownerRoleId, sid: req.auth!.sid }),
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

// ── Login links (Console v3): set up your own login from the link someone sent you ──

const LinkParam = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{10,64}$/, 'Not a valid link') });

router.get('/start/:token', publicRoute, validate(LinkParam, 'params'), async (req, res) => {
  res.json(await withPlatform(() => linkInfo(req.params.token as string)));
});

router.post('/start/:token/otp', publicRoute, otpLimiter, validate(LinkParam, 'params'), async (req, res) => {
  const out = await withPlatform(async () => {
    const link = await usableLink(req.params.token as string);
    return sendOtp(link.user.mobile, 'invite');
  });
  res.json({ sent: true, ...out });
});

// Login link: the code is checked first, then the password is asked for (the code is used up there)
router.post('/start/:token/check', publicRoute, otpLimiter, validate(LinkParam, 'params'), validate(z.object({ code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code') })), async (req, res) => {
  await withPlatform(async () => {
    const link = await usableLink(req.params.token as string);
    await checkOtp(link.user.mobile, 'invite', req.body.code);
  });
  res.json({ ok: true });
});

router.post(
  '/start/:token',
  publicRoute,
  loginLimiter,
  validate(LinkParam, 'params'),
  validate(z.object({ code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code'), password: z.string().max(128).optional() })),
  async (req, res) => {
    const out = await withPlatform(async () => {
      const link = await usableLink(req.params.token as string);
      if (!link.user.passwordHash && !req.body.password) throw new AppError('VALIDATION_FAILED', 'Choose a password.', { fields: { password: 'Choose a password' } });
      await consumeOtp(link.user.mobile, 'invite', req.body.code);
      if (!link.user.passwordHash) await applyNewPassword(link.userId, req.body.password);
      await useLink(link.id, link.userId);
      await audit({ tenantId: link.tenantId, actorId: link.userId, action: 'auth.access_link_used', entity: 'access_link', entityId: link.id, ip: req.ip });
      // An account that already uses two-step signs in the normal way
      const user = await db().user.findUniqueOrThrow({ where: { id: link.userId }, select: { mfaEnabled: true } });
      if (user.mfaEnabled) return { signInRequired: true };
      return completeLogin(req, res, link.userId, 'access_link', { tenantId: link.tenantId });
    });
    res.json(out);
  },
);

router.post('/refresh', publicRoute, async (req, res) => {
  const refresh = req.cookies?.[REFRESH_COOKIE];
  if (!refresh) throw new AppError('UNAUTHENTICATED', 'Please sign in.');
  const accessToken = await withPlatform(async () => {
    const session = await rotateSession(req, res, refresh);
    let tenantId = session.tenantId;
    let roleId: string | null = null;
    if (tenantId) {
      const member = await getMember(tenantId, session.userId);
      if (member?.status === 'active') roleId = member.roleId;
      else tenantId = null;
    }
    return signAccessToken({ sub: session.userId, tid: tenantId, rid: roleId, sid: session.id });
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
    await db().userSession.update({ where: { id: req.auth!.sid }, data: { tenantId } });
    await db().user.update({ where: { id: req.auth!.sub }, data: { lastTenantId: tenantId } });
  });
  res.json({ accessToken: signAccessToken({ sub: req.auth!.sub, tid: tenantId, rid: member.roleId, sid: req.auth!.sid }) });
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

// Forgot password, step 2: the code is checked on its own first. A short-lived token then allows
// one new password; it stops working once the password has been changed.
const resetStamp = (u: { passwordChangedAt: Date | null }) => u.passwordChangedAt?.toISOString() ?? 'never';

router.post(
  '/password/reset/verify',
  publicRoute,
  otpLimiter,
  validate(z.object({ target: Target, code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code') })),
  async (req, res) => {
    const { target, code } = req.body;
    const resetToken = await withPlatform(async () => {
      const user = await db().user.findFirst({ where: target.includes('@') ? { email: target } : { mobile: target } });
      if (!user) throw new AppError('OTP_INVALID', 'The code is incorrect.');
      await consumeOtp(target, 'reset', code);
      return signPurposeToken('password_reset', { userId: user.id, since: resetStamp(user) }, 10 * 60);
    });
    res.json({ resetToken });
  },
);

router.post(
  '/password/reset',
  publicRoute,
  otpLimiter,
  validate(z.object({ resetToken: z.string().min(20), password: Password })),
  async (req, res) => {
    const { resetToken, password } = req.body;
    await withPlatform(async () => {
      const proof = verifyPurposeToken<{ userId: string; since: string }>('password_reset', resetToken);
      const user = await db().user.findUnique({ where: { id: proof.userId } });
      if (!user || resetStamp(user) !== proof.since) throw new AppError('OTP_TOKEN_INVALID', 'This reset has already been used or has run out. Ask for a new code.');
      await applyNewPassword(user.id, password);
      await db().userSession.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
      await audit({ tenantId: null, actorId: user.id, action: 'auth.password_reset' });
    });
    res.json({ reset: true });
  },
);

export const meHandler = Router().get('/', authenticate, async (req, res) => {
  res.json(await buildMe(req.auth!.sub, req.auth!.tid));
});

export default router;
