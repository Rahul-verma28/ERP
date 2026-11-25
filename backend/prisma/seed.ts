// Syncs code-defined reference data to the database. Safe to run on every deploy: permissions,
// predefined roles and industry templates follow the code. Plans and prices live in the Console.
//   npm run db:seed
import 'dotenv/config';
import { createPrismaClient } from '../src/kernel/prismaClient';
import { PERMISSIONS } from '../src/contracts/permissions';
import { ROLES, expandGrants } from '../src/contracts/roles';
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
  await seedPermissions();
  await seedRoles();
  await seedTemplates();
  const counts = {
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
