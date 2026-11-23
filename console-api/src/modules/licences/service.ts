import type { SubStatus } from '@prisma/client';
import { CLOUD_LICENCE_DAYS, LICENCE_VERSION, type LicenceLimits, type LicencePayload, type LicenceTier } from '@contracts/licence';
import { privateKeyFrom, signLicence } from '@contracts/licenceSigning';
import { MODULES, MODULE_KEYS, type ModuleKey } from '@contracts/modules';
import { env } from '../../config/env';
import { prisma, type Tx } from '../../kernel/db';
import { getSetting } from '../system/settings';

// What a business may use, worked out from its subscription and signed as a licence. The ERP
// decides on its own side whether a module that is not given is read-only (used before).

const FREE_TIER = new Set<string>(MODULES.filter((m) => m.freeTier).map((m) => m.key));
let key: ReturnType<typeof privateKeyFrom> | null = null;
const privateKey = () => (key ??= privateKeyFrom(env.LICENCE_PRIVATE_KEY));

/** Pure: module tiers from the status, the plan's modules and the switches on top */
export function tiersFor(status: SubStatus, planModules: string[], isFree: boolean, overrides: { moduleKey: string; state: string }[]): Record<ModuleKey, LicenceTier> {
  const out = {} as Record<ModuleKey, LicenceTier>;
  const paid = new Set(planModules);
  for (const k of MODULE_KEYS) {
    let t: LicenceTier;
    if (status === 'trialing') t = 'full';
    // Waiting for the first payment, or closed: nothing opens (used modules stay readable in the ERP)
    else if (status === 'incomplete' || status === 'closed') t = 'none';
    else if ((status === 'active' || status === 'past_due') && !isFree && paid.has(k)) t = 'full';
    else if (FREE_TIER.has(k)) t = 'basic';
    else t = 'none';
    out[k] = t;
  }
  if (status !== 'incomplete' && status !== 'closed') for (const o of overrides) if (o.moduleKey in out) out[o.moduleKey as ModuleKey] = o.state === 'on' ? 'full' : 'none';
  return out;
}

/** Limits: the trial's while trialing, the Free plan's once on Free, else the plan's plus extra users */
export async function limitsFor(status: SubStatus, plan: { limits: unknown; isFree: boolean }, extraUsers: number, tx: Tx | typeof prisma = prisma): Promise<LicenceLimits> {
  if (status === 'trialing') return (await getSetting<LicenceLimits>('trial.limits', tx))!;
  if (status === 'free' || status === 'closed') {
    const free = await tx.plan.findFirst({ where: { isFree: true }, select: { limits: true } });
    return (free?.limits ?? plan.limits) as LicenceLimits;
  }
  const l = plan.limits as LicenceLimits;
  return plan.isFree ? l : { ...l, users: l.users + extraUsers };
}

/**
 * Issue a fresh licence for a business and queue it for its ERP. Call inside the transaction that
 * changed the subscription, so the change and its licence commit together.
 */
export async function issueLicence(tx: Tx, businessId: string) {
  const sub = await tx.subscription.findUniqueOrThrow({ where: { businessId }, include: { plan: true, business: { select: { provisionedAt: true } } } });
  const overrides = await tx.moduleOverride.findMany({ where: { businessId, OR: [{ until: null }, { until: { gt: new Date() } }] }, select: { moduleKey: true, state: true } });
  const last = await tx.licence.findFirst({ where: { businessId }, orderBy: { seq: 'desc' }, select: { seq: true } });
  const iat = Math.floor(Date.now() / 1000);
  // Always newer than the last one, even when two are issued in the same second
  const seq = Math.max(iat, (last?.seq ?? 0) + 1);
  const payload: LicencePayload = {
    iss: 'ahead-console',
    typ: 'ahead-licence',
    v: LICENCE_VERSION,
    sub: businessId,
    dep: env.DEPLOYMENT_ID,
    seq,
    plan: { key: sub.plan.key, name: sub.plan.name },
    status: sub.status,
    modules: tiersFor(sub.status, sub.plan.modules, sub.plan.isFree, overrides),
    limits: await limitsFor(sub.status, sub.plan, sub.extraUsers, tx),
    trialEndsAt: sub.trialEndsAt?.toISOString() ?? null,
    periodEnd: sub.periodEnd?.toISOString() ?? null,
    graceEndsAt: sub.graceEndsAt?.toISOString() ?? null,
    iat,
    exp: iat + CLOUD_LICENCE_DAYS * 86_400,
  };
  const token = signLicence(payload, privateKey());
  const licence = await tx.licence.create({
    data: { businessId, seq, token, status: sub.status, planKey: sub.plan.key, issuedAt: new Date(iat * 1000), expiresAt: new Date(payload.exp * 1000) },
  });
  // Not set up in the ERP yet: the setup call carries the newest licence
  if (sub.business.provisionedAt) await tx.delivery.create({ data: { kind: 'licence', businessId, payload: { licenceId: licence.id } } });
  return { licence, payload };
}
