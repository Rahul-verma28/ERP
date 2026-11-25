import type { EntitlementStatus, TenantStatus } from '@prisma/client';
import { cache } from '../../kernel/cache';
import { MODULE_KEYS, type ModuleKey, type ModuleTier } from '../../contracts/modules';
import type { PlanLimits } from '../../contracts/plans';
import { heldLicence, licenceLapsed, moduleRows } from './service';

// What a business may use right now, read only from the signed licence it holds. The ERP never
// works out plans, prices or trials itself: the Console decides and signs; this side reads.

export interface ModuleEntitlement {
  status: EntitlementStatus;
  tier: ModuleTier;
}

export interface EntitlementSnapshot {
  tenantId: string;
  status: TenantStatus;
  planKey: string;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
  limits: PlanLimits;
  modules: Record<ModuleKey, ModuleEntitlement>;
}

/** Cached snapshot used by middleware and /me */
export function getEntitlements(tenantId: string): Promise<EntitlementSnapshot> {
  return cache.getOrSet(`ent:tenant:${tenantId}`, async () => {
    const held = await heldLicence(tenantId);
    if (!held) throw new Error(`Business ${tenantId} has no licence`);
    const l = held.licence;
    const modules = await moduleRows(tenantId);
    // Ran out and past the grace days: everything still opens, but only to read
    if (licenceLapsed(held.expiresAt)) for (const k of MODULE_KEYS) if (modules[k].status === 'active') modules[k] = { status: 'read_only', tier: modules[k].tier };
    return {
      tenantId,
      status: l.status as TenantStatus,
      planKey: l.plan.key,
      trialEndsAt: l.trialEndsAt ? new Date(l.trialEndsAt) : null,
      currentPeriodEnd: l.periodEnd ? new Date(l.periodEnd) : null,
      limits: l.limits,
      modules,
    };
  });
}

/** Module keys active at full tier — used for module-role visibility (Roles doc). */
export const fullModules = (snap: EntitlementSnapshot) =>
  MODULE_KEYS.filter((k) => snap.modules[k].status === 'active' && snap.modules[k].tier === 'full');
