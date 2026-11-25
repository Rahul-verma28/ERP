import { prisma } from '../../kernel/db';
import { cache } from '../../kernel/cache';
import { passwordRulesFor, securityWithDefaults, type SecurityPolicy } from '../../contracts/account';

// Workspace security policy (Settings › Users & security) and what it means for one person
// across every business they belong to. Reads use the owner client with explicit ids.

const DAY = 86_400_000;

const readSecurity = (prefs: unknown) => securityWithDefaults((prefs as { security?: unknown } | null)?.security);

export function tenantSecurity(tenantId: string): Promise<SecurityPolicy> {
  return cache.getOrSet(`sec:tenant:${tenantId}`, async () => {
    const t = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { preferences: true } });
    return readSecurity(t?.preferences);
  });
}

export const forgetTenantSecurity = (tenantId: string) => {
  cache.del(`sec:tenant:${tenantId}`);
  cache.delPrefix('mfa:user:');
};

/** Does this business's policy cover a person with this role? */
export function policyCovers(p: SecurityPolicy['mfa'], role: { id: string; key: string }) {
  if (p.policy === 'everyone') return true;
  if (p.policy === 'admins') return role.key === 'owner' || role.key === 'admin';
  if (p.policy === 'roles') return p.roleIds.includes(role.id);
  return false;
}

export interface MfaRequirement {
  /** Businesses that require two-step for this person */
  requiredBy: { tenantId: string; name: string; deadline: string | null }[];
  mfaEnabled: boolean;
  /** Earliest end of a grace period still running */
  deadline: string | null;
  /** Grace is over somewhere: nothing else opens until two-step is set up */
  mustSetUp: boolean;
  /** Tenants where access is blocked right now (grace over, not set up) */
  blockedTenantIds: string[];
}

async function loadMemberships(userId: string) {
  return prisma.tenantMember.findMany({
    where: { userId, status: 'active', tenant: { status: { notIn: ['purged'] } } },
    select: { tenantId: true, role: { select: { id: true, key: true } }, tenant: { select: { name: true, preferences: true } } },
  });
}

export function mfaRequirement(userId: string): Promise<MfaRequirement> {
  return cache.getOrSet(
    `mfa:user:${userId}`,
    async () => {
      const [user, memberships] = await Promise.all([
        prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { mfaEnabled: true } }),
        loadMemberships(userId),
      ]);
      const now = Date.now();
      const requiredBy: MfaRequirement['requiredBy'] = [];
      const blockedTenantIds: string[] = [];
      for (const m of memberships) {
        const p = readSecurity(m.tenant.preferences).mfa;
        if (!policyCovers(p, m.role)) continue;
        const since = p.since ? new Date(p.since).getTime() : now;
        const deadline = new Date(since + p.graceDays * DAY);
        requiredBy.push({ tenantId: m.tenantId, name: m.tenant.name, deadline: deadline.toISOString() });
        if (!user.mfaEnabled && deadline.getTime() < now) blockedTenantIds.push(m.tenantId);
      }
      const running = user.mfaEnabled ? [] : requiredBy.map((r) => r.deadline!).filter((d) => new Date(d).getTime() >= now).sort();
      return {
        requiredBy,
        mfaEnabled: user.mfaEnabled,
        deadline: running[0] ?? null,
        mustSetUp: blockedTenantIds.length > 0,
        blockedTenantIds,
      };
    },
    60_000,
  );
}

export const forgetMfa = (userId: string) => cache.del(`mfa:user:${userId}`);

/** The password rules for this person, and the strictest session rules across their businesses. */
export async function personalPolicy(userId: string) {
  const memberships = await loadMemberships(userId);
  const policies = memberships.map((m) => ({ name: m.tenant.name, p: readSecurity(m.tenant.preferences) }));
  const rules = passwordRulesFor(policies.map((x) => ({ name: x.name, password: x.p.password })));
  return {
    password: rules.password,
    passwordSetBy: rules.setBy,
    passwordSetWhere: rules.where,
    idleMinutes: Math.min(...policies.map((x) => x.p.sessions.idleMinutes), 10080),
    maxDays: Math.min(...policies.map((x) => x.p.sessions.maxDays), 30),
  };
}
