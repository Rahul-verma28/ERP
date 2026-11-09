import type { PermissionScope } from '@prisma/client';
import { prisma, db } from '../../kernel/db';
import { cache } from '../../kernel/cache';
import { PERMISSIONS } from '../../contracts/permissions';
import { getEntitlements, fullModules } from '../subscription/entitlements';
import { consumer } from '../events/outbox';

// Cached lookups for the permission middleware (LLD §4.5). Reads use platform
// privileges with explicit ids; nothing here is reachable by user input alone.

export interface MemberSnapshot {
  id: string;
  roleId: string;
  branchIds: string[];
  status: 'invited' | 'active' | 'deactivated';
}

export function getMember(tenantId: string, userId: string): Promise<MemberSnapshot | null> {
  return cache.getOrSet(`member:${tenantId}:${userId}`, async () => {
    const m = await prisma.tenantMember.findUnique({
      where: { tenantId_userId: { tenantId, userId } },
      select: { id: true, roleId: true, branchIds: true, status: true },
    });
    return m;
  });
}

async function roleVersion(roleId: string) {
  return cache.getOrSet(`role:${roleId}`, async () => {
    const r = await prisma.role.findUniqueOrThrow({ where: { id: roleId }, select: { version: true, tenantId: true, key: true } });
    return r;
  });
}

export async function getRolePermissions(roleId: string): Promise<Map<string, PermissionScope>> {
  const { version } = await roleVersion(roleId);
  return cache.getOrSet(`perm:role:${roleId}:v${version}`, async () => {
    const rows = await prisma.rolePermission.findMany({ where: { roleId } });
    return new Map(rows.map((r) => [r.permissionKey, r.scope]));
  });
}

export async function getFieldAccess(roleId: string) {
  const { version } = await roleVersion(roleId);
  return cache.getOrSet(`fields:role:${roleId}:v${version}`, async () => {
    const rows = await prisma.roleFieldAccess.findMany({ where: { roleId } });
    return Object.fromEntries(rows.map((r) => [`${r.entity}.${r.field}`, r.access]));
  });
}

/** Permission keys for a role, filtered to what the tenant's entitlements allow right now. */
export async function effectivePermissions(tenantId: string, roleId: string) {
  const [perms, ent] = await Promise.all([getRolePermissions(roleId), getEntitlements(tenantId)]);
  const out: Record<string, PermissionScope> = {};
  for (const p of PERMISSIONS) {
    const scope = perms.get(p.key);
    if (!scope || p.moduleKey === 'platform') continue;
    if (p.moduleKey !== 'tenant') {
      const m = ent.modules[p.moduleKey];
      if (m.status === 'inactive') continue;
      if (p.tier === 'full' && m.tier !== 'full') continue;
      if (m.status === 'read_only' && !['view', 'export'].includes(p.action)) continue;
    }
    out[p.key] = scope;
  }
  return out;
}

/** LLD §4.4 — core roles + module roles whose required modules are all active (full tier). */
export async function visibleRoles(tenantId: string) {
  const ent = await getEntitlements(tenantId);
  const active = fullModules(ent);
  const hidden = await db().tenantRoleSetting.findMany({ where: { tenantId, hidden: true } });
  const hiddenIds = new Set(hidden.map((h) => h.roleId));
  const all = await db().role.findMany({
    where: { layer: 'tenant', OR: [{ tenantId: null }, { tenantId }] },
    orderBy: [{ sort: 'asc' }, { name: 'asc' }],
    include: { _count: { select: { members: true, permissions: true } } },
  });
  return all
    .filter((r) => r.requiredModules.every((m) => active.includes(m as never)) && !hiddenIds.has(r.id))
    .map((r) => ({
      id: r.id,
      key: r.key,
      name: r.name,
      description: r.description,
      roleType: r.roleType,
      requiredModules: r.requiredModules,
      isSystem: r.isSystem,
      isPredefined: r.isPredefined,
      memberCount: r._count.members,
      permissionCount: r._count.permissions,
    }));
}

export async function roleDetail(roleId: string) {
  const role = await db().role.findUnique({ where: { id: roleId }, include: { permissions: true, fieldAccess: true } });
  return role;
}

// Cache invalidation on events (LLD §4.5)
consumer('access.cache.member', 'member.activated', async (evt) => {
  cache.delPrefix(`member:${evt.tenantId}:`);
});
consumer('access.cache.member-off', 'member.deactivated', async (evt) => {
  cache.delPrefix(`member:${evt.tenantId}:`);
});
consumer('access.cache.ent', 'subscription.changed', async (evt) => {
  cache.del(`ent:tenant:${evt.tenantId}`);
});
consumer('access.cache.role', 'role.updated', async (evt) => {
  cache.del(`role:${String(evt.payload.roleId)}`);
});
