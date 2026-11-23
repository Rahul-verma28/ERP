import type { TenantStatus } from '@prisma/client';
import { env } from '../../config/env';
import { AppError } from '../../kernel/errors';
import { privateKeyFrom, signLicence } from '../../kernel/licence';
import { CLOUD_LICENCE_DAYS, LICENCE_VERSION, type LicenceLimits, type LicencePayload, type LicenceStatus, type LicenceTier } from '../../contracts/licence';
import { MODULE_KEYS, type ModuleKey, type ModuleTier } from '../../contracts/modules';
import { devKeys } from '../licensing/service';

// CONSOLE side of licensing: turn a subscription into a signed licence. Only the Console holds the
// private key. (Phase 2 moves this file to console-api; until then it runs in the same process
// and hands the licence to the ERP side directly.)

let privateKey: ReturnType<typeof privateKeyFrom> | null = null;
function licencePrivateKey() {
  if (privateKey) return privateKey;
  const der = env.LICENCE_PRIVATE_KEY ?? devKeys()?.privateKey;
  if (!der) throw new AppError('INTERNAL', 'The Console has no licence private key (LICENCE_PRIVATE_KEY).');
  return (privateKey = privateKeyFrom(der));
}

/** A closed or purged business: closed. Everything else carries over. */
const licenceStatus = (s: TenantStatus): LicenceStatus => (s === 'purged' ? 'closed' : s);

/** What the plan gives each module, as a licence tier (read-only for used modules is the ERP's call) */
export function licenceModules(resolved: Record<ModuleKey, { status: string; tier: ModuleTier }>): Record<ModuleKey, LicenceTier> {
  const out = {} as Record<ModuleKey, LicenceTier>;
  for (const k of MODULE_KEYS) out[k] = resolved[k].status === 'active' ? resolved[k].tier : 'none';
  return out;
}

export function issueLicence(input: {
  tenantId: string;
  status: TenantStatus;
  plan: { key: string; name: string };
  modules: Record<ModuleKey, LicenceTier>;
  limits: LicenceLimits;
  trialEndsAt: Date | null;
  periodEnd: Date | null;
  graceEndsAt?: Date | null;
}): { token: string; payload: LicencePayload } {
  const now = Date.now();
  const iat = Math.floor(now / 1000);
  const payload: LicencePayload = {
    iss: 'ahead-console',
    typ: 'ahead-licence',
    v: LICENCE_VERSION,
    sub: input.tenantId,
    dep: env.DEPLOYMENT_ID,
    // Milliseconds would overflow the column; seconds plus the order of issue within a second
    seq: iat,
    plan: input.plan,
    status: licenceStatus(input.status),
    modules: input.modules,
    limits: input.limits,
    trialEndsAt: input.trialEndsAt?.toISOString() ?? null,
    periodEnd: input.periodEnd?.toISOString() ?? null,
    graceEndsAt: input.graceEndsAt?.toISOString() ?? null,
    iat,
    exp: iat + CLOUD_LICENCE_DAYS * 86_400,
  };
  return { token: signLicence(payload, licencePrivateKey()), payload };
}
