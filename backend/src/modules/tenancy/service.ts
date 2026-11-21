import { z } from 'zod';
import { env } from '../../config/env';
import { db, withPlatform } from '../../kernel/db';
import { cache } from '../../kernel/cache';
import { AppError, notFound } from '../../kernel/errors';
import { hashPassword, normaliseEmail, normaliseMobile, randomToken, sha256, verifyPassword } from '../../kernel/crypto';
import type { TenantCtx } from '../../kernel/context';
import { getEntitlements } from '../subscription/entitlements';
import { visibleRoles } from '../access/service';
import { publish } from '../events/outbox';
import { audit } from '../audit/service';
import { notify, sendMessage } from '../notifications/service';
import { consumeOtp } from '../identity/otp';
import { optionalText, zGstin, zPincode, zReason, zStateCode } from '../../kernel/zodRules';
import { gstinStateMismatch } from '../../contracts/validation';

// Tenant administration (LLD §10.2): profile, branches, members, invitations.

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const Address = z.object({
  line1: z.string().trim().max(200).optional(),
  line2: z.string().trim().max(200).optional(),
  city: z.string().trim().max(80).optional(),
  state: z.string().trim().max(80).optional(),
  pincode: zPincode.optional().or(z.literal('')),
});

/**
 * Logo: a link, or (until file storage exists) a small image the web app has already
 * resized to 320 px and encoded as a data URL. SVG data is refused — only raster images.
 */
const LOGO_DATA_URL = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;
const LogoInput = z.union([
  z.string().regex(LOGO_DATA_URL, 'Use a PNG, JPG or WebP image').max(200_000, 'This logo is too large — use a smaller image'),
  z.string().url('Enter a full link, e.g. https://example.com').max(500).refine((v) => /^https?:\/\//.test(v), 'Use a link that starts with https://'),
]);

export const TenantPatch = z.object({
  name: z.string().trim().min(2, 'Use at least 2 characters').max(100, 'Keep it under 100 characters').optional(),
  legalName: optionalText(z.string().trim().max(160, 'Keep it under 160 characters')),
  gstin: optionalText(zGstin),
  billingStateCode: zStateCode.nullable().optional(),
  address: Address.nullable().optional(),
  logoUrl: optionalText(LogoInput),
  timezone: z.string().max(60).optional(),
  fyStartMonth: z.number().int().min(1).max(12).optional(),
  /** Required when a sensitive field changes; kept in the audit log */
  reason: zReason.optional(),
  /** updatedAt the client last saw; a mismatch means someone else saved in between */
  expectedUpdatedAt: z.string().datetime().optional(),
});

/** Changing these affects documents already issued or tax maths, so they need a reason. */
const SENSITIVE_TENANT_FIELDS = ['legalName', 'gstin', 'billingStateCode', 'fyStartMonth'] as const;

export async function getTenant(tenantId: string) {
  const t = await db().tenant.findUnique({ where: { id: tenantId } });
  if (!t) throw notFound('Business');
  return t;
}

export async function updateTenant(tenantId: string, input: z.infer<typeof TenantPatch>) {
  const { reason, expectedUpdatedAt, ...patch } = input;
  const before = await getTenant(tenantId);
  if (expectedUpdatedAt && new Date(expectedUpdatedAt).getTime() !== before.updatedAt.getTime()) {
    throw new AppError('VERSION_CONFLICT', 'Someone else changed these details after you opened them. Reload to see the latest.');
  }
  // GSTIN state code must match the chosen state
  const gstin = patch.gstin === undefined ? before.gstin : patch.gstin;
  const state = patch.billingStateCode === undefined ? before.billingStateCode : patch.billingStateCode;
  const mismatch = gstinStateMismatch(gstin, state);
  if (mismatch) throw new AppError('VALIDATION_FAILED', mismatch, { fields: { gstin: mismatch } });

  const changed = (Object.keys(patch) as (keyof typeof patch)[]).filter((k) => JSON.stringify(patch[k] ?? null) !== JSON.stringify(before[k] ?? null));
  if (!changed.length) return before;
  // Filling an empty field (first setup) needs no reason; changing a value that's already set does
  if (changed.some((k) => (SENSITIVE_TENANT_FIELDS as readonly string[]).includes(k) && before[k] != null) && !reason) {
    throw new AppError('VALIDATION_FAILED', 'Add a reason for this change.', { fields: { reason: 'Add a reason (10–500 characters)' } });
  }
  if (changed.includes('fyStartMonth') && (await db().salesDocument.count({ where: { kind: 'invoice', number: { not: null } } })) > 0) {
    const message = 'The financial year is locked after your first invoice.';
    throw new AppError('VALIDATION_FAILED', message, { fields: { fyStartMonth: message } });
  }
  const data = Object.fromEntries(changed.map((k) => [k, patch[k]]));
  const after = await db().tenant.update({ where: { id: tenantId }, data: { ...data, address: patch.address ?? undefined } });
  await audit({
    action: 'tenant.update',
    entity: 'tenant',
    entityId: tenantId,
    before: Object.fromEntries(changed.map((k) => [k, before[k]])),
    after: { ...data, ...(reason ? { reason } : {}) },
  });
  return after;
}

export async function onboardingStatus(tenantId: string) {
  const t = await getTenant(tenantId);
  const invites = await db().invitation.count();
  const members = await db().tenantMember.count();
  // Business-record steps are completed by the catalogue, CRM and billing modules as they land
  const flags = (t.onboarding ?? {}) as Record<string, unknown>;
  return {
    steps: [
      { key: 'profile', label: 'Add business details & GSTIN', done: !!(t.billingStateCode && t.address) },
      { key: 'logo', label: 'Upload your logo', done: !!t.logoUrl },
      { key: 'first_customer', label: 'Add your first customer', done: !!flags.firstCustomer },
      { key: 'first_item', label: 'Add a product or service', done: !!flags.firstItem },
      { key: 'first_invoice', label: 'Create your first invoice', done: !!flags.firstInvoice },
      { key: 'invite_team', label: 'Invite your team', done: invites > 0 || members > 1 },
    ],
  };
}

// ── Branches (PLT-02) ──

export const BranchInput = z.object({
  name: z.string().trim().min(2).max(100),
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{2,12}$/, '2–12 letters, digits or dashes'),
  address: Address.optional(),
  stateCode: zStateCode.optional(),
  gstin: zGstin.optional(),
});

