import { describe, expect, it } from 'vitest';
import { nextStatus } from '../modules/subscription/stateMachine';
import { resolveEntitlements, resolveLimits } from '../modules/subscription/entitlements';
import { trialEnd } from '../modules/tenancy/createTenant';
import { PLANS, TRIAL_LIMITS } from '../contracts/plans';
import { MODULES } from '../contracts/modules';
import { expandGrants, ROLES } from '../contracts/roles';

describe('subscription state machine (LLD §6.2)', () => {
  it('allows the documented transitions', () => {
    expect(nextStatus('trialing', 'trial_expired')).toBe('free');
    expect(nextStatus('trialing', 'payment_captured')).toBe('active');
    expect(nextStatus('active', 'renewal_failed')).toBe('past_due');
    expect(nextStatus('past_due', 'grace_expired')).toBe('free');
    expect(nextStatus('free', 'payment_captured')).toBe('active');
    expect(nextStatus('closed', 'owner_restored')).toBe('free');
  });

  it('rejects anything else with INVALID_TRANSITION', () => {
    expect(() => nextStatus('free', 'trial_expired')).toThrow(expect.objectContaining({ code: 'INVALID_TRANSITION' }));
    expect(() => nextStatus('purged', 'owner_restored')).toThrow(expect.objectContaining({ code: 'INVALID_TRANSITION' }));
  });
});

describe('entitlement resolver (LLD §6.3)', () => {
  const growth = new Set(PLANS.find((p) => p.key === 'professional')!.fullModules);
  const freeTier = new Set(MODULES.filter((m) => m.freeTier).map((m) => m.key));
  const free = PLANS.find((p) => p.key === 'free')!.limits;

  it('opens every module at full tier during the trial', () => {
    const e = resolveEntitlements('trialing', new Set(), new Set(), freeTier);
    expect(Object.values(e).every((m) => m.status === 'active' && m.tier === 'full')).toBe(true);
  });

  it('after the trial: free modules stay active (basic), used paid modules become read-only, unused ones inactive', () => {
    const e = resolveEntitlements('free', new Set(), new Set(['hr', 'inventory', 'crm']), freeTier);
    expect(e.crm).toEqual({ status: 'active', tier: 'basic' });
    expect(e.hr).toEqual({ status: 'read_only', tier: 'basic' });
    expect(e.inventory.status).toBe('read_only');
    expect(e.ai.status).toBe('inactive');
  });

  it('paid plans unlock their modules at full tier, past_due keeps access', () => {
    for (const status of ['active', 'past_due'] as const) {
      const e = resolveEntitlements(status, growth, new Set(), freeTier);
      expect(e.hr).toEqual({ status: 'active', tier: 'full' });
      expect(e.ai.status).toBe('inactive');
    }
  });

  it('uses trial limits while trialing and Free limits after', () => {
    const growthLimits = PLANS.find((p) => p.key === 'professional')!.limits;
    const defaults = { trial: TRIAL_LIMITS, free };
    expect(resolveLimits('trialing', growthLimits, defaults)).toEqual(TRIAL_LIMITS);
    expect(resolveLimits('free', growthLimits, defaults).users).toBe(2);
    expect(resolveLimits('active', growthLimits, defaults)).toEqual(growthLimits);
  });

  it('follows the free-tier flags it is given (editable in the database)', () => {
    const e = resolveEntitlements('free', new Set(), new Set(), new Set(['crm', 'tasks']));
    expect(e.crm.status).toBe('active');
    expect(e.billing.status).toBe('inactive');
  });
});

describe('trial end', () => {
  it('ends at 23:59:59 IST on the 15th day', () => {
    expect(trialEnd(new Date('2026-10-22T06:30:00Z'), 15).toISOString()).toBe('2026-11-06T18:29:59.000Z');
  });
});

describe('predefined roles', () => {
  const role = (key: string) => expandGrants(ROLES.find((r) => r.key === key)!);

  it('Admin cannot change the subscription or close the account', () => {
    const admin = role('admin');
    expect(admin.has('tenant.member.create')).toBe(true);
    expect(admin.has('tenant.billing.edit')).toBe(false);
    expect(admin.has('tenant.account.delete')).toBe(false);
  });

  it('Read-only Viewer has no write actions', () => {
    const viewer = [...role('viewer').keys()];
    expect(viewer.length).toBeGreaterThan(0);
    expect(viewer.every((k) => k.endsWith('.view') || k.endsWith('.export'))).toBe(true);
    expect(viewer).not.toContain('tenant.audit.view');
  });

  it('Cashier cannot refund or delete', () => {
    const cashier = [...role('cashier').keys()];
    expect(cashier).toContain('billing.invoice.create');
    expect(cashier.some((k) => k.startsWith('billing.refund') || k.endsWith('.delete'))).toBe(false);
  });

  it('there are 4 core and 17 module tenant roles', () => {
    const tenant = ROLES.filter((r) => r.layer === 'tenant');
    expect(tenant.filter((r) => r.requiredModules.length === 0)).toHaveLength(4);
    expect(tenant.filter((r) => r.requiredModules.length > 0)).toHaveLength(17);
  });
});
