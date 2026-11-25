import type { NextFunction, Request, Response } from 'express';
import { prisma, withTenant } from '../kernel/db';
import { AppError } from '../kernel/errors';
import { verifyAccessToken } from '../modules/identity/tokens';
import { getMember, getRolePermissions } from '../modules/access/service';
import { getEntitlements } from '../modules/licensing/entitlements';
import { PERMISSION_BY_KEY, isReadAction } from '../contracts/permissions';
import { ipAllowed } from '../contracts/account';
import { loadTeamUsers } from '../kernel/query';
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
  if (!def) throw new Error(`Unknown permission key: ${key}`);
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
    // "team": the person and everyone reporting to them, worked out once per request
    if (scope === 'team' && !ctx.teamUserIds) ctx.teamUserIds = await withTenant(ctx, () => loadTeamUsers(ctx.tenantId, ctx.memberId, ctx.userId));
    next();
  };
}

/** Explicit marker for routes that are intentionally unauthenticated. */
export const publicRoute = (_req: Request, _res: Response, next: NextFunction) => next();

/**
 * Run the handler inside the request's tenant transaction (RLS-scoped). The JSON answer is held
 * until the transaction commits: if the commit fails (a timeout, a conflict), the caller gets the
 * error instead of a success for work that was rolled back.
 */
export const tx = (handler: Handler) => async (req: Request, res: Response) => {
  if (!req.ctx) throw new AppError('UNAUTHENTICATED', 'Please sign in.');
  const send = res.json.bind(res);
  let held: { body: unknown } | null = null;
  res.json = ((body: unknown) => {
    held = { body };
    return res;
  }) as Response['json'];
  try {
    await withTenant(req.ctx, () => handler(req, res));
  } finally {
    res.json = send;
  }
  if (held) send((held as { body: unknown }).body);
};