export async function listBranches() {
  return db().branch.findMany({ orderBy: [{ isDefault: 'desc' }, { name: 'asc' }] });
}

export async function createBranch(tenantId: string, input: z.infer<typeof BranchInput>) {
  const ent = await getEntitlements(tenantId);
  const count = await db().branch.count();
  if (count >= ent.limits.branches) throw new AppError('LIMIT_REACHED', `Your plan allows ${ent.limits.branches} branch(es). Upgrade to add more.`, { limit: 'branches' });
  const b = await db().branch.create({ data: { ...input, tenantId } });
  await audit({ action: 'branch.create', entity: 'branch', entityId: b.id, after: input });
  return b;
}

export async function updateBranch(id: string, patch: Partial<z.infer<typeof BranchInput>> & { isActive?: boolean }) {
  const before = await db().branch.findUnique({ where: { id } });
  if (!before) throw notFound('Branch');
  // The main branch is where everything lands by default: it stays active
  if (patch.isActive === false && before.isDefault) throw new AppError('VALIDATION_FAILED', 'The main branch can\'t be made inactive. Make another branch the main one first.');
  const b = await db().branch.update({ where: { id }, data: patch });
  await audit({ action: 'branch.update', entity: 'branch', entityId: id, before, after: patch });
  return b;
}

// ── Members & invitations (PLT-07) ──

/** Roles that don't take a paid seat: self-service employees see only their own HR data */
export const SEAT_FREE_ROLE_TYPES = ['employee'] as const;
const seatFree = { roleType: { in: [...SEAT_FREE_ROLE_TYPES] } };

/** A seat for one more person with this role; self-service employee logins don't use one */
async function assertSeat(tenantId: string, roleId?: string) {
  if (roleId) {
    const role = await db().role.findUnique({ where: { id: roleId }, select: { roleType: true } });
    if (role && (SEAT_FREE_ROLE_TYPES as readonly string[]).includes(role.roleType)) return;
  }
  const ent = await getEntitlements(tenantId);
  const free = await db().role.findMany({ where: seatFree, select: { id: true } });
  const freeIds = free.map((r) => r.id);
  const [active, pending] = await Promise.all([
    db().tenantMember.count({ where: { status: 'active', roleId: { notIn: freeIds } } }),
    db().invitation.count({ where: { acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() }, roleId: { notIn: freeIds } } }),
  ]);
  if (active + pending >= ent.limits.users) {
    throw new AppError('LIMIT_REACHED', `Your plan allows ${ent.limits.users} users. Upgrade or deactivate a user first.`, { limit: 'users' });
  }
}

