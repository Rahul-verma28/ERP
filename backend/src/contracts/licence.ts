// The licence: what one business (or a whole self-hosted install) may use. Issued and signed by
// the Console, kept and checked by the ERP. See docs/architecture/console-erp-split.md.
// Dependency-free so the Console, the ERP and the web app can all read it.

import { MODULE_KEYS, type ModuleKey } from './modules';

export const LICENCE_VERSION = 1;

/** full = every feature; basic = the free tier; none = not included (read-only if used before) */
export type LicenceTier = 'full' | 'basic' | 'none';

export type LicenceStatus = 'incomplete' | 'trialing' | 'active' | 'past_due' | 'free' | 'closed';

export interface LicenceLimits {
  users: number;
  branches: number;
  /** null = unlimited */
  contacts: number | null;
  items: number | null;
  invoicesPerMonth: number | null;
  storageMb: number;
  aiCredits: number;
}

export interface LicencePayload {
  iss: 'ahead-console';
  typ: 'ahead-licence';
  v: number;
  /** One business (cloud), or "*" for a whole self-hosted install */
  sub: string;
  /** The ERP installation it is for */
  dep: string;
  /** Increases with every licence issued for the same business: an older one never replaces a newer one */
  seq: number;
  plan: { key: string; name: string };
  status: LicenceStatus;
  modules: Record<ModuleKey, LicenceTier>;
  limits: LicenceLimits;
  trialEndsAt: string | null;
  periodEnd: string | null;
  graceEndsAt: string | null;
  /** Seconds since 1970 */
  iat: number;
  exp: number;
}

/** After a licence runs out the ERP keeps working this long (with a banner), then goes read-only */
export const LICENCE_GRACE_DAYS = 7;

/** A cloud licence lasts this long; the Console sends a fresh one well before */
export const CLOUD_LICENCE_DAYS = 14;

export const isLicenceTier = (v: unknown): v is LicenceTier => v === 'full' || v === 'basic' || v === 'none';

/** Shape check of a decoded payload (the signature is checked separately) */
export function licenceShapeError(p: unknown): string | null {
  if (!p || typeof p !== 'object') return 'Not a licence';
  const l = p as Partial<LicencePayload>;
  if (l.iss !== 'ahead-console' || l.typ !== 'ahead-licence') return 'Not an AHEAD licence';
  if (l.v !== LICENCE_VERSION) return `Licence version ${l.v} is not supported by this ERP`;
  if (typeof l.sub !== 'string' || typeof l.dep !== 'string' || typeof l.seq !== 'number') return 'The licence is missing who it is for';
  if (!l.plan || typeof l.plan.key !== 'string') return 'The licence has no plan';
  if (!l.modules || MODULE_KEYS.some((k) => !isLicenceTier((l.modules as Record<string, unknown>)[k]))) return 'The licence does not list every module';
  if (!l.limits || typeof l.limits.users !== 'number') return 'The licence has no limits';
  if (typeof l.iat !== 'number' || typeof l.exp !== 'number' || l.exp <= l.iat) return 'The licence dates are wrong';
  return null;
}
