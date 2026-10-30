// Syncs code-defined reference data to the database. Safe to run on every deploy:
// permissions, predefined roles and templates follow the code; plans and prices are only
// inserted when missing, so Console edits survive (design v2, R4).
//   npm run db:seed                          → normal deploy seed
//   npm run db:seed -- --reset-commercials   → dev only: restore plans/prices from contracts/plans.ts
import 'dotenv/config';
import { createPrismaClient } from '../src/kernel/prismaClient';
import { syncCatalog } from '../src/modules/subscription/catalog';
import { PERMISSIONS } from '../src/contracts/permissions';
import { RETIRED_ROLES, ROLES, expandGrants } from '../src/contracts/roles';
import { TEMPLATES } from '../src/contracts/templates';

const prisma = createPrismaClient();

async function seedPermissions() {
  for (const p of PERMISSIONS) {
    const data = { moduleKey: p.moduleKey, resource: p.resource, action: p.action, description: p.description };
    await prisma.permission.upsert({ where: { key: p.key }, create: { key: p.key, ...data }, update: data });
  }
  await prisma.permission.deleteMany({ where: { key: { notIn: PERMISSIONS.map((p) => p.key) } } });
}

async function seedRoles() {
  for (const [i, def] of ROLES.entries()) {
    const grants = expandGrants(def);
    const base = { name: def.name, description: def.description, layer: def.layer, roleType: def.roleType, requiredModules: def.requiredModules, isSystem: !!def.isSystem, isPredefined: true, sort: i };
    let role = await prisma.role.findFirst({ where: { tenantId: null, key: def.key }, include: { permissions: true } });
    if (!role) {
      role = await prisma.role.create({ data: { key: def.key, ...base }, include: { permissions: true } });
    }
    // An Admin edited this Console role in the Console: keep their permissions
    if (role.customizedAt) {
      await prisma.role.update({ where: { id: role.id }, data: base });
      continue;
    }
    const existing = new Map(role.permissions.map((rp) => [rp.permissionKey, rp.scope]));
    const changed = existing.size !== grants.size || [...grants].some(([k, s]) => existing.get(k) !== s);
    await prisma.role.update({ where: { id: role.id }, data: { ...base, version: changed ? { increment: 1 } : undefined } });
    if (changed) {
      await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
      await prisma.rolePermission.createMany({ data: [...grants].map(([permissionKey, scope]) => ({ roleId: role!.id, permissionKey, scope })) });
    }
    await prisma.roleFieldAccess.deleteMany({ where: { roleId: role.id } });
    if (def.fieldAccess?.length) {
      await prisma.roleFieldAccess.createMany({ data: def.fieldAccess.map((f) => ({ roleId: role!.id, ...f })) });
    }
  }
}

/** Move members of retired predefined roles to their replacement, then drop the old role. */
async function retireRoles() {
  for (const [oldKey, newKey] of Object.entries(RETIRED_ROLES)) {
    const old = await prisma.role.findFirst({ where: { tenantId: null, key: oldKey }, select: { id: true } });
    if (!old) continue;
    const next = await prisma.role.findFirstOrThrow({ where: { tenantId: null, key: newKey }, select: { id: true } });
    await prisma.platformMember.updateMany({ where: { roleId: old.id }, data: { roleId: next.id } });
    await prisma.rolePermission.deleteMany({ where: { roleId: old.id } });
    await prisma.roleFieldAccess.deleteMany({ where: { roleId: old.id } });
    await prisma.role.delete({ where: { id: old.id } });
  }
  // Discount limits stored under the old role keys fall back to the new defaults
  const limits = await prisma.configValue.findUnique({ where: { scope_key: { scope: 'platform', key: 'sales.discount_limits' } } });
  if (limits && Object.keys(limits.value as object).some((k) => k in RETIRED_ROLES)) {
    await prisma.configValue.delete({ where: { scope_key: { scope: 'platform', key: 'sales.discount_limits' } } });
  }
}

async function seedTemplates() {
  for (const t of TEMPLATES) {
    const definition = JSON.parse(JSON.stringify(t));
    await prisma.industryTemplate.upsert({
      where: { key_version: { key: t.key, version: t.version } },
      create: { key: t.key, version: t.version, name: t.name, description: t.description, definition },
      update: { name: t.name, description: t.description, definition },
    });
  }
}

async function main() {
  await syncCatalog(prisma, { resetCommercials: process.argv.includes('--reset-commercials') });
  await seedPermissions();
  await seedRoles();
  await retireRoles();
  await seedTemplates();
  const counts = {
    modules: await prisma.module.count(),
    plans: await prisma.plan.count(),
    permissions: await prisma.permission.count(),
    roles: await prisma.role.count({ where: { tenantId: null } }),
    templates: await prisma.industryTemplate.count(),
  };
  console.log('Seed complete', counts);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
