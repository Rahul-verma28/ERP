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
  /** With the "team" scope: the person and everyone reporting to them in HR (users), filled once per request */
  teamUserIds?: string[];
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

export type Ctx = TenantCtx | SystemCtx | PlatformCtx;

export interface AuthClaims {
  sub: string; // user id
  tid: string | null; // tenant id
  rid: string | null; // role id
  sid: string; // session id
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId: string;
      auth?: AuthClaims;
      ctx?: TenantCtx;
    }
  }
}
