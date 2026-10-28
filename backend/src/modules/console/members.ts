import { db } from '../../kernel/db';
import { AppError, notFound } from '../../kernel/errors';
import type { ConsoleCtx } from '../../kernel/context';
import { normaliseEmail, normaliseMobile } from '../../kernel/crypto';
import { audit } from '../audit/service';
import { invalidatePlatformMember, teamOf } from './service';

// Console → Team (design v2 §2). Runs inside consoleTx. Rules:
// only a Super Admin grants or changes Super Admin; nobody changes their own role or status;
// the last active Super Admin stays; the reporting tree never loops. Partner people only ever
// see and manage their own partner's team, with partner roles.

const layerOf = (ctx: ConsoleCtx) => (ctx.partnerId ? 'partner' : 'platform') as 'partner' | 'platform';

export async function consoleRoles(ctx: ConsoleCtx) {
  const roles = await db().role.findMany({
    where: { tenantId: null, layer: layerOf(ctx) },
    orderBy: { sort: 'asc' },
    include: { permissions: true, _count: { select: { platformMembers: { where: { status: 'active' } } } } },
  });
  return roles.map((r) => ({
    id: r.id, key: r.key, name: r.name, description: r.description, members: r._count.platformMembers,
    permissions: Object.fromEntries(r.permissions.map((p) => [p.permissionKey, p.scope])),
  }));
}

async function treeEdges() {
  return db().platformMember.findMany({ where: { status: 'active' }, select: { userId: true, reportsTo: true } });
}

export async function listMembers(ctx: ConsoleCtx) {
  const tx = db();
  const visible = ctx.scope === 'all' ? undefined : teamOf(ctx.userId, await treeEdges());
  const rows = await tx.platformMember.findMany({
    // AHEAD's team list leaves partner people out (they show under Partners)
    where: { partnerId: ctx.partnerId ?? null, ...(visible ? { userId: { in: visible } } : {}) },
    include: { user: { select: { id: true, name: true, email: true, mobile: true, lastLoginAt: true } }, role: { select: { key: true, name: true } } },
    orderBy: { joinedAt: 'asc' },
  });
  const managers = new Map(rows.map((r) => [r.userId, r.user.name]));
  return rows.map((r) => ({
    id: r.id, status: r.status, joinedAt: r.joinedAt, user: r.user, role: r.role,
    reportsTo: r.reportsTo ? { userId: r.reportsTo, name: managers.get(r.reportsTo) ?? null } : null,
  }));
}

async function actorRoleKey(ctx: ConsoleCtx) {
  return (await db().role.findUniqueOrThrow({ where: { id: ctx.roleId }, select: { key: true } })).key;
}

async function consoleRole(key: string, layer: 'platform' | 'partner') {
  const role = await db().role.findFirst({ where: { tenantId: null, layer, key } });
  if (!role) throw new AppError('VALIDATION_FAILED', 'Unknown Console role.', { fields: { roleKey: 'Unknown role' } });
  return role;
}

async function checkManager(reportsTo: string | null | undefined, memberUserId?: string) {
  if (!reportsTo) return null;
  const manager = await db().platformMember.findUnique({ where: { userId: reportsTo } });
  if (!manager || manager.status !== 'active') throw new AppError('VALIDATION_FAILED', 'The manager must be an active Console user.', { fields: { reportsTo: 'Not an active Console user' } });
  if (memberUserId && teamOf(memberUserId, await treeEdges()).includes(reportsTo)) {
    throw new AppError('VALIDATION_FAILED', 'Someone cannot report to a person in their own team.', { fields: { reportsTo: 'Would create a loop' } });
  }
  return reportsTo;
}

export interface NewMember {
  email: string;
  name?: string;
  mobile?: string;
  roleKey: string;
  reportsTo?: string | null;
}

