import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { Request, Response } from 'express';
import { afterAll, describe, expect, it } from 'vitest';
import { prisma, db, withPlatform } from '../kernel/db';
import { env } from '../config/env';
import { ROLES, expandGrants } from '../contracts/roles';
import { PERMISSIONS } from '../contracts/permissions';
import { teamOf, tenantScopeFilter } from '../modules/console/service';
import { consoleContext, requirePermission, requirePlatformPermission } from '../middleware/auth';
import { verifyAccessToken } from '../modules/identity/tokens';

// Platform design v2, Step 2 (R3-lite): Console workspace, Console roles and scopes.

class Rollback extends Error {}
async function rolledBack(fn: () => Promise<void>) {
  try {
    await withPlatform(async () => { await fn(); throw new Rollback(); }, { kind: 'platform' }, { timeoutMs: 120_000 });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
}

afterAll(() => prisma.$disconnect());

const grants = (key: string) => expandGrants(ROLES.find((r) => r.key === key)!);
const platformKeys = PERMISSIONS.filter((p) => p.moduleKey === 'platform').map((p) => p.key);

describe('Console roles and tenant roles never mix', () => {
  it('Admin gets every Console key and nothing from the ERP', () => {
    const g = grants('super_admin');
    expect([...g.keys()].sort()).toEqual([...platformKeys].sort());
    expect([...g.values()].every((s) => s === 'all')).toBe(true);
  });

  it('tenant roles with "*.view" grants get no Console keys', () => {
    for (const role of ROLES.filter((r) => r.layer === 'tenant')) {
      expect([...expandGrants(role).keys()].filter((k) => k.startsWith('platform.'))).toEqual([]);
    }
  });

  it('Console v3 scopes: staff = all, sales and vendor = own, only Admin edits plans or approves discounts', () => {
    expect(grants('console_staff').get('platform.tenant.view')).toBe('all');
    expect(grants('console_sales').get('platform.tenant.view')).toBe('own');
    expect(grants('vendor').get('platform.tenant.view')).toBe('own');
    for (const key of ['console_staff', 'console_sales', 'vendor', 'partner_admin', 'partner_staff']) {
      expect(grants(key).has('platform.plan.edit')).toBe(false);
      expect(grants(key).has('platform.setting.edit')).toBe(false);
      expect(grants(key).has('platform.discount.approve')).toBe(false);
    }
    expect(ROLES.filter((r) => r.layer !== 'tenant').map((r) => r.key).sort()).toEqual(['console_sales', 'console_staff', 'partner_admin', 'partner_staff', 'super_admin', 'vendor']);
  });

  it('route guards reject keys from the other workspace at startup', () => {
    expect(() => requirePermission('platform.tenant.view')).toThrow(/Unknown permission key/);
    expect(() => requirePlatformPermission('crm.contact.view')).toThrow(/Unknown Console permission key/);
  });
});

describe('workspace in the token', () => {
  it('tokens issued before the Console count as tenant tokens', () => {
    const old = jwt.sign({ sub: randomUUID(), tid: randomUUID(), rid: randomUUID(), sid: randomUUID() }, env.JWT_SECRET, { algorithm: 'HS256', audience: 'ahead-api', expiresIn: 60 });
    expect(verifyAccessToken(old).ws).toBe('tenant');
  });

  it('a tenant token cannot enter the Console; a non-member console token neither', async () => {
    const run = (auth: Request['auth']) => consoleContext({ auth } as Request, {} as Response, () => undefined);
    const base = { sub: randomUUID(), rid: null, sid: randomUUID() };
    await expect(run({ ...base, tid: randomUUID(), ws: 'tenant' })).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    await expect(run({ ...base, tid: null, ws: 'console' })).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });
});

describe('Console scope over clients', () => {
  const edges = [
    { userId: 'mgr', reportsTo: null },
    { userId: 'exec1', reportsTo: 'mgr' },
    { userId: 'exec2', reportsTo: 'exec1' },
    { userId: 'other', reportsTo: null },
  ];

  it('team = me and everyone below me in the reporting tree', () => {
    expect(teamOf('mgr', edges).sort()).toEqual(['exec1', 'exec2', 'mgr']);
    expect(teamOf('exec1', edges).sort()).toEqual(['exec1', 'exec2']);
    expect(teamOf('other', edges)).toEqual(['other']);
  });

  it('filters clients by who brought them in', async () => {
    await rolledBack(async () => {
      const tx = db();
      const tenants = await tx.tenant.findMany({ take: 3, orderBy: { createdAt: 'asc' }, select: { id: true } });
      if (tenants.length < 3) return;
      const [mgr, exec, other] = [randomUUID(), randomUUID(), randomUUID()];
      const owners = [mgr, exec, other];
      for (const [i, t] of tenants.entries()) {
        await tx.tenantAcquisition.update({ where: { tenantId: t.id }, data: { acquiredByType: 'sales_user', acquiredByUserId: owners[i], method: 'manual' } });
      }
      const tree = [{ userId: mgr, reportsTo: null }, { userId: exec, reportsTo: mgr }, { userId: other, reportsTo: null }];
      const seen = async (scope: 'own' | 'team' | 'all', me: string) =>
        (await tx.tenant.findMany({ where: { ...tenantScopeFilter(scope, scope === 'team' ? teamOf(me, tree) : [me]), id: { in: tenants.map((t) => t.id) } }, select: { id: true } })).map((t) => t.id).sort();

      expect(await seen('own', exec)).toEqual([tenants[1].id]);
      expect(await seen('team', mgr)).toEqual([tenants[0].id, tenants[1].id].sort());
      expect(await seen('all', other)).toEqual(tenants.map((t) => t.id).sort());
    });
  });
});
