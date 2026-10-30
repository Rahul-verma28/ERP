import type { PermissionScope, RoleType } from '@prisma/client';
import { z } from 'zod';
import { randomInt } from 'node:crypto';
import { afterCommit, db } from '../../kernel/db';
import { cache } from '../../kernel/cache';
import { AppError, notFound } from '../../kernel/errors';
import type { ConsoleCtx } from '../../kernel/context';
import { audit } from '../audit/service';
import { PERMISSION_CATALOG } from '../../contracts/permissions';
import { ROLES, expandGrants } from '../../contracts/roles';
import { getSetting, setSetting } from '../settings/service';

// Console roles & permissions (blueprint Phase C, S5). One matrix per role: area × action ×
// which records. Admins edit built-in roles (except Admin itself, which always has everything)
// and make custom roles by copying one. Every change bumps the role version, so permission
// caches refresh within seconds, and is written to the audit trail.

/** Permissions that can hurt if given to the wrong person: marked in the matrix, audited as risky */
export const RISKY = new Set([
  'platform.member.create', 'platform.member.edit', 'platform.plan.edit', 'platform.setting.edit',
  'platform.discount.approve', 'platform.payment.approve', 'platform.audit.view', 'platform.partner.edit',
]);

/** Plain names and one-line help for the matrix rows */
const AREA_HELP: Record<string, string> = {
  dashboard: 'Overview page and its numbers',
  tenant: 'Add businesses, change plan, extend trials',
  plan: 'Plans, prices and coupons',
  setting: 'Console settings and company details',
  grace: 'Give extra days to pay or try',
  payment: 'Orders, payments, refunds and AHEAD invoices',
  discount: "Approve discounts above a person's limit",
  commission: 'Commission reports',
  member: 'Console users and their roles',
  audit: 'Audit trail, sign-ins and sessions',
  revenue: 'Money received and income figures',
  prospect: 'Leads and follow-ups',
  note: 'Internal notes on businesses',
  partner: 'Partners, their discount and bill',
};

export function permissionMatrix() {
  return PERMISSION_CATALOG.platform.map((r) => ({
    resource: r.resource,
    label: r.label,
    help: AREA_HELP[r.resource] ?? '',
    actions: r.actions.map((a) => ({ action: a, key: `platform.${r.resource}.${a}`, risky: RISKY.has(`platform.${r.resource}.${a}`) })),
  }));
}

const ALL_KEYS = new Set(PERMISSION_CATALOG.platform.flatMap((r) => r.actions.map((a) => `platform.${r.resource}.${a}`)));

async function assertAdmin(ctx: ConsoleCtx) {
  const role = await db().role.findUniqueOrThrow({ where: { id: ctx.roleId }, select: { key: true } });
  if (role.key !== 'super_admin' || ctx.partnerId) throw new AppError('PERMISSION_DENIED', 'Only an Admin changes roles.');
}

async function platformRole(id: string) {
  const role = await db().role.findFirst({ where: { id, tenantId: null, layer: 'platform' }, include: { permissions: true } });
  if (!role) throw notFound('Role');
  return role;
}

const grantsOf = (role: { permissions: { permissionKey: string; scope: PermissionScope }[] }) => Object.fromEntries(role.permissions.map((p) => [p.permissionKey, p.scope])) as Record<string, PermissionScope>;

export async function listConsoleRoles() {
  const roles = await db().role.findMany({
    where: { tenantId: null, layer: 'platform' },
    orderBy: [{ isPredefined: 'desc' }, { sort: 'asc' }, { name: 'asc' }],
    include: { _count: { select: { permissions: true, platformMembers: { where: { status: 'active' } } } } },
  });
  return roles.map((r) => ({
    id: r.id, key: r.key, name: r.name, description: r.description,
    builtIn: r.isPredefined, customized: !!r.customizedAt, locked: r.key === 'super_admin',
    permissions: r._count.permissions, members: r._count.platformMembers,
  }));
}

export async function roleDetail(id: string) {
  const role = await platformRole(id);
  const [members, limits] = await Promise.all([
    db().platformMember.findMany({ where: { roleId: id, status: 'active' }, select: { id: true, user: { select: { name: true, email: true } } }, orderBy: { joinedAt: 'asc' } }),
    getSetting('sales.discount_limits'),
  ]);
  return {
    id: role.id, key: role.key, name: role.name, description: role.description,
    builtIn: role.isPredefined, customized: !!role.customizedAt, locked: role.key === 'super_admin',
    copiedFrom: role.clonedFrom ? (await db().role.findUnique({ where: { id: role.clonedFrom }, select: { name: true } }))?.name ?? null : null,
    grants: grantsOf(role),
    discountLimitPercent: role.key === 'super_admin' ? 100 : (limits[role.key] ?? 0),
    members: members.map((m) => ({ id: m.id, name: m.user.name, email: m.user.email })),
    matrix: permissionMatrix(),
  };
}

const Scope = z.enum(['own', 'team', 'all']);

export const RoleCreate = z.object({
  fromRoleId: z.string().uuid(),
  name: z.string().trim().min(2, 'Use 2–40 characters').max(40),
  description: z.string().trim().max(200).optional(),
});