/** `partnerId`: AHEAD adding a partner's first admin; partner admins always add to their own partner. */
export async function addMember(ctx: ConsoleCtx, input: NewMember, opts: { partnerId?: string } = {}) {
  const tx = db();
  const partnerId = ctx.partnerId ?? opts.partnerId ?? null;
  const role = await consoleRole(input.roleKey, partnerId ? 'partner' : 'platform');
  if (role.key === 'super_admin' && (await actorRoleKey(ctx)) !== 'super_admin') throw new AppError('PERMISSION_DENIED', 'Only a Super Admin can add another Super Admin.');
  const reportsTo = partnerId ? null : await checkManager(input.reportsTo);

  const email = normaliseEmail(input.email);
  let user = await tx.user.findUnique({ where: { email } });
  if (!user) {
    if (!input.name || !input.mobile) throw new AppError('VALIDATION_FAILED', 'No account with this email. Add a name and mobile to create one.', { fields: { name: input.name ? '' : 'Required for a new user', mobile: input.mobile ? '' : 'Required for a new user' } });
    const mobile = normaliseMobile(input.mobile);
    if (await tx.user.findUnique({ where: { mobile } })) throw new AppError('MOBILE_TAKEN', 'This mobile number already belongs to another account.', { fields: { mobile: 'Already in use' } });
    user = await tx.user.create({ data: { name: input.name.trim(), email, mobile, passwordHash: null } });
  }
  const existing = await tx.platformMember.findUnique({ where: { userId: user.id } });
  if (existing?.status === 'active') throw new AppError('CONFLICT', 'This person is already in the Console.', { fields: { email: 'Already a Console user' } });

  const data = { roleId: role.id, reportsTo, partnerId, status: 'active' as const, deactivatedAt: null, createdBy: ctx.userId };
  const member = existing
    ? await tx.platformMember.update({ where: { id: existing.id }, data })
    : await tx.platformMember.create({ data: { userId: user.id, ...data } });
  await audit({ tenantId: null, action: 'console.member_added', entity: 'platform_member', entityId: member.id, after: { email, role: role.key, reportsTo, partnerId } });
  invalidatePlatformMember(user.id);
  return { id: member.id, newUser: !existing && !user.passwordHash };
}

export async function updateMember(ctx: ConsoleCtx, id: string, patch: { roleKey?: string; reportsTo?: string | null; status?: 'active' | 'deactivated'; reason?: string }) {
  const tx = db();
  const member = await tx.platformMember.findUnique({ where: { id }, include: { role: { select: { key: true } } } });
  if (!member) throw notFound('Console user');
  if (ctx.partnerId && member.partnerId !== ctx.partnerId) throw notFound('Console user');
  if (ctx.scope !== 'all' && !teamOf(ctx.userId, await treeEdges()).includes(member.userId)) throw notFound('Console user');
  if (member.userId === ctx.userId && (patch.roleKey || patch.status)) throw new AppError('PERMISSION_DENIED', 'You cannot change your own role or status.');

  const actorIsSuper = (await actorRoleKey(ctx)) === 'super_admin';
  const newRole = patch.roleKey ? await consoleRole(patch.roleKey, member.partnerId ? 'partner' : 'platform') : null;
  if (!actorIsSuper && (member.role.key === 'super_admin' || newRole?.key === 'super_admin')) throw new AppError('PERMISSION_DENIED', 'Only a Super Admin can change a Super Admin.');

  const losesSuper = member.role.key === 'super_admin' && member.status === 'active' && ((newRole && newRole.key !== 'super_admin') || patch.status === 'deactivated');
  if (losesSuper) {
    const supers = await tx.platformMember.count({ where: { status: 'active', role: { key: 'super_admin', tenantId: null } } });
    if (supers <= 1) throw new AppError('CONFLICT', 'Keep at least one active Super Admin.');
  }
  const reportsTo = patch.reportsTo !== undefined ? await checkManager(patch.reportsTo, member.userId) : undefined;

  const updated = await tx.platformMember.update({
    where: { id },
    data: {
      roleId: newRole?.id,
      reportsTo,
      status: patch.status,
      deactivatedAt: patch.status === 'deactivated' ? new Date() : patch.status === 'active' ? null : undefined,
    },
  });
  if (patch.status === 'deactivated') {
    await tx.userSession.updateMany({ where: { userId: member.userId, workspace: 'console', revokedAt: null }, data: { revokedAt: new Date() } });
  }
  await audit({ tenantId: null, action: 'console.member_updated', entity: 'platform_member', entityId: id, before: { role: member.role.key, reportsTo: member.reportsTo, status: member.status }, after: patch });
  invalidatePlatformMember(member.userId);
  return updated;
}
