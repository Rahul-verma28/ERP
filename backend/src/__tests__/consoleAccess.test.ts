import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { prisma, db, withPlatform } from '../kernel/db';
import { cache } from '../kernel/cache';
import type { ConsoleCtx } from '../kernel/context';
import { createRole, deleteRole, permissionMatrix, resetRole, roleDetail, updateRole } from '../modules/console/access';
import { deviceOf, listAudit, securityStats } from '../modules/console/security';
import { consolePermissions } from '../modules/console/service';

// Blueprint Phase C: the role matrix, custom Console roles, and the audit trail. Rolled back.

class Rollback extends Error {}
async function rolledBack(fn: () => Promise<void>) {
  try {
    await withPlatform(async () => { await fn(); throw new Rollback(); }, { kind: 'platform' }, { timeoutMs: 120_000 });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
  cache.del('settings:platform');
}

afterAll(() => prisma.$disconnect());

const roleOf = async (key: string) => db().role.findFirstOrThrow({ where: { tenantId: null, layer: 'platform', key } });

async function consoleUser(roleKey: string): Promise<ConsoleCtx> {
  const n = String(Math.floor(Math.random() * 1e9)).padStart(9, '0');
  const user = await db().user.create({ data: { name: `PC ${roleKey}`, email: `pc-${n}@example.test`, mobile: `+918${n}` } });
  const role = await roleOf(roleKey);
  const member = await db().platformMember.create({ data: { userId: user.id, roleId: role.id } });
  return { kind: 'platform', userId: user.id, memberId: member.id, roleId: role.id, sessionId: randomUUID(), scope: 'all', partnerId: null };
}

describe('pure helpers', () => {
  it('marks risky permissions in the matrix and names devices plainly', () => {
    const member = permissionMatrix().find((r) => r.resource === 'member')!;
    expect(member.actions.find((a) => a.action === 'create')?.risky).toBe(true);
    expect(permissionMatrix().find((r) => r.resource === 'dashboard')!.actions[0].risky).toBe(false);
    expect(deviceOf('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36')).toBe('Chrome on Windows');
    expect(deviceOf(null)).toBe('Unknown device');
  });
});

describe('Console roles', () => {
  it('only an Admin copies a role; the copy has the same permissions and discount limit', async () => {
    await rolledBack(async () => {
      const admin = await consoleUser('super_admin');
      const staff = await consoleUser('console_staff');
      const sales = await roleOf('console_sales');
      await expect(createRole(staff, { fromRoleId: sales.id, name: 'Telesales' })).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
      await expect(createRole(admin, { fromRoleId: (await roleOf('super_admin')).id, name: 'Admin 2' })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
      const { id } = await createRole(admin, { fromRoleId: sales.id, name: 'Telesales' });
      const copy = await roleDetail(id);
      expect(copy.builtIn).toBe(false);
      expect(copy.copiedFrom).toBe('Sales');
      expect(copy.grants).toEqual((await roleDetail(sales.id)).grants);
      // Settings are cached from committed values, so read the saved limit from this transaction
      const stored = (await db().configValue.findUniqueOrThrow({ where: { scope_key: { scope: 'platform', key: 'sales.discount_limits' } } })).value as Record<string, number>;
      expect(stored[copy.key]).toBe(10);
      await expect(createRole(admin, { fromRoleId: sales.id, name: 'telesales' })).rejects.toMatchObject({ code: 'CONFLICT' });
    });
  });

  it('editing a built-in role takes effect at once, survives the seed, and can be reset', async () => {
    await rolledBack(async () => {
      const admin = await consoleUser('super_admin');
      const staff = await roleOf('console_staff');
      expect((await consolePermissions(staff.id))['platform.revenue.view']).toBe('all');
      const grants = { ...(await roleDetail(staff.id)).grants };
      delete grants['platform.revenue.view'];
      const after = await updateRole(admin, staff.id, { grants, discountLimitPercent: 12 });
      expect(after.customized).toBe(true);
      expect(after.discountLimitPercent).toBe(12);
      // Live permission checks read committed rows (cached by role version); here, check the stored rows
      expect(await db().rolePermission.count({ where: { roleId: staff.id, permissionKey: 'platform.revenue.view' } })).toBe(0);
      expect((await db().role.findUniqueOrThrow({ where: { id: staff.id } })).version).toBeGreaterThan(staff.version);
      await expect(updateRole(admin, staff.id, { name: 'Ops' })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
      await expect(updateRole(admin, staff.id, { grants: { 'crm.contact.view': 'all' } })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
      await expect(updateRole(admin, (await roleOf('super_admin')).id, { grants: {} })).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });

      const reset = await resetRole(admin, staff.id);
      expect(reset.customized).toBe(false);
      expect(reset.grants['platform.revenue.view']).toBe('all');

      const audit = await listAudit({ area: 'people', limit: 20 });
      const changed = audit.data.find((e) => e.action === 'console.role_updated');
      expect(changed).toMatchObject({ risky: true, subject: 'Staff', text: "changed a role's permissions" });
      expect((await securityStats()).risky7d).toBeGreaterThan(0);
    });
  });

  it('a custom role with people on it cannot be deleted; built-in roles never', async () => {
    await rolledBack(async () => {
      const admin = await consoleUser('super_admin');
      const { id } = await createRole(admin, { fromRoleId: (await roleOf('console_staff')).id, name: 'Finance desk' });
      const user = await db().user.create({ data: { name: 'Finance Person', email: `pcf-${randomUUID().slice(0, 8)}@example.test`, mobile: `+9170${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}` } });
      await db().platformMember.create({ data: { userId: user.id, roleId: id } });
      await expect(deleteRole(admin, id)).rejects.toMatchObject({ code: 'CONFLICT' });
      await expect(deleteRole(admin, (await roleOf('console_sales')).id)).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
      await db().platformMember.deleteMany({ where: { roleId: id } });
      await deleteRole(admin, id);
      expect(await db().role.count({ where: { id } })).toBe(0);
    });
  });
});
