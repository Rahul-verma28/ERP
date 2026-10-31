import type { Prisma } from '@prisma/client';
import { afterCommit, prisma, db } from '../../kernel/db';
import { cache } from '../../kernel/cache';
import { AppError } from '../../kernel/errors';
import { SETTINGS, SETTING_KEYS, type SettingKey, type SettingValue } from '../../contracts/settings';
import { audit } from '../audit/service';

// R2: platform settings resolver. Reads use platform privileges and a short cache;
// writes run inside withPlatform() and are audited.

const SCOPE = 'platform';
const CACHE_KEY = `settings:${SCOPE}`;
const TTL_MS = 60_000;

function loadStored() {
  return cache.getOrSet(CACHE_KEY, async () => {
    const rows = await prisma.configValue.findMany({ where: { scope: SCOPE } });
    return new Map(rows.map((r) => [r.key, { value: r.value as unknown, version: r.version }]));
  }, TTL_MS);
}

/** Pure: a stored value if it is valid for the definition, otherwise the default. */
export function resolveSetting<K extends SettingKey>(key: K, stored: unknown): SettingValue<K> {
  const definition = SETTINGS[key];
  if (stored === undefined) return definition.default as SettingValue<K>;
  const parsed = definition.schema.safeParse(stored);
  if (!parsed.success) {
    console.error(`[settings] invalid stored value for ${key}, using default`);
    return definition.default as SettingValue<K>;
  }
  return parsed.data as SettingValue<K>;
}

export async function getSetting<K extends SettingKey>(key: K): Promise<SettingValue<K>> {
  const stored = await loadStored();
  return resolveSetting(key, stored.get(key)?.value);
}

/** For the Console settings screen: every definition with its effective value and who changed it last. */
export async function listSettings() {
  const [stored, changes] = await Promise.all([
    loadStored(),
    prisma.configValue.findMany({ where: { scope: SCOPE }, select: { key: true, updatedAt: true, updatedBy: true } }),
  ]);
  const ids = [...new Set(changes.map((c) => c.updatedBy).filter((x): x is string => !!x))];
  const names = new Map((await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  return SETTING_KEYS.map((key) => {
    const row = stored.get(key);
    const change = changes.find((c) => c.key === key);
    return {
      key, description: SETTINGS[key].description, default: SETTINGS[key].default, value: resolveSetting(key, row?.value), overridden: !!row, version: row?.version ?? 0,
      changedAt: change?.updatedAt ?? null, changedBy: change?.updatedBy ? names.get(change.updatedBy) ?? null : null,
    };
  });
}

/** Must run inside withPlatform(). */
export async function setSetting<K extends SettingKey>(key: K, value: unknown, actorId: string | null, reason?: string) {
  const definition = SETTINGS[key];
  if (!definition) throw new AppError('VALIDATION_FAILED', 'Unknown setting.', { fields: { key: 'Unknown setting' } });
  const parsed = definition.schema.safeParse(value);
  if (!parsed.success) {
    // The first problem in plain words (e.g. "Enter a valid GSTIN"), shown next to Save
    const message = parsed.error.issues[0]?.message ?? 'Some values are not valid.';
    throw new AppError('VALIDATION_FAILED', message, { fields: { value: message } });
  }

  const tx = db();
  const before = await tx.configValue.findUnique({ where: { scope_key: { scope: SCOPE, key } } });
  const json = parsed.data as Prisma.InputJsonValue;
  const row = await tx.configValue.upsert({
    where: { scope_key: { scope: SCOPE, key } },
    create: { scope: SCOPE, key, value: json, updatedBy: actorId },
    update: { value: json, updatedBy: actorId, version: { increment: 1 } },
  });
  await audit({ tenantId: null, actorId, action: 'settings.changed', entity: 'setting', entityId: key, before: before?.value ?? SETTINGS[key].default, after: { value: row.value, reason } });
  cache.del(CACHE_KEY);
  afterCommit(() => cache.del(CACHE_KEY));
  return row;
}

/** Drops a stored value so the code default applies again. Must run inside withPlatform(). */
export async function resetSetting(key: SettingKey, actorId: string | null, reason?: string) {
  const tx = db();
  const before = await tx.configValue.findUnique({ where: { scope_key: { scope: SCOPE, key } } });
  if (!before) return;
  await tx.configValue.delete({ where: { scope_key: { scope: SCOPE, key } } });
  await audit({ tenantId: null, actorId, action: 'settings.reset', entity: 'setting', entityId: key, before: before.value, after: { value: SETTINGS[key].default, reason } });
  cache.del(CACHE_KEY);
  afterCommit(() => cache.del(CACHE_KEY));
}
