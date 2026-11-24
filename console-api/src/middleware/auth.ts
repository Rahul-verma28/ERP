import type { NextFunction, Request, Response } from 'express';
import type { ConsoleRole } from '@prisma/client';
import { AppError } from '../kernel/errors';
import { prisma } from '../kernel/db';
import { readAccess } from '../kernel/tokens';

// Who may do what in the Console. Roles (approved 29 Oct 2026): Admin, Staff, Sales, Vendor,
// Partner owner, Partner staff. Partner people only ever see their own partner's businesses;
// Sales and Vendor only the businesses they brought in.

export const STAFF_ROLES: ConsoleRole[] = ['admin', 'staff', 'sales', 'vendor'];
export const PARTNER_ROLES: ConsoleRole[] = ['partner_owner', 'partner_staff'];
/** Roles that must use two-step sign-in */
export const MFA_ROLES: ConsoleRole[] = ['admin', 'staff'];

/** Signed in, with a session that is still open */
export async function requireStaff(req: Request, _res: Response, next: NextFunction) {
  try {
    const m = /^Bearer (.+)$/.exec(req.header('authorization') ?? '');
    if (!m) throw new AppError('UNAUTHENTICATED', 'Please sign in.');
    const c = readAccess(m[1]);
    // A disabled account or a signed-out session stops working at once, not when the token ends
    const s = await prisma.consoleSession.findUnique({ where: { id: c.sid }, select: { revokedAt: true, expiresAt: true, user: { select: { status: true, role: true, partnerId: true, partner: { select: { status: true } } } } } });
    if (!s || s.revokedAt || s.expiresAt < new Date() || s.user.status !== 'active' || (s.user.partner && s.user.partner.status !== 'active')) throw new AppError('UNAUTHENTICATED', 'Please sign in again.');
    req.staff = { id: c.sub, role: s.user.role, partnerId: s.user.partnerId, sessionId: c.sid };
    next();
  } catch (e) {
    next(e);
  }
}

export const allow =
  (...roles: ConsoleRole[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (!req.staff || !roles.includes(req.staff.role)) return next(new AppError('PERMISSION_DENIED', 'Your role can’t do this.'));
    next();
  };
