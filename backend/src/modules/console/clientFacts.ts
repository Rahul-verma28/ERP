import { prisma } from '../../kernel/db';
import { readSetup } from '../tenancy/workspace';

// Console v3: two facts every client row and client page shows — who onboarded the client
// (worked out from who added it or whose code it used, never chosen by hand) and how far the
// owner has got: login link sent → logged in → setup done → paid.

export type OnboardedKind = 'website' | 'team' | 'sales' | 'vendor' | 'partner';
export interface OnboardedBy {
  kind: OnboardedKind;
  name: string | null;
}

/** Pure: the label for a client from its acquisition record and the acquirer's Console role. */
export function onboardedBy(a: { acquiredByType: string; acquirerName?: string | null; acquirerRole?: string | null; partnerName?: string | null } | null): OnboardedBy {
  if (!a || a.acquiredByType === 'self') return { kind: 'website', name: null };
  if (a.acquiredByType === 'partner_user' || a.partnerName) return { kind: 'partner', name: a.partnerName ?? a.acquirerName ?? null };
  if (a.acquiredByType === 'vendor' || a.acquirerRole === 'vendor') return { kind: 'vendor', name: a.acquirerName ?? null };
  if (a.acquirerRole === 'console_sales') return { kind: 'sales', name: a.acquirerName ?? null };
  return { kind: 'team', name: a.acquirerName ?? null };
}

export interface Progress {
  linkSentAt: Date | null;
  loggedIn: boolean;
  setupDone: boolean;
  paid: boolean;
  lastActiveAt: Date | null;
}

/** "Onboarded by" and the owner's progress for a page of clients. Platform reads only. */
export async function clientFacts(tenantIds: string[]) {
  const by = new Map<string, OnboardedBy>();
  const progress = new Map<string, Progress>();
  if (!tenantIds.length) return { by, progress };
  const [tenants, links, paidOrders, sessions] = await Promise.all([
    prisma.tenant.findMany({
      where: { id: { in: tenantIds } },
      select: { id: true, status: true, onboarding: true, ownerUserId: true, partner: { select: { name: true } }, acquisition: { select: { acquiredByType: true, acquiredByUserId: true } } },
    }),
    prisma.accessLink.findMany({ where: { tenantId: { in: tenantIds }, kind: 'client_owner' }, orderBy: { createdAt: 'desc' }, distinct: ['tenantId'], select: { tenantId: true, createdAt: true, usedAt: true } }),
    prisma.platformOrder.groupBy({ by: ['tenantId'], where: { tenantId: { in: tenantIds }, status: 'paid' }, _count: true }),
    prisma.userSession.groupBy({ by: ['tenantId'], where: { tenantId: { in: tenantIds } }, _max: { createdAt: true } }),
  ]);
  const acquirerIds = [...new Set(tenants.map((t) => t.acquisition?.acquiredByUserId).filter(Boolean) as string[])];
  const ownerIds = [...new Set(tenants.map((t) => t.ownerUserId))];
  const [acquirers, owners] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: acquirerIds } }, select: { id: true, name: true, platformMember: { select: { role: { select: { key: true } } } } } }),
    prisma.user.findMany({ where: { id: { in: ownerIds } }, select: { id: true, lastLoginAt: true } }),
  ]);
  const acquirer = new Map(acquirers.map((u) => [u.id, u]));
  const ownerLogin = new Map(owners.map((u) => [u.id, u.lastLoginAt]));
  const link = new Map(links.map((l) => [l.tenantId!, l]));
  const paid = new Set(paidOrders.map((o) => o.tenantId));
  const seen = new Map(sessions.map((s) => [s.tenantId!, s._max.createdAt]));

  for (const t of tenants) {
    const a = t.acquisition?.acquiredByUserId ? acquirer.get(t.acquisition.acquiredByUserId) : null;
    by.set(t.id, onboardedBy(t.acquisition && { acquiredByType: t.acquisition.acquiredByType, acquirerName: a?.name, acquirerRole: a?.platformMember?.role.key, partnerName: t.partner?.name }));
    const l = link.get(t.id);
    progress.set(t.id, {
      linkSentAt: l?.createdAt ?? null,
      // No login link means the owner set up their own login (website signup, or added before Console v3)
      loggedIn: !l || !!l.usedAt || !!ownerLogin.get(t.ownerUserId) || !!seen.get(t.id),
      setupDone: !!readSetup(t).completedAt,
      // Partner clients are billed to the partner; a paying status counts as paid
      paid: paid.has(t.id) || (!!t.partner && t.status === 'active'),
      lastActiveAt: seen.get(t.id) ?? null,
    });
  }
  return { by, progress };
}
