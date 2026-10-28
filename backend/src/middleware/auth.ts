import type { NextFunction, Request, Response } from 'express';
import { prisma, withPlatform, withTenant } from '../kernel/db';
import { AppError } from '../kernel/errors';
import { verifyAccessToken } from '../modules/identity/tokens';
import { getMember, getRolePermissions } from '../modules/access/service';
import { getEntitlements } from '../modules/subscription/entitlements';
import { getPlatformMember } from '../modules/console/service';
import { PERMISSION_BY_KEY, isReadAction } from '../contracts/permissions';
import { ipAllowed } from '../contracts/account';
import { mfaRequirement, tenantSecurity } from '../modules/account/policy';

type Handler = (req: Request, res: Response) => Promise<unknown>;

/** Verify the Bearer access token and attach claims. */
export function authenticate(req: Request, _res: Response, next: NextFunction) {
  const header = req.header('authorization');
  if (!header?.startsWith('Bearer ')) throw new AppError('UNAUTHENTICATED', 'Please sign in.');
  req.auth = verifyAccessToken(header.slice(7));
  next();
}

/** Resolve the tenant membership for the token's tenant (role is read live, not from the token). */
export async function tenantContext(req: Request, _res: Response, next: NextFunction) {
  const auth = req.auth;
  if (!auth?.tid) throw new AppError('TENANT_FORBIDDEN', 'No active business selected.');
  const member = await getMember(auth.tid, auth.sub);
  if (!member || member.status !== 'active') throw new AppError('TENANT_FORBIDDEN', 'You are not an active member of this business.');
  const ent = await getEntitlements(auth.tid);
  if (ent.status === 'purged') throw new AppError('TENANT_FORBIDDEN', 'This business account has been closed.');
  // Closed by the Owner: only the Owner can still open it (read-only, to export or reopen)
  if (ent.status === 'closed') {
    const t = await prisma.tenant.findUnique({ where: { id: auth.tid }, select: { ownerUserId: true } });
    if (t?.ownerUserId !== auth.sub) throw new AppError('TENANT_FORBIDDEN', 'This business was closed by its owner.');
  }
  // Settings › Users & security: allowed networks and required two-step verification
  const security = await tenantSecurity(auth.tid);
  if (!ipAllowed(req.ip, security.ipAllowlist)) {
    throw new AppError('IP_NOT_ALLOWED', "This business only allows sign-ins from its office networks. You're connecting from another network.", { ip: req.ip });
  }
  if (security.mfa.policy !== 'off') {
    const mfa = await mfaRequirement(auth.sub);
    if (mfa.blockedTenantIds.includes(auth.tid)) throw new AppError('MFA_SETUP_REQUIRED', 'Set up two-step verification to continue.');
  }
  req.ctx = {
    kind: 'tenant',
    tenantId: auth.tid,
    userId: auth.sub,
    memberId: member.id,
    roleId: member.roleId,
    sessionId: auth.sid,
    branchIds: member.branchIds,
    requestId: req.requestId,
    ip: req.ip,
  };
  next();
}

export const tenantAuth = [authenticate, tenantContext];

/**
 * LLD §4.2 — entitlement (module active, tier, read-only) → role permission → scope.
 * Every tenant route declares exactly one permission key.
 */
export function requirePermission(key: string) {
  const def = PERMISSION_BY_KEY.get(key);
  if (!def || def.moduleKey === 'platform') throw new Error(`Unknown permission key: ${key}`);
  const moduleKey = def.moduleKey;

  return async (req: Request, _res: Response, next: NextFunction) => {
    const ctx = req.ctx;
    if (!ctx) throw new AppError('UNAUTHENTICATED', 'Please sign in.');

    if (moduleKey !== 'tenant') {
      const ent = await getEntitlements(ctx.tenantId);
      const m = ent.modules[moduleKey];
      if (m.status === 'inactive') throw new AppError('MODULE_NOT_ENTITLED', 'This module is not part of your plan.', { module: def.moduleKey });
      if (def.tier === 'full' && m.tier !== 'full') throw new AppError('MODULE_NOT_ENTITLED', 'This feature needs a paid plan.', { module: def.moduleKey, feature: key });
      if (m.status === 'read_only' && !isReadAction(key)) throw new AppError('MODULE_READ_ONLY', 'This module is read-only on your current plan. Upgrade to make changes.', { module: def.moduleKey });
    }

    const perms = await getRolePermissions(ctx.roleId);
    const scope = perms.get(key);
    if (!scope) throw new AppError('PERMISSION_DENIED', 'You do not have permission to do this.', { permission: key });
    ctx.scope = scope;
    next();
  };
}

/** Resolve the Console membership (design v2, R3-lite). Only Console-workspace tokens get in. */
export async function consoleContext(req: Request, _res: Response, next: NextFunction) {
  const auth = req.auth;
  if (!auth || auth.ws !== 'console') throw new AppError('PERMISSION_DENIED', 'Switch to the AHEAD Console to do this.');
  const member = await getPlatformMember(auth.sub);
  if (!member || member.status !== 'active') throw new AppError('PERMISSION_DENIED', 'You are not an active member of the AHEAD team.');
  if ((await mfaRequirement(auth.sub)).consoleBlocked) throw new AppError('MFA_SETUP_REQUIRED', 'AHEAD Console users must set up two-step verification.');
  req.console = { kind: 'platform', userId: auth.sub, memberId: member.id, roleId: member.roleId, partnerId: member.partnerId, sessionId: auth.sid, requestId: req.requestId, ip: req.ip };
  next();
}

export const consoleAuth = [authenticate, consoleContext];

/** Every Console route declares exactly one platform.* permission key; the scope lands on req.console. */
export function requirePlatformPermission(key: string) {
  const def = PERMISSION_BY_KEY.get(key);
  if (!def || def.moduleKey !== 'platform') throw new Error(`Unknown Console permission key: ${key}`);

  return async (req: Request, _res: Response, next: NextFunction) => {
    const ctx = req.console;
    if (!ctx) throw new AppError('UNAUTHENTICATED', 'Please sign in.');
    const scope = (await getRolePermissions(ctx.roleId)).get(key);
    if (!scope) throw new AppError('PERMISSION_DENIED', 'You do not have permission to do this.', { permission: key });
    ctx.scope = scope;
    next();
  };
}

/** Run a Console handler in a platform transaction with the Console user as the actor. */
export const consoleTx = (handler: Handler) => async (req: Request, res: Response) => {
  if (!req.console) throw new AppError('UNAUTHENTICATED', 'Please sign in.');
  await withPlatform(() => handler(req, res), req.console);
};

/** Explicit marker for routes that are intentionally unauthenticated. */
export const publicRoute = (_req: Request, _res: Response, next: NextFunction) => next();

/** Run the handler inside the request's tenant transaction (RLS-scoped). */
export const tx = (handler: Handler) => async (req: Request, res: Response) => {
  if (!req.ctx) throw new AppError('UNAUTHENTICATED', 'Please sign in.');
  await withTenant(req.ctx, () => handler(req, res));
};

