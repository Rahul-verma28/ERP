import type { EntitlementStatus, Prisma } from '@prisma/client';
import { env } from '../../config/env';
import { db, prisma } from '../../kernel/db';
import { cache } from '../../kernel/cache';
import { AppError } from '../../kernel/errors';
import { LicenceError, newLicenceKeys, publicKeyFrom, readLicence } from '../../kernel/licence';
import { LICENCE_GRACE_DAYS, type LicencePayload, type LicenceTier } from '../../contracts/licence';
import { MODULE_KEYS, type ModuleKey, type ModuleTier } from '../../contracts/modules';

// ERP side of licensing: take a signed licence, check it, keep it, and open modules from it.
// This file never reads a Console table. See docs/architecture/console-erp-split.md.

const DAY = 86_400_000;

let ephemeral: ReturnType<typeof newLicenceKeys> | null = null;
/** Development and tests without keys in .env get a key pair for this process only */
export function devKeys() {
  if (env.NODE_ENV === 'production') return null;
  return (ephemeral ??= newLicenceKeys());
}

let publicKey: ReturnType<typeof publicKeyFrom> | null = null;
function licencePublicKey() {
  if (publicKey) return publicKey;
  const pem = env.LICENCE_PUBLIC_KEY ?? devKeys()?.publicKey;
  if (!pem) throw new AppError('INTERNAL', 'This ERP has no licence public key (LICENCE_PUBLIC_KEY).');
  return (publicKey = publicKeyFrom(pem));
}

/** A licence that ran out more than the grace days ago only reads */
export const licenceLapsed = (expiresAt: Date, now = new Date()) => now.getTime() > expiresAt.getTime() + LICENCE_GRACE_DAYS * DAY;

/** What a module is open as, from the licence tier and whether the business used it before */
export function moduleFromTier(tier: LicenceTier, everUsed: boolean, lapsed: boolean): { status: EntitlementStatus; tier: ModuleTier } {
  if (tier === 'none' || lapsed) return { status: everUsed ? 'read_only' : 'inactive', tier: 'basic' };
  return { status: 'active', tier: tier === 'full' ? 'full' : 'basic' };
}

/**
 * Store a licence for its business. Checks the signature, that it is for this installation and
 * this business, and that it is not older than the one held. Returns false when ignored as older.
 * Runs in a platform transaction (the caller's).
 */
export async function applyLicence(token: string, opts: { tenantId?: string; source?: 'console' | 'file' } = {}): Promise<{ applied: boolean; licence: LicencePayload }> {
  let l: LicencePayload;
  try {
    l = readLicence(token, licencePublicKey());
  } catch (e) {
    throw new AppError('VALIDATION_FAILED', e instanceof LicenceError ? e.message : 'This licence cannot be read.', { fields: { licence: e instanceof Error ? e.message : 'Invalid' } });
  }
  if (l.dep !== env.DEPLOYMENT_ID) throw new AppError('VALIDATION_FAILED', `This licence is for another installation (${l.dep}).`, { fields: { licence: 'Wrong installation' } });
  if (opts.tenantId && l.sub !== opts.tenantId) throw new AppError('VALIDATION_FAILED', 'This licence is for another business.', { fields: { licence: 'Wrong business' } });
  const tenantId = l.sub;
  const tx = db();
  const tenant = await tx.tenant.findUnique({ where: { id: tenantId }, select: { id: true, status: true } });
  if (!tenant) throw new AppError('NOT_FOUND', 'No business here has this licence’s id.');
  const held = await tx.tenantLicence.findUnique({ where: { tenantId }, select: { seq: true } });
  if (held && l.seq < held.seq) return { applied: false, licence: l };

  const data = {
    token, seq: l.seq, status: l.status, planKey: l.plan.key, payload: l as unknown as Prisma.InputJsonValue,
    issuedAt: new Date(l.iat * 1000), expiresAt: new Date(l.exp * 1000), source: opts.source ?? 'console', receivedAt: new Date(),
  };
  await tx.tenantLicence.upsert({ where: { tenantId }, create: { tenantId, ...data }, update: data });
  await writeModules(tenantId, l, new Date(l.exp * 1000));
  // The business's own status follows the licence (shown in the app, used by sign-in rules)
  if (tenant.status !== l.status) await tx.tenant.update({ where: { id: tenantId }, data: { status: l.status, closedAt: l.status === 'closed' ? new Date() : null } });
  cache.del(`ent:tenant:${tenantId}`);
  return { applied: true, licence: l };
}

/** Module rows for the business: open, read-only (used before) or closed, from the licence */
async function writeModules(tenantId: string, l: LicencePayload, expiresAt: Date) {
  const tx = db();
  const rows = await tx.tenantEntitlement.findMany({ where: { tenantId } });
  const lapsed = licenceLapsed(expiresAt);
  const now = new Date();
  const missing: Prisma.TenantEntitlementCreateManyInput[] = [];
  for (const key of MODULE_KEYS) {
    const prev = rows.find((r) => r.moduleKey === key);
    const m = moduleFromTier(l.modules[key], !!prev?.activatedAt, lapsed);
    const activatedAt = prev?.activatedAt ?? (m.status === 'active' ? now : null);
    if (!prev) {
      missing.push({ tenantId, moduleKey: key, status: m.status, limits: { tier: m.tier }, activatedAt });
      continue;
    }
    const same = prev.status === m.status && (prev.limits as { tier?: string } | null)?.tier === m.tier && +(prev.activatedAt ?? 0) === +(activatedAt ?? 0);
    if (!same) await tx.tenantEntitlement.update({ where: { tenantId_moduleKey: { tenantId, moduleKey: key } }, data: { status: m.status, limits: { tier: m.tier }, activatedAt } });
  }
  if (missing.length) await tx.tenantEntitlement.createMany({ data: missing });
}

/** The licence held for a business (platform read: used by entitlements and /me) */
export async function heldLicence(tenantId: string) {
  const row = await prisma.tenantLicence.findUnique({ where: { tenantId } });
  return row ? { ...row, licence: row.payload as unknown as LicencePayload } : null;
}

/** Module rows as the app reads them */
export async function moduleRows(tenantId: string) {
  const rows = await prisma.tenantEntitlement.findMany({ where: { tenantId } });
  const out = {} as Record<ModuleKey, { status: EntitlementStatus; tier: ModuleTier }>;
  for (const key of MODULE_KEYS) {
    const r = rows.find((x) => x.moduleKey === key);
    out[key] = { status: r?.status ?? 'inactive', tier: (r?.limits as { tier?: ModuleTier } | null)?.tier ?? 'basic' };
  }
  return out;
}