async function assertAssignableRole(tenantId: string, roleId: string) {
  const roles = await visibleRoles(tenantId);
  const role = roles.find((r) => r.id === roleId);
  if (!role) throw new AppError('VALIDATION_FAILED', 'This role is not available on your plan.', { fields: { roleId: 'Not available' } });
  if (role.key === 'owner') throw new AppError('VALIDATION_FAILED', 'There can be only one Owner.', { fields: { roleId: 'Owner cannot be assigned' } });
  return role;
}

async function assertBranches(branchIds: string[]) {
  if (!branchIds.length) return;
  const found = await db().branch.count({ where: { id: { in: branchIds } } });
  if (found !== branchIds.length) throw new AppError('VALIDATION_FAILED', 'Unknown branch.', { fields: { branchIds: 'Unknown branch' } });
}

export async function listMembers() {
  const [members, invitations] = await Promise.all([
    db().tenantMember.findMany({
      include: { user: { select: { id: true, name: true, email: true, mobile: true, lastLoginAt: true, mfaEnabled: true } }, role: { select: { id: true, key: true, name: true } } },
      orderBy: { createdAt: 'asc' },
    }),
    db().invitation.findMany({ where: { acceptedAt: null, revokedAt: null }, orderBy: { createdAt: 'desc' } }),
  ]);
  return {
    members: members.map((m) => ({ id: m.id, status: m.status, branchIds: m.branchIds, joinedAt: m.joinedAt, version: m.version, user: m.user, role: m.role })),
    invitations: invitations.map((i) => ({ id: i.id, name: i.name, email: i.email, mobile: i.mobile, roleId: i.roleId, expiresAt: i.expiresAt, expired: i.expiresAt < new Date() })),
  };
}

export const InviteInput = z
  .object({
    name: z.string().trim().max(100).optional(),
    email: z.string().trim().email().transform(normaliseEmail).optional(),
    mobile: z.string().trim().transform(normaliseMobile).pipe(z.string().regex(/^\+[1-9]\d{7,14}$/, 'Enter a valid mobile number')).optional(),
    roleId: z.string().uuid(),
    branchIds: z.array(z.string().uuid()).default([]),
    /** Giving an HR employee their login: it links to them when accepted */
    employeeId: z.string().uuid().optional(),
  })
  .refine((v) => v.email || v.mobile, { message: 'Email or mobile is required', path: ['email'] });

export async function invite(ctx: TenantCtx, input: z.infer<typeof InviteInput>) {
  const role = await assertAssignableRole(ctx.tenantId, input.roleId);
  await assertSeat(ctx.tenantId, input.roleId);
  await assertBranches(input.branchIds);

  const existingUser = await db().user.findFirst({ where: { OR: [...(input.email ? [{ email: input.email }] : []), ...(input.mobile ? [{ mobile: input.mobile }] : [])] } });
  if (existingUser) {
    const m = await db().tenantMember.findUnique({ where: { tenantId_userId: { tenantId: ctx.tenantId, userId: existingUser.id } } });
    if (m) throw new AppError('CONFLICT', 'This person is already a member of your business.');
  }

  if (input.employeeId) {
    const e = await db().employee.findFirst({ where: { id: input.employeeId, tenantId: ctx.tenantId }, select: { memberId: true, status: true } });
    if (!e) throw notFound('Employee');
    if (e.memberId) throw new AppError('CONFLICT', 'This employee already has a login.');
    if (e.status === 'exited') throw new AppError('CONFLICT', 'This employee has left. Give logins to people who work here.');
  }
  const token = randomToken();
  const inv = await db().invitation.create({
    data: {
      tenantId: ctx.tenantId, name: input.name, email: input.email, mobile: input.mobile, roleId: input.roleId,
      branchIds: input.branchIds, employeeId: input.employeeId ?? null, tokenHash: sha256(token), invitedBy: ctx.userId, expiresAt: new Date(Date.now() + INVITE_TTL_MS),
    },
  });
  const tenant = await getTenant(ctx.tenantId);
  const link = `${env.APP_URL}/invite/${token}`;
  const text = `You have been invited to join ${tenant.name} on AHEAD as ${role.name}. Accept within 7 days: ${link}`;
  if (input.email) await sendMessage({ channel: 'email', to: input.email, template: 'member.invite', subject: `Join ${tenant.name} on AHEAD`, text });
  if (input.mobile) await sendMessage({ channel: 'sms', to: input.mobile, template: 'member.invite', text });
  await publish('member.invited', { invitationId: inv.id, roleId: input.roleId });
  await audit({ action: 'member.invite', entity: 'invitation', entityId: inv.id, after: { email: input.email, mobile: input.mobile, role: role.key } });
  return { id: inv.id, expiresAt: inv.expiresAt, inviteLink: env.NODE_ENV === 'production' ? undefined : link };
}

