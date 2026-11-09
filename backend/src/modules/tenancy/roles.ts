import type { FieldAccess, PermissionScope } from '@prisma/client';
import { z } from 'zod';
import { db } from '../../kernel/db';
import { cache } from '../../kernel/cache';
import { AppError, notFound } from '../../kernel/errors';
import { zReason } from '../../kernel/zodRules';
import { randomToken } from '../../kernel/crypto';
import { PERMISSIONS, PERMISSION_BY_KEY } from '../../contracts/permissions';
import { SENSITIVE_FIELDS, rolePermissionProblem } from '../../contracts/account';
import { audit } from '../audit/service';
import { publish } from '../events/outbox';
import { notify } from '../notifications/service';
import { getEntitlements } from '../subscription/entitlements';
import { visibleRoles } from '../access/service';
import type { TenantCtx } from '../../kernel/context';

// Settings › Roles & permissions. Predefined roles are read-only; a business clones one to
// customise it (custom roles need a paid plan or the trial).

const TENANT_KEYS = PERMISSIONS.filter((p) => p.moduleKey !== 'platform').map((p) => p.key);
/** Only the Owner can close the business; no custom role gets it. */
const OWNER_ONLY = new Set(['tenant.account.delete']);

async function assertCustomRolesAllowed(tenantId: string) {
  const ent = await getEntitlements(tenantId);
  if (!['trialing', 'active', 'past_due'].includes(ent.status)) {
    throw new AppError('MODULE_NOT_ENTITLED', 'Custom roles need a paid plan. Upgrade to clone and edit roles.', { feature: 'custom_roles' });
  }
}

async function customRole(roleId: string, tenantId: string) {
  const role = await db().role.findUnique({ where: { id: roleId }, include: { _count: { select: { members: true } } } });
  if (!role || role.layer !== 'tenant') throw notFound('Role');
  if (role.tenantId !== tenantId) throw new AppError('PERMISSION_DENIED', "Predefined roles can't be edited — clone one to customise it.");
  return role;
}

export async function roleDetail(tenantId: string, roleId: string) {
  const visible = await visibleRoles(tenantId);
  const summary = visible.find((r) => r.id === roleId);
  if (!summary) throw notFound('Role');
  const role = await db().role.findUniqueOrThrow({ where: { id: roleId }, include: { permissions: true, fieldAccess: true } });
  const [members, source] = await Promise.all([
    db().tenantMember.findMany({ where: { roleId, status: { not: 'deactivated' } }, select: { id: true, status: true, user: { select: { id: true, name: true, email: true } } } }),
    role.clonedFrom ? db().role.findUnique({ where: { id: role.clonedFrom }, select: { name: true } }) : null,
  ]);
  return {
    ...summary,
    isCustom: role.tenantId === tenantId,
    version: role.version,
    clonedFromName: source?.name ?? null,
    permissions: Object.fromEntries(role.permissions.map((p) => [p.permissionKey, p.scope])),
    fieldAccess: Object.fromEntries(role.fieldAccess.map((f) => [`${f.entity}.${f.field}`, f.access])),
    members: members.map((m) => ({ memberId: m.id, userId: m.user.id, name: m.user.name, email: m.user.email, status: m.status })),
  };
}

const SCOPES = ['own', 'team', 'branch', 'all'] as const;

export const CloneInput = z.object({
  fromRoleId: z.string().uuid().nullish(),
  name: z.string().trim().min(2, 'Use 2–40 characters').max(40, 'Use 2–40 characters'),
  description: z.string().trim().max(200).nullish(),
  /** Given by the Create Role form; when left out, a clone keeps its source's permissions */
  permissions: z.record(z.enum(SCOPES)).optional(),
  fieldAccess: z.record(z.enum(['hidden', 'read', 'write'])).optional(),
});

