import rateLimit from 'express-rate-limit';
import { AppError } from '../kernel/errors';

// NFR-07: rate limits on login, OTP and public APIs
const limiter = (windowMs: number, limit: number, keyField?: string) =>
  rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req) => `${req.ip}:${keyField ? String(req.body?.[keyField] ?? '') : ''}`,
    handler: (_req, _res, next, options) =>
      next(new AppError('RATE_LIMITED', 'Too many attempts. Please wait and try again.', { retryAfter: Math.ceil(options.windowMs / 1000) })),
  });

export const otpLimiter = limiter(10 * 60 * 1000, 5, 'target');
export const loginLimiter = limiter(15 * 60 * 1000, 20);
export const publicLimiter = limiter(60 * 1000, 60);
/** Files sent by customers without a login (request form, tracking link, portal) */
export const publicUploadLimiter = limiter(10 * 60 * 1000, 20);
/** Signup "is this email/mobile already registered?" checks — low limit to slow down enumeration */
export const lookupLimiter = limiter(10 * 60 * 1000, 30);
/** My account actions that check the password or send a code: per person, not per IP */
export const accountLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => `acct:${req.auth?.sub ?? req.ip}`,
  handler: (_req, _res, next, options) =>
    next(new AppError('RATE_LIMITED', 'Too many attempts. Please wait a few minutes and try again.', { retryAfter: Math.ceil(options.windowMs / 1000) })),
});