export async function revokeInvitation(id: string) {
  const inv = await db().invitation.findUnique({ where: { id } });
  if (!inv || inv.acceptedAt) throw notFound('Invitation');
  await db().invitation.update({ where: { id }, data: { revokedAt: new Date() } });
  await audit({ action: 'member.invite_revoke', entity: 'invitation', entityId: id });
}

export const MemberPatch = z.object({
  roleId: z.string().uuid().optional(),
  branchIds: z.array(z.string().uuid()).optional(),
  status: z.enum(['active', 'deactivated']).optional(),
  version: z.number().int(),
});

export async function updateMember(ctx: TenantCtx, id: string, patch: z.infer<typeof MemberPatch>) {
  const m = await db().tenantMember.findUnique({ where: { id }, include: { role: true } });
  if (!m) throw notFound('User');
  if (m.version !== patch.version) throw new AppError('VERSION_CONFLICT', 'This user was changed by someone else. Reload and try again.');
  if (m.role.key === 'owner') throw new AppError('PERMISSION_DENIED', "The Owner's role and status cannot be changed.");
  if (m.userId === ctx.userId) throw new AppError('PERMISSION_DENIED', 'You cannot change your own role or status.');
  if (patch.roleId && patch.roleId !== m.roleId) await assertAssignableRole(ctx.tenantId, patch.roleId);
  if (patch.branchIds) await assertBranches(patch.branchIds);
  const nextRole = patch.roleId ?? m.roleId;
  const wasFree = (SEAT_FREE_ROLE_TYPES as readonly string[]).includes(m.role.roleType);
  if (patch.status === 'active' && m.status !== 'active') await assertSeat(ctx.tenantId, nextRole);
  else if (patch.roleId && patch.roleId !== m.roleId && m.status === 'active' && wasFree) await assertSeat(ctx.tenantId, nextRole);

  const updated = await db().tenantMember.update({
    where: { id },
    data: {
      roleId: patch.roleId,
      branchIds: patch.branchIds,
      status: patch.status,
      deactivatedAt: patch.status === 'deactivated' ? new Date() : patch.status === 'active' ? null : undefined,
      version: { increment: 1 },
    },
  });
  cache.del(`member:${ctx.tenantId}:${m.userId}`);
  if (patch.status === 'deactivated') {
    // Sign the user out of this business everywhere
    await withPlatform(() => db().userSession.updateMany({ where: { userId: m.userId, tenantId: ctx.tenantId, revokedAt: null }, data: { revokedAt: new Date() } }));
    await publish('member.deactivated', { memberId: id, userId: m.userId });
  }
  if (patch.status === 'active') await publish('member.activated', { memberId: id, userId: m.userId, roleId: updated.roleId });
  if (patch.roleId && patch.roleId !== m.roleId) await notify(m.userId, 'Your role was changed', undefined, '/app');
  await audit({ action: patch.roleId && patch.roleId !== m.roleId ? 'member.role_change' : 'member.update', entity: 'tenant_member', entityId: id, before: { roleId: m.roleId, status: m.status, branchIds: m.branchIds }, after: patch });
  return updated;
}

// ── Accepting an invitation (public, platform context) ──

