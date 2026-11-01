import type { AcquiredByType, AcquisitionMethod, Prisma, TenantSource } from '@prisma/client';
import { db } from '../../kernel/db';
import { AppError } from '../../kernel/errors';
import { pepperedHash } from '../../kernel/crypto';
import { templateByKey } from '../../contracts/templates';
import { industryTemplateKey, storedIndustryKey } from '../../contracts/workspace';
import { persistEntitlements } from '../subscription/entitlements';
import { publish } from '../events/outbox';
import { audit } from '../audit/service';
import { getSetting } from '../settings/service';

// ONB-01: every channel (self-signup, vendor link/code, sales team, partner) calls this one service.

/** Who brought the tenant in (design v2 §11). Locked at creation; tenants never see it. */
export interface AcquisitionInput {
  byType: AcquiredByType;
  byUserId?: string;
  method: AcquisitionMethod;
  referralCode?: string;
  couponCode?: string;
}

const SOURCE_BY_ACQUIRER: Record<AcquiredByType, TenantSource> = { self: 'direct', vendor: 'vendor', sales_user: 'sales', partner_user: 'partner' };

export function validateAcquisition(a: AcquisitionInput) {
  if (a.byType === 'self' && a.byUserId) throw new AppError('VALIDATION_FAILED', 'A self-signup has no acquiring user.', { fields: { byUserId: 'Must be empty for self-signup' } });
  if (a.byType !== 'self' && !a.byUserId) throw new AppError('VALIDATION_FAILED', 'Who brought this client in is required.', { fields: { byUserId: 'Required' } });
  return SOURCE_BY_ACQUIRER[a.byType];
}

export interface CreateTenantInput {
  owner:
    | { kind: 'new'; name: string; email: string; mobile: string; passwordHash: string | null; mobileVerified: boolean; emailVerified?: boolean }
    | { kind: 'existing'; userId: string };
  businessName: string;
  industryKey: string;
  /** Defaults to a self-signup */
  acquisition?: AcquisitionInput;
  partnerId?: string;
  /** AHEAD's own workspace (uses its own CRM to sell) */
  isInternal?: boolean;
  gstin?: string;
  billingStateCode?: string;
  legalName?: string | null;
  /** Signup answers (contracts/workspace.ts WorkspaceProfile) */
  profile?: Record<string, unknown>;
  /** design v2: sales/vendor onboarding — no trial, modules open after the first payment */
  paidOnboarding?: { planId: string; cycle: 'monthly' | 'yearly' };
}

/** End of the trial's last day in IST (e.g. 2026-11-06T18:29:59Z). */
export function trialEnd(from: Date, days: number) {
  const IST_OFFSET = 330 * 60 * 1000;
  const ist = new Date(from.getTime() + IST_OFFSET + days * 86_400_000);
  ist.setUTCHours(23, 59, 59, 0);
  return new Date(ist.getTime() - IST_OFFSET);
}

