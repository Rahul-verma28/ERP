import type { PermissionScope } from '@prisma/client';

export interface TenantCtx {
  kind: 'tenant';
  tenantId: string;
  userId: string;
  memberId: string;
  roleId: string;
  sessionId: string;
  branchIds: string[];
  requestId?: string;
  ip?: string;
  /** Data scope granted for the permission checked on this request */
  scope?: PermissionScope;
}

/** Background jobs acting for a tenant */
export interface SystemCtx {
  kind: 'system';
  tenantId: string;
  userId?: string;
}

export interface PlatformCtx {
  kind: 'platform';
  tenantId?: undefined;
  userId?: string;
}

/** A signed-in AHEAD team member working in the Console (design v2, R3-lite) */
export interface ConsoleCtx extends PlatformCtx {
  userId: string;
  memberId: string;
  roleId: string;
  sessionId: string;
  requestId?: string;
  ip?: string;
  /** Data scope granted for the permission checked on this request */
  scope?: PermissionScope;
  /** Partner people: every client query is limited to this partner's clients */
  partnerId?: string | null;
}

export type Ctx = TenantCtx | SystemCtx | PlatformCtx;

export interface AuthClaims {
  sub: string; // user id
  tid: string | null; // tenant id
  rid: string | null; // role id
  sid: string; // session id
  ws: 'tenant' | 'console'; // workspace; tokens issued before the Console default to tenant
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId: string;
      auth?: AuthClaims;
      ctx?: TenantCtx;
      console?: ConsoleCtx;
    }
  }
}
