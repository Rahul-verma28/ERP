import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { db } from '../../kernel/db';
import { AppError } from '../../kernel/errors';
import { normaliseEmail, normaliseMobile } from '../../kernel/crypto';
import { templateByKey } from '../../contracts/templates';
import { industryTemplateKey, storedIndustryKey } from '../../contracts/workspace';
import { publish } from '../events/outbox';
import { audit } from '../audit/service';
import { createAccessLink } from '../identity/accessLinks';
import { applyLicence } from './service';

// Making a business's workspace in this ERP. The Console decides that a business exists, its plan
// and who brought it in (and signs the licence); here only the ERP's part is made: the business,
// its main branch, the owner's membership and the licence. Three ways in, one function:
//   • self-serve signup on this ERP's website (the owner already chose a password)
//   • "Add another business" by a signed-in owner
//   • the Console adding a business (provisioning API, POST /tenants): the owner sets a password
//     through the setup link

export type WorkspaceOwner =
  | { kind: 'new'; name: string; email: string; mobile: string; passwordHash: string | null; mobileVerified: boolean }
  | { kind: 'existing'; userId: string };

export interface WorkspaceInput {
  id: string;
  name: string;
  industryKey: string;
  legalName?: string | null;
  gstin?: string | null;
  stateCode?: string | null;
  owner: WorkspaceOwner;
  /** Signup answers (contracts/workspace.ts WorkspaceProfile) */
  profile?: Record<string, unknown>;
  licence: string;
}

/** Must run inside withPlatform(). Same id again: the business that is already there (safe to retry). */
export async function createWorkspace(input: WorkspaceInput) {
  const tx = db();
  const existing = await tx.tenant.findUnique({ where: { id: input.id }, select: { id: true, ownerUserId: true } });
  if (existing) {
    await applyLicence(input.licence, { tenantId: existing.id });
    const ownerRole = await tx.role.findFirstOrThrow({ where: { tenantId: null, key: 'owner' }, select: { id: true } });
    return { tenantId: existing.id, ownerUserId: existing.ownerUserId, ownerRoleId: ownerRole.id, created: false };
  }

  const template = templateByKey(industryTemplateKey(input.industryKey) ?? '');
  if (!template) throw new AppError('VALIDATION_FAILED', 'Unknown industry.', { fields: { industryKey: 'Unknown industry' } });

  let userId: string;
  if (input.owner.kind === 'existing') {
    userId = (await tx.user.findUniqueOrThrow({ where: { id: input.owner.userId }, select: { id: true } })).id;
  } else {
    const o = input.owner;
    // One login per person across businesses
    const byEmail = await tx.user.findUnique({ where: { email: o.email } });
    const byMobile = await tx.user.findUnique({ where: { mobile: o.mobile } });
    if (byEmail && byMobile && byEmail.id !== byMobile.id) {
      throw new AppError('CONFLICT', 'This email and this mobile belong to two different people on AHEAD. Use one person’s email and mobile.', { fields: { 'owner.email': 'Belongs to someone else', 'owner.mobile': 'Belongs to someone else' } });
    }
    const found = byEmail ?? byMobile;
    // Self-signup with someone else's email or mobile is refused; the Console may add a business for an existing person
    if (found && o.passwordHash) throw new AppError(byEmail ? 'EMAIL_TAKEN' : 'MOBILE_TAKEN', 'An account with these details already exists. Please sign in.');
    userId =
      found?.id ??
      (await tx.user.create({ data: { name: o.name, email: o.email, mobile: o.mobile, passwordHash: o.passwordHash, mobileVerifiedAt: o.mobileVerified ? new Date() : null } })).id;
  }

  const tenant = await tx.tenant.create({
    data: {
      id: input.id,
      name: input.name,
      industryKey: storedIndustryKey(input.industryKey),
      templateVersion: template.version,
      status: 'trialing',
      gstin: input.gstin ?? null,
      billingStateCode: input.stateCode ?? input.gstin?.slice(0, 2) ?? null,
      legalName: input.legalName ?? null,
      profile: (input.profile ?? {}) as Prisma.InputJsonValue,
      preferences: {} as Prisma.InputJsonValue,
      ownerUserId: userId,
    },
  });
  await tx.branch.create({ data: { tenantId: tenant.id, name: 'Main Branch', code: 'MAIN', isDefault: true } });
  const ownerRole = await tx.role.findFirstOrThrow({ where: { tenantId: null, key: 'owner' }, select: { id: true } });
  await tx.tenantMember.create({ data: { tenantId: tenant.id, userId, roleId: ownerRole.id, status: 'active', joinedAt: new Date() } });
  await tx.user.update({ where: { id: userId }, data: { lastTenantId: tenant.id } });

  // The licence sets the real status (trial, paid, waiting for payment) and opens the modules
  await applyLicence(input.licence, { tenantId: tenant.id });

  await publish('tenant.created', { tenantId: tenant.id, industryKey: template.key, ownerUserId: userId }, { tenantId: tenant.id });
  await audit({ tenantId: tenant.id, actorId: input.owner.kind === 'existing' || input.owner.passwordHash ? userId : null, action: 'tenant.created', entity: 'tenant', entityId: tenant.id, after: { name: tenant.name } });
  return { tenantId: tenant.id, ownerUserId: userId, ownerRoleId: ownerRole.id, created: true };
}

// ── The Console adds a business (provisioning API) ──

export const ProvisionInput = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(2).max(100),
  industryKey: z.string().min(2).max(60),
  legalName: z.string().trim().max(160).nullish(),
  gstin: z.string().trim().toUpperCase().regex(/^[0-9]{2}[A-Z0-9]{13}$/).nullish(),
  stateCode: z.string().regex(/^\d{2}$/).nullish(),
  owner: z.object({
    name: z.string().trim().min(2).max(100),
    email: z.string().trim().email().transform(normaliseEmail),
    mobile: z.string().trim().transform(normaliseMobile),
  }),
  licence: z.string().min(50).max(20_000),
});
export type ProvisionInput = z.infer<typeof ProvisionInput>;

/** Must run inside withPlatform(). Hands back a fresh one-use setup link for the owner. */
export async function provisionWorkspace(input: ProvisionInput) {
  const made = await createWorkspace({
    id: input.id, name: input.name, industryKey: input.industryKey, legalName: input.legalName, gstin: input.gstin, stateCode: input.stateCode,
    owner: { kind: 'new', ...input.owner, passwordHash: null, mobileVerified: false }, licence: input.licence,
  });
  const ownerLink = await createAccessLink({ kind: 'client_owner', userId: made.ownerUserId, tenantId: made.tenantId, createdBy: null });
  return { tenantId: made.tenantId, ownerUserId: made.ownerUserId, ownerLink, created: made.created };
}
