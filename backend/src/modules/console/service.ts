import type { PermissionScope, Prisma } from '@prisma/client';
import { prisma } from '../../kernel/db';
import { cache } from '../../kernel/cache';
import type { ConsoleCtx } from '../../kernel/context';
import { PERMISSIONS } from '../../contracts/permissions';
import { getRolePermissions } from '../access/service';

// R3-lite: the AHEAD team's Console. Lookups read with platform privileges and a short cache
// (60 s) so a deactivated Console user loses access quickly.

const TTL_MS = 60_000;

export interface PlatformMemberSnapshot {
  id: string;
  userId: string;
  roleId: string;
  reportsTo: string | null;
  status: 'invited' | 'active' | 'deactivated';
  partnerId: string | null;
}

export function getPlatformMember(userId: string): Promise<PlatformMemberSnapshot | null> {
  return cache.getOrSet(`pmember:${userId}`, () =>
    prisma.platformMember.findUnique({ where: { userId }, select: { id: true, userId: true, roleId: true, reportsTo: true, status: true, partnerId: true } }),
  TTL_MS);
}

export const invalidatePlatformMember = (userId: string) => {
  cache.del(`pmember:${userId}`);
  cache.del('pmember:tree');
};

/** Pure: the user and everyone below them in the reporting tree. */
export function teamOf(userId: string, edges: { userId: string; reportsTo: string | null }[]) {
  const team = new Set([userId]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const e of edges) {
      if (e.reportsTo && team.has(e.reportsTo) && !team.has(e.userId)) {
        team.add(e.userId);
        grew = true;
      }
    }
  }
  return [...team];
}

async function reportingTree() {
  return cache.getOrSet('pmember:tree', () =>
    prisma.platformMember.findMany({ where: { status: 'active' }, select: { userId: true, reportsTo: true } }),
  TTL_MS);
}

/** Pure: the Prisma filter on tenants for a Console scope (all / team / own). */
export function tenantScopeFilter(scope: PermissionScope, userIds: string[]): Prisma.TenantWhereInput {
  if (scope === 'all') return {};
  return { acquisition: { acquiredByUserId: { in: userIds } } };
}

/** Which clients this Console user may see for the permission checked on the request. */
export async function scopedTenantFilter(ctx: ConsoleCtx): Promise<Prisma.TenantWhereInput> {
  // Partner people never see beyond their partner's clients, whatever their scope
  const partner: Prisma.TenantWhereInput = ctx.partnerId ? { partnerId: ctx.partnerId } : {};
  const scope = ctx.scope ?? 'own';
  if (scope === 'all') return partner;
  const ids = scope === 'team' ? teamOf(ctx.userId, await reportingTree()) : [ctx.userId];
  return { ...partner, ...tenantScopeFilter(scope, ids) };
}

/** Console permission keys for a role, as { key: scope }. */
export async function consolePermissions(roleId: string) {
  const perms = await getRolePermissions(roleId);
  const out: Record<string, PermissionScope> = {};
  for (const p of PERMISSIONS) {
    const scope = perms.get(p.key);
    if (scope && p.moduleKey === 'platform') out[p.key] = scope;
  }
  return out;
}

/** What /me reports about the Console for this user (null when they are not on the AHEAD team). */
export async function consoleAccess(userId: string) {
  const member = await getPlatformMember(userId);
  if (!member || member.status !== 'active') return null;
  const [role, permissions, partner] = await Promise.all([
    prisma.role.findUniqueOrThrow({ where: { id: member.roleId }, select: { key: true, name: true } }),
    consolePermissions(member.roleId),
    member.partnerId ? prisma.partner.findUnique({ where: { id: member.partnerId }, select: { id: true, name: true, status: true, discountBp: true } }) : null,
  ]);
  // Which Console panel this person sees: the AHEAD team's, a vendor's or a partner's
  const audience = partner ? 'partner' : role.key === 'vendor' ? 'vendor' : 'team';
  return { memberId: member.id, role, permissions, audience, partner: partner && { id: partner.id, name: partner.name, status: partner.status, discountPercent: partner.discountBp / 100 } };
}