function assertPermissions(keys: string[]) {
  const unknown = keys.find((k) => !PERMISSION_BY_KEY.has(k) || PERMISSION_BY_KEY.get(k)!.moduleKey === 'platform');
  if (unknown) throw new AppError('VALIDATION_FAILED', `Unknown permission ${unknown}.`, { fields: { permissions: `Unknown permission ${unknown}` } });
  if (keys.some((k) => OWNER_ONLY.has(k))) throw new AppError('VALIDATION_FAILED', 'Only the Owner can close the business.', { fields: { permissions: 'Only the Owner can close the business' } });
  const problem = rolePermissionProblem(keys, TENANT_KEYS);
  if (problem) throw new AppError('VALIDATION_FAILED', problem, { fields: { permissions: problem } });
}

function assertFields(access: Record<string, unknown>) {
  const allowed = new Set(SENSITIVE_FIELDS.map((f) => `${f.entity}.${f.field}`));
  const unknown = Object.keys(access).find((k) => !allowed.has(k));
  if (unknown) throw new AppError('VALIDATION_FAILED', `Unknown field ${unknown}.`, { fields: { fieldAccess: `Unknown field ${unknown}` } });
}

export async function createRole(ctx: TenantCtx, input: z.infer<typeof CloneInput>) {
  await assertCustomRolesAllowed(ctx.tenantId);
  const visible = await visibleRoles(ctx.tenantId);
  if (visible.some((r) => r.name.toLowerCase() === input.name.toLowerCase())) {
    throw new AppError('VALIDATION_FAILED', 'A role with this name already exists.', { fields: { name: 'A role with this name already exists' } });
  }
  const source = input.fromRoleId ? await db().role.findUnique({ where: { id: input.fromRoleId }, include: { permissions: true, fieldAccess: true } }) : null;
  if (input.fromRoleId && (!source || !visible.some((r) => r.id === source.id))) throw notFound('Role');
  if (source?.key === 'owner') throw new AppError('VALIDATION_FAILED', "The Owner role can't be cloned.", { fields: { fromRoleId: "The Owner role can't be cloned" } });
  if (input.permissions) assertPermissions(Object.keys(input.permissions));
  if (input.fieldAccess) assertFields(input.fieldAccess);

  const role = await db().role.create({
    data: {
      tenantId: ctx.tenantId,
      key: `custom_${randomToken(6).toLowerCase().replace(/[^a-z0-9]/g, 'x')}`,
      name: input.name,
      description: input.description ?? (source ? `Based on ${source.name}` : null),
      layer: 'tenant',
      roleType: source?.roleType === 'admin' ? 'user' : (source?.roleType ?? 'user'),
      requiredModules: source?.requiredModules ?? [],
      clonedFrom: source?.id ?? null,
      sort: 900,
    },
  });
  const perms = input.permissions
    ? Object.entries(input.permissions).map(([permissionKey, scope]) => ({ permissionKey, scope: scope as PermissionScope }))
    : (source?.permissions ?? []).filter((p) => !OWNER_ONLY.has(p.permissionKey));
  if (perms.length) await db().rolePermission.createMany({ data: perms.map((p) => ({ roleId: role.id, tenantId: ctx.tenantId, permissionKey: p.permissionKey, scope: p.scope })) });
  const fields = input.fieldAccess
    ? Object.entries(input.fieldAccess).map(([k, access]) => ({ entity: k.split('.')[0], field: k.split('.')[1], access: access as FieldAccess }))
    : (source?.fieldAccess ?? []);
  if (fields.length) {
    await db().roleFieldAccess.createMany({ data: fields.map((f) => ({ roleId: role.id, tenantId: ctx.tenantId, entity: f.entity, field: f.field, access: f.access })) });
  }
  await audit({ action: 'role.create', entity: 'role', entityId: role.id, after: { name: role.name, clonedFrom: source?.name ?? null } });
  return roleDetail(ctx.tenantId, role.id);
}