/** A custom role starts as a copy of another Console role. */
export async function createRole(ctx: ConsoleCtx, input: z.infer<typeof RoleCreate>) {
  await assertAdmin(ctx);
  const from = await platformRole(input.fromRoleId);
  if (from.key === 'super_admin') throw new AppError('VALIDATION_FAILED', 'Copy a role other than Admin; Admin always has everything.', { fields: { fromRoleId: 'Choose another role' } });
  if (await db().role.findFirst({ where: { tenantId: null, layer: 'platform', name: { equals: input.name, mode: 'insensitive' } } })) {
    throw new AppError('CONFLICT', 'A Console role with this name already exists.', { fields: { name: 'Already used' } });
  }
  const slug = input.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 24) || 'role';
  const role = await db().role.create({
    data: {
      key: `custom_${slug}_${randomInt(100, 1000)}`, name: input.name, description: input.description ?? from.description,
      layer: 'platform', roleType: from.roleType as RoleType, isPredefined: false, clonedFrom: from.id, sort: 100,
    },
  });
  if (from.permissions.length) await db().rolePermission.createMany({ data: from.permissions.map((p) => ({ roleId: role.id, permissionKey: p.permissionKey, scope: p.scope })) });
  // The copy starts with the same discount limit
  const limits = await getSetting('sales.discount_limits');
  if (limits[from.key] !== undefined) await setSetting('sales.discount_limits', { ...limits, [role.key]: limits[from.key] }, ctx.userId);
  await audit({ tenantId: null, action: 'console.role_created', entity: 'role', entityId: role.id, after: { name: role.name, copiedFrom: from.key } });
  return { id: role.id };
}

export const RoleUpdate = z.object({
  name: z.string().trim().min(2, 'Use 2–40 characters').max(40).optional(),
  description: z.string().trim().max(200).optional(),
  /** Every permission the role should have, with its scope; anything left out is removed */
  grants: z.record(z.string(), Scope).optional(),
  discountLimitPercent: z.number().min(0).max(100).optional(),
});

export async function updateRole(ctx: ConsoleCtx, id: string, input: z.infer<typeof RoleUpdate>) {
  await assertAdmin(ctx);
  const role = await platformRole(id);
  if (role.key === 'super_admin') throw new AppError('PERMISSION_DENIED', 'The Admin role always has everything and cannot be changed.');
  if ((input.name || input.description !== undefined) && role.isPredefined) throw new AppError('VALIDATION_FAILED', "Built-in roles keep their name. Copy the role to make one with your own name.", { fields: { name: 'Built-in name' } });
  const before = grantsOf(role);
  if (input.grants) {
    const unknown = Object.keys(input.grants).filter((k) => !ALL_KEYS.has(k));
    if (unknown.length) throw new AppError('VALIDATION_FAILED', 'Unknown permissions.', { fields: { grants: unknown.join(', ') } });
    await db().rolePermission.deleteMany({ where: { roleId: id } });
    const rows = Object.entries(input.grants).map(([permissionKey, scope]) => ({ roleId: id, permissionKey, scope: scope as PermissionScope }));
    if (rows.length) await db().rolePermission.createMany({ data: rows });
  }
  await db().role.update({
    where: { id },
    data: {
      name: input.name, description: input.description,
      version: { increment: 1 },
      customizedAt: input.grants && role.isPredefined ? new Date() : undefined,
    },
  });
  if (input.discountLimitPercent !== undefined) {
    const limits = await getSetting('sales.discount_limits');
    if (limits[role.key] !== input.discountLimitPercent) await setSetting('sales.discount_limits', { ...limits, [role.key]: input.discountLimitPercent }, ctx.userId);
  }
  cache.del(`role:${id}`);
  afterCommit(() => cache.del(`role:${id}`));
  const after = input.grants ?? before;
  const added = Object.keys(after).filter((k) => !before[k] || before[k] !== after[k]);
  await audit({
    tenantId: null, action: 'console.role_updated', entity: 'role', entityId: id,
    before: { name: role.name, grants: before },
    after: { name: input.name ?? role.name, grants: after, discountLimitPercent: input.discountLimitPercent, riskyGranted: added.filter((k) => RISKY.has(k)) },
  });
  // Settings are read through a cache of committed values: answer with the limit just saved
  const detail = await roleDetail(id);
  return input.discountLimitPercent === undefined ? detail : { ...detail, discountLimitPercent: input.discountLimitPercent };
}

/** Built-in roles: back to the permissions in code. */
export async function resetRole(ctx: ConsoleCtx, id: string) {
  await assertAdmin(ctx);
  const role = await platformRole(id);
  const def = ROLES.find((r) => r.key === role.key);
  if (!role.isPredefined || !def) throw new AppError('INVALID_TRANSITION', 'Only built-in roles have defaults to go back to.');
  const grants = expandGrants(def);
  await db().rolePermission.deleteMany({ where: { roleId: id } });
  await db().rolePermission.createMany({ data: [...grants].map(([permissionKey, scope]) => ({ roleId: id, permissionKey, scope })) });
  await db().role.update({ where: { id }, data: { customizedAt: null, version: { increment: 1 } } });
  cache.del(`role:${id}`);
  afterCommit(() => cache.del(`role:${id}`));
  await audit({ tenantId: null, action: 'console.role_reset', entity: 'role', entityId: id, before: { grants: grantsOf(role) } });
  return roleDetail(id);
}

export async function deleteRole(ctx: ConsoleCtx, id: string) {
  await assertAdmin(ctx);
  const role = await platformRole(id);
  if (role.isPredefined) throw new AppError('INVALID_TRANSITION', "Built-in roles can't be deleted.");
  const people = await db().platformMember.count({ where: { roleId: id } });
  if (people) throw new AppError('CONFLICT', `${people} ${people === 1 ? 'person has' : 'people have'} this role. Move them to another role first.`);
  await db().rolePermission.deleteMany({ where: { roleId: id } });
  await db().role.delete({ where: { id } });
  await audit({ tenantId: null, action: 'console.role_deleted', entity: 'role', entityId: id, before: { name: role.name, grants: grantsOf(role) } });
}
