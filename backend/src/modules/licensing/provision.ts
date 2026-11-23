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

// The Console asks this ERP to set up a business (provisioning API, POST /tenants). The Console
// chose the id, the plan and who onboarded it; here only the workspace is made: the business,
// its main branch, the owner's login (no password: they set it through the setup link) and the
// licence. Running the same request again returns the same business (safe to retry).

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
  /** A partner's client: the partner pays AHEAD, the business never sees AHEAD's bills */
  billedToPartner: z.boolean().default(false),
  licence: z.string().min(50).max(20_000),
  /** Who onboarded it, for the business's own record (the Console keeps the real one) */
  source: z.enum(['direct', 'sales', 'vendor', 'partner']).default('direct'),
});
export type ProvisionInput = z.infer<typeof ProvisionInput>;

/** Must run inside withPlatform() */
export async function provisionWorkspace(input: ProvisionInput) {
  const tx = db();
  const existing = await tx.tenant.findUnique({ where: { id: input.id }, select: { id: true, ownerUserId: true } });
  if (existing) {
    // Already made (a retry): keep the newest licence and hand back a fresh setup link
    await applyLicence(input.licence, { tenantId: existing.id });
    const link = await createAccessLink({ kind: 'client_owner', userId: existing.ownerUserId, tenantId: existing.id, createdBy: null });
    return { tenantId: existing.id, ownerUserId: existing.ownerUserId, ownerLink: link, created: false };
  }

  const template = templateByKey(industryTemplateKey(input.industryKey) ?? '');
  if (!template) throw new AppError('VALIDATION_FAILED', 'Unknown industry.', { fields: { industryKey: 'Unknown industry' } });

  // One login per person across businesses: an owner who already uses AHEAD keeps their login
  const byEmail = await tx.user.findUnique({ where: { email: input.owner.email } });
  const byMobile = await tx.user.findUnique({ where: { mobile: input.owner.mobile } });
  if (byEmail && byMobile && byEmail.id !== byMobile.id) {
    throw new AppError('CONFLICT', 'This email and this mobile belong to two different people on AHEAD. Use one person’s email and mobile.', { fields: { 'owner.email': 'Belongs to someone else', 'owner.mobile': 'Belongs to someone else' } });
  }
  const user =
    byEmail ??
    byMobile ??
    (await tx.user.create({ data: { name: input.owner.name, email: input.owner.email, mobile: input.owner.mobile, passwordHash: null } }));

  const tenant = await tx.tenant.create({
    data: {
      id: input.id,
      name: input.name,
      industryKey: storedIndustryKey(input.industryKey),
      templateVersion: template.version,
      status: 'trialing',
      source: input.source,
      onboardingType: 'trial',
      billingOwner: input.billedToPartner ? 'partner' : 'self',
      gstin: input.gstin ?? null,
      billingStateCode: input.stateCode ?? input.gstin?.slice(0, 2) ?? null,
      legalName: input.legalName ?? null,
      profile: {} as Prisma.InputJsonValue,
      preferences: {} as Prisma.InputJsonValue,
      ownerUserId: user.id,
    },
  });
  await tx.branch.create({ data: { tenantId: tenant.id, name: 'Main Branch', code: 'MAIN', isDefault: true } });
  const ownerRole = await tx.role.findFirstOrThrow({ where: { tenantId: null, key: 'owner' } });
  await tx.tenantMember.create({ data: { tenantId: tenant.id, userId: user.id, roleId: ownerRole.id, status: 'active', joinedAt: new Date() } });
  if (!user.lastTenantId) await tx.user.update({ where: { id: user.id }, data: { lastTenantId: tenant.id } });

  // The licence sets the real status (trial, paid, waiting for payment) and opens the modules
  await applyLicence(input.licence, { tenantId: tenant.id });
  const ownerLink = await createAccessLink({ kind: 'client_owner', userId: user.id, tenantId: tenant.id, createdBy: null });

  await publish('tenant.created', { tenantId: tenant.id, source: input.source, onboardingType: 'trial', partnerId: null, industryKey: template.key, ownerUserId: user.id }, { tenantId: tenant.id });
  await audit({ tenantId: tenant.id, actorId: null, action: 'tenant.created', entity: 'tenant', entityId: tenant.id, after: { name: tenant.name, source: input.source, by: 'console' } });
  return { tenantId: tenant.id, ownerUserId: user.id, ownerLink, created: true };
}