/** Must run inside withPlatform(). */
export async function createTenant(input: CreateTenantInput) {
  const tx = db();
  const template = templateByKey(industryTemplateKey(input.industryKey) ?? '');
  if (!template) throw new AppError('VALIDATION_FAILED', 'Unknown industry.', { fields: { industryKey: 'Unknown industry' } });
  const acquisition: AcquisitionInput = input.acquisition ?? { byType: 'self', method: 'signup' };
  const source = validateAcquisition(acquisition);
  const onboardingType = input.paidOnboarding ? ('direct_paid' as const) : ('trial' as const);

  // Resolve owner identity
  let user;
  if (input.owner.kind === 'existing') {
    user = await tx.user.findUniqueOrThrow({ where: { id: input.owner.userId } });
  } else {
    const o = input.owner;
    if (await tx.user.findUnique({ where: { email: o.email } })) throw new AppError('EMAIL_TAKEN', 'An account with this email already exists. Please sign in.');
    if (await tx.user.findUnique({ where: { mobile: o.mobile } })) throw new AppError('MOBILE_TAKEN', 'An account with this mobile number already exists. Please sign in.');
    user = await tx.user.create({
      data: {
        name: o.name,
        email: o.email,
        mobile: o.mobile,
        passwordHash: o.passwordHash,
        mobileVerifiedAt: o.mobileVerified ? new Date() : null,
        emailVerifiedAt: o.emailVerified ? new Date() : null,
      },
    });
  }

  // ONB-03: one trial per business (mobile, email, GSTIN)
  const mobileHash = pepperedHash(user.mobile);
  const emailHash = pepperedHash(user.email);
  const gstin = input.gstin?.toUpperCase();
  if (onboardingType === 'trial' && !input.isInternal) {
    const dup = await tx.trialRegistry.findFirst({
      where: { OR: [{ mobileHash }, { emailHash }, ...(gstin ? [{ gstin }] : [])] },
    });
    if (dup) throw new AppError('DUPLICATE_TRIAL', 'A free trial has already been used with these details.');
  }

  // Console › Settings › Appearance: the look every new business starts with
  const branding = await getSetting('defaults.branding');

  const now = new Date();
  const tenant = await tx.tenant.create({
    data: {
      name: input.businessName,
      industryKey: storedIndustryKey(input.industryKey),
      templateVersion: template.version,
      status: onboardingType === 'trial' ? 'trialing' : 'incomplete',
      source,
      onboardingType,
      isInternal: !!input.isInternal,
      partnerId: input.partnerId,
      billingOwner: input.partnerId ? 'partner' : 'self',
      gstin,
      billingStateCode: input.billingStateCode,
      legalName: input.legalName ?? null,
      profile: (input.profile ?? {}) as Prisma.InputJsonValue,
      preferences: { branding } as Prisma.InputJsonValue,
      ownerUserId: user.id,
    },
  });

  const branch = await tx.branch.create({ data: { tenantId: tenant.id, name: 'Main Branch', code: 'MAIN', isDefault: true } });

  await tx.tenantAcquisition.create({
    data: {
      tenantId: tenant.id, acquiredByType: acquisition.byType, acquiredByUserId: acquisition.byUserId ?? null, method: acquisition.method,
      referralCode: acquisition.referralCode, couponCode: acquisition.couponCode?.toUpperCase(), lockedAt: now,
    },
  });

  let subscription;
  if (input.paidOnboarding) {
    subscription = await tx.subscription.create({
      data: { tenantId: tenant.id, planId: input.paidOnboarding.planId, cycle: input.paidOnboarding.cycle, status: 'incomplete' },
    });
  } else {
    const [trialPlanKey, trialDays] = await Promise.all([getSetting('trial.plan_key'), getSetting('trial.days')]);
    const trialPlan = await tx.plan.findUniqueOrThrow({ where: { key: trialPlanKey } });
    subscription = await tx.subscription.create({
      data: { tenantId: tenant.id, planId: trialPlan.id, status: 'trialing', trialEndsAt: trialEnd(now, trialDays) },
    });
  }

  const ownerRole = await tx.role.findFirstOrThrow({ where: { tenantId: null, key: 'owner' } });
  await tx.tenantMember.create({
    data: { tenantId: tenant.id, userId: user.id, roleId: ownerRole.id, status: 'active', joinedAt: now },
  });

  if (onboardingType === 'trial' && !input.isInternal) await tx.trialRegistry.create({ data: { tenantId: tenant.id, mobileHash, emailHash, gstin } });
  await tx.user.update({ where: { id: user.id }, data: { lastTenantId: tenant.id } });
  await persistEntitlements(tenant.id);

  await publish(
    'tenant.created',
    { tenantId: tenant.id, source, onboardingType, partnerId: input.partnerId ?? null, industryKey: template.key, ownerUserId: user.id },
    { tenantId: tenant.id },
  );
  await audit({ tenantId: tenant.id, actorId: user.id, action: 'tenant.created', entity: 'tenant', entityId: tenant.id, after: { name: tenant.name, source, onboardingType } });

  return { user, tenant, branch, subscription, ownerRoleId: ownerRole.id };
}