export async function invitationPreview(token: string) {
  return withPlatform(async () => {
    const inv = await db().invitation.findUnique({ where: { tokenHash: sha256(token) } });
    if (!inv || inv.revokedAt || inv.acceptedAt || inv.expiresAt < new Date()) throw new AppError('NOT_FOUND', 'This invitation is no longer valid.');
    const [tenant, role] = await Promise.all([
      db().tenant.findUniqueOrThrow({ where: { id: inv.tenantId }, select: { name: true, logoUrl: true } }),
      db().role.findUniqueOrThrow({ where: { id: inv.roleId }, select: { name: true } }),
    ]);
    const existing = await db().user.findFirst({ where: { OR: [...(inv.email ? [{ email: inv.email }] : []), ...(inv.mobile ? [{ mobile: inv.mobile }] : [])] }, select: { id: true } });
    return { tenantName: tenant.name, logoUrl: tenant.logoUrl, roleName: role.name, name: inv.name, email: inv.email, mobile: inv.mobile, hasAccount: !!existing };
  });
}

export const AcceptInput = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  email: z.string().trim().email().transform(normaliseEmail).optional(),
  mobile: z.string().trim().transform(normaliseMobile).optional(),
  otp: z.string().regex(/^\d{6}$/).optional(),
  password: z.string().min(8).max(128),
});

/** New users verify their mobile with an `invite` OTP and set a password; existing users confirm with their password. */
export async function acceptInvitation(token: string, input: z.infer<typeof AcceptInput>) {
  return withPlatform(async () => {
    const tx = db();
    const inv = await tx.invitation.findUnique({ where: { tokenHash: sha256(token) } });
    if (!inv || inv.revokedAt || inv.acceptedAt || inv.expiresAt < new Date()) throw new AppError('NOT_FOUND', 'This invitation is no longer valid.');

    let user = await tx.user.findFirst({ where: { OR: [...(inv.email ? [{ email: inv.email }] : []), ...(inv.mobile ? [{ mobile: inv.mobile }] : [])] } });
    if (user) {
      if (!user.passwordHash || !(await verifyPassword(user.passwordHash, input.password))) throw new AppError('INVALID_CREDENTIALS', 'Incorrect password for your existing account.');
    } else {
      const email = inv.email ?? input.email;
      const mobile = inv.mobile ?? input.mobile;
      if (!email || !mobile || !input.name) throw new AppError('VALIDATION_FAILED', 'Name, email and mobile are required.', { fields: { name: 'Required' } });
      if (!input.otp) throw new AppError('VALIDATION_FAILED', 'Verify your mobile number.', { fields: { otp: 'Required' } });
      await consumeOtp(mobile, 'invite', input.otp);
      if (await tx.user.findFirst({ where: { OR: [{ email }, { mobile }] } })) throw new AppError('EMAIL_TAKEN', 'An account with this email or mobile already exists. Sign in to accept.');
      user = await tx.user.create({
        data: { name: input.name, email, mobile, passwordHash: await hashPassword(input.password), mobileVerifiedAt: new Date(), emailVerifiedAt: inv.email ? new Date() : null },
      });
    }

    const member = await tx.tenantMember.upsert({
      where: { tenantId_userId: { tenantId: inv.tenantId, userId: user.id } },
      create: { tenantId: inv.tenantId, userId: user.id, roleId: inv.roleId, branchIds: inv.branchIds, status: 'active', joinedAt: new Date() },
      update: { roleId: inv.roleId, branchIds: inv.branchIds, status: 'active', joinedAt: new Date(), deactivatedAt: null, version: { increment: 1 } },
    });
    await tx.invitation.update({ where: { id: inv.id }, data: { acceptedAt: new Date() } });
    // Invited from an employee's page: their record now has this login (if no one took it meanwhile)
    if (inv.employeeId) await tx.employee.updateMany({ where: { id: inv.employeeId, tenantId: inv.tenantId, memberId: null }, data: { memberId: member.id } });
    await tx.user.update({ where: { id: user.id }, data: { lastTenantId: inv.tenantId } });
    cache.del(`member:${inv.tenantId}:${user.id}`);
    await publish('member.activated', { memberId: member.id, userId: user.id, roleId: inv.roleId }, { tenantId: inv.tenantId });
    await audit({ tenantId: inv.tenantId, actorId: user.id, action: 'member.joined', entity: 'tenant_member', entityId: member.id });
    return { userId: user.id };
  });
}