export const RolePatch = z.object({
  version: z.number().int(),
  name: z.string().trim().min(2, 'Use 2–40 characters').max(40, 'Use 2–40 characters').optional(),
  description: z.string().trim().max(200).nullish(),
  permissions: z.record(z.enum(SCOPES)).optional(),
  fieldAccess: z.record(z.enum(['hidden', 'read', 'write'])).optional(),
  reason: zReason.optional(),
});

export async function updateRole(ctx: TenantCtx, roleId: string, input: z.infer<typeof RolePatch>) {
  await assertCustomRolesAllowed(ctx.tenantId);
  const role = await customRole(roleId, ctx.tenantId);
  if (role.version !== input.version) throw new AppError('VERSION_CONFLICT', 'Someone else changed this role. Reload to see their changes.');
  const people = role._count.members;
  if (people > 0 && !input.reason) throw new AppError('VALIDATION_FAILED', `This affects ${people} ${people === 1 ? 'person' : 'people'} — add a reason.`, { fields: { reason: 'Add a reason (10–500 characters)' } });

  const before = await roleDetail(ctx.tenantId, roleId);
  if (input.name && input.name.toLowerCase() !== role.name.toLowerCase()) {
    const visible = await visibleRoles(ctx.tenantId);
    if (visible.some((r) => r.id !== roleId && r.name.toLowerCase() === input.name!.toLowerCase())) {
      throw new AppError('VALIDATION_FAILED', 'A role with this name already exists.', { fields: { name: 'A role with this name already exists' } });
    }
  }

  if (input.permissions) {
    const keys = Object.keys(input.permissions);
    assertPermissions(keys);
    await db().rolePermission.deleteMany({ where: { roleId } });
    if (keys.length) {
      await db().rolePermission.createMany({ data: keys.map((k) => ({ roleId, tenantId: ctx.tenantId, permissionKey: k, scope: input.permissions![k] as PermissionScope })) });
    }
  }
  if (input.fieldAccess) {
    assertFields(input.fieldAccess);
    for (const [k, access] of Object.entries(input.fieldAccess)) {
      const [entity, field] = k.split('.');
      await db().roleFieldAccess.upsert({
        where: { roleId_entity_field: { roleId, entity, field } },
        create: { roleId, tenantId: ctx.tenantId, entity, field, access: access as FieldAccess },
        update: { access: access as FieldAccess },
      });
    }
  }
  await db().role.update({
    where: { id: roleId },
    data: { name: input.name, description: input.description === undefined ? undefined : input.description, version: { increment: 1 } },
  });
  // Applies from each person's next request
  cache.del(`role:${roleId}`);
  await publish('role.updated', { roleId });
  const after = await roleDetail(ctx.tenantId, roleId);
  await audit({
    action: 'role.update', entity: 'role', entityId: roleId,
    before: { name: before.name, permissions: before.permissions, fieldAccess: before.fieldAccess },
    after: { name: after.name, permissions: after.permissions, fieldAccess: after.fieldAccess, reason: input.reason, affects: people },
  });
  for (const m of after.members) if (m.userId !== ctx.userId) await notify(m.userId, `Your role "${after.name}" was updated`, input.reason, '/app');
  return after;
}

export async function deleteRole(ctx: TenantCtx, roleId: string) {
  const role = await customRole(roleId, ctx.tenantId);
  if (role._count.members > 0) {
    throw new AppError('CONFLICT', `${role.name} is assigned to ${role._count.members} ${role._count.members === 1 ? 'person' : 'people'}. Give them another role first.`);
  }
  const invites = await db().invitation.count({ where: { roleId, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } } });
  if (invites) throw new AppError('CONFLICT', `${role.name} is used by ${invites} pending invitation${invites === 1 ? '' : 's'}. Revoke them first.`);
  await db().role.delete({ where: { id: roleId } });
  cache.del(`role:${roleId}`);
  await audit({ action: 'role.delete', entity: 'role', entityId: roleId, before: { name: role.name } });
}
