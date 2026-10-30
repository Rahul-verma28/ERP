import type { FieldDefinition, FieldType, Prisma } from '@prisma/client';
import { z } from 'zod';
import { db } from '../../kernel/db';
import { cache } from '../../kernel/cache';
import { AppError, notFound } from '../../kernel/errors';
import { DEFAULT_TERMS, templateByKey } from '../../contracts/templates';
import { consumer, publish } from '../events/outbox';
import { audit } from '../audit/service';

// Configuration engine (LLD §5): terminology, custom fields, template application.

export const CUSTOM_ENTITIES = ['contact', 'lead', 'item', 'invoice', 'employee', 'appointment', 'task', 'ticket'] as const;
const MAX_FIELDS_PER_ENTITY = 50;

/** Apply the tenant's industry template. Runs in the tenant's context (system actor). */
export async function applyTemplate(tenantId: string) {
  const tx = db();
  const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  if (tenant.configAppliedAt) return;
  const template = templateByKey(tenant.industryKey);
  if (!template) throw new Error(`Template ${tenant.industryKey} not found`);

  const terms = { ...DEFAULT_TERMS, ...template.terms };
  await tx.tenantTerm.createMany({
    data: Object.entries(terms).map(([termKey, value]) => ({ tenantId, termKey, value, source: 'template' as const })),
    skipDuplicates: true,
  });
  await tx.fieldDefinition.createMany({
    data: template.fields.map((f, i) => ({
      tenantId, entity: f.entity, key: f.key, label: f.label, type: f.type as FieldType,
      required: !!f.required, options: f.options ?? undefined, position: i, source: 'template' as const,
    })),
    skipDuplicates: true,
  });
  await tx.tenant.update({ where: { id: tenantId }, data: { configAppliedAt: new Date(), templateVersion: template.version } });
  // Merge, never replace: the setup wizard and the Console handover keep their own keys here,
  // and this job can finish after either has started
  await tx.$executeRaw`UPDATE tenants SET onboarding = onboarding || jsonb_build_object('dashboard', ${JSON.stringify(template.dashboard)}::jsonb, 'recommendedModules', ${JSON.stringify(template.modules)}::jsonb) WHERE id = ${tenantId}::uuid`;
  await publish('config.applied', { tenantId, templateKey: template.key, version: template.version });
}

consumer('config.apply-template', 'tenant.created', async (evt) => {
  await applyTemplate(evt.tenantId!);
});

// ── Terminology ──

export async function getTerms(tenantId: string): Promise<Record<string, string>> {
  return cache.getOrSet(`terms:${tenantId}`, async () => {
    const rows = await db().tenantTerm.findMany();
    return { ...DEFAULT_TERMS, ...Object.fromEntries(rows.map((r) => [r.termKey, r.value])) };
  }, 60_000);
}

export async function putTerms(tenantId: string, terms: Record<string, string>) {
  const tx = db();
  const before = await getTerms(tenantId);
  for (const [termKey, value] of Object.entries(terms)) {
    if (!(termKey in DEFAULT_TERMS)) throw new AppError('VALIDATION_FAILED', `Unknown term ${termKey}`, { fields: { [termKey]: 'Unknown term' } });
    await tx.tenantTerm.upsert({
      where: { tenantId_termKey: { tenantId, termKey } },
      create: { tenantId, termKey, value, source: 'tenant' },
      update: { value, source: 'tenant' },
    });
  }
  cache.del(`terms:${tenantId}`);
  await audit({ action: 'config.terms.update', entity: 'tenant_terms', before, after: terms });
  return getTerms(tenantId);
}

// ── Custom fields ──

export const FieldInput = z.object({
  entity: z.enum(CUSTOM_ENTITIES),
  key: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/, 'Use lower-case letters, digits and underscores'),
  label: z.string().trim().min(1).max(80),
  type: z.enum(['text', 'number', 'date', 'dropdown', 'multi_select', 'checkbox', 'attachment', 'relation']),
  required: z.boolean().default(false),
  options: z.array(z.string().trim().min(1).max(80)).max(100).optional(),
  validation: z.object({ min: z.number().optional(), max: z.number().optional(), maxLength: z.number().int().positive().max(500).optional() }).optional(),
  relationEntity: z.enum(CUSTOM_ENTITIES).optional(),
});

export const FieldPatch = z.object({
  label: z.string().trim().min(1).max(80).optional(),
  required: z.boolean().optional(),
  options: z.array(z.string().trim().min(1).max(80)).max(100).optional(),
  position: z.number().int().min(0).optional(),
  archived: z.boolean().optional(),
  version: z.number().int(),
});

export async function listFields(entity?: string) {
  return db().fieldDefinition.findMany({
    where: { entity: entity || undefined },
    orderBy: [{ entity: 'asc' }, { position: 'asc' }],
  });
}

export async function createField(tenantId: string, input: z.infer<typeof FieldInput>) {
  if ((input.type === 'dropdown' || input.type === 'multi_select') && !input.options?.length) {
    throw new AppError('VALIDATION_FAILED', 'Dropdown fields need options.', { fields: { options: 'Add at least one option' } });
  }
  if (input.type === 'relation' && !input.relationEntity) {
    throw new AppError('VALIDATION_FAILED', 'Relation fields need a target.', { fields: { relationEntity: 'Required' } });
  }
  const count = await db().fieldDefinition.count({ where: { entity: input.entity, archivedAt: null } });
  if (count >= MAX_FIELDS_PER_ENTITY) throw new AppError('LIMIT_REACHED', `Up to ${MAX_FIELDS_PER_ENTITY} custom fields per record type.`);
  const field = await db().fieldDefinition.create({
    data: { ...input, tenantId, position: count, options: input.options, validation: input.validation as Prisma.InputJsonValue },
  });
  cache.del(`fields:${tenantId}:${input.entity}`);
  await audit({ action: 'config.field.create', entity: 'field_definition', entityId: field.id, after: input });
  return field;
}

export async function updateField(tenantId: string, id: string, patch: z.infer<typeof FieldPatch>) {
  const tx = db();
  const field = await tx.fieldDefinition.findUnique({ where: { id } });
  if (!field) throw notFound('Field');
  if (field.version !== patch.version) throw new AppError('VERSION_CONFLICT', 'This field was changed by someone else. Reload and try again.');
  const { archived, version: _v, ...rest } = patch;
  const updated = await tx.fieldDefinition.update({
    where: { id },
    data: { ...rest, archivedAt: archived === undefined ? undefined : archived ? new Date() : null, version: { increment: 1 } },
  });
  cache.del(`fields:${tenantId}:${field.entity}`);
  await audit({ action: 'config.field.update', entity: 'field_definition', entityId: id, before: field, after: updated });
  return updated;
}

// ── Custom field validation (LLD §5.3) — used by every module that stores `custom` JSONB ──

function validatorFor(f: FieldDefinition): z.ZodTypeAny {
  const v = (f.validation ?? {}) as { min?: number; max?: number; maxLength?: number };
  const opts = (f.options ?? []) as string[];
  let s: z.ZodTypeAny;
  switch (f.type) {
    case 'number': {
      let n = z.number();
      if (v.min !== undefined) n = n.min(v.min);
      if (v.max !== undefined) n = n.max(v.max);
      s = n;
      break;
    }
    case 'date': s = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'); break;
    case 'dropdown': s = z.enum(opts as [string, ...string[]]); break;
    case 'multi_select': s = z.array(z.enum(opts as [string, ...string[]])); break;
    case 'checkbox': s = z.boolean(); break;
    case 'attachment': s = z.string().max(500); break;
    case 'relation': s = z.string().uuid(); break;
    default: s = z.string().max(v.maxLength ?? 500);
  }
  return f.required ? s : s.nullable().optional();
}

/** Validate a `custom` object for an entity: unknown keys rejected, required enforced. */
export async function validateCustom(tenantId: string, entity: string, input: Record<string, unknown> | undefined, existing: Record<string, unknown> = {}) {
  const defs = await cache.getOrSet(`fields:${tenantId}:${entity}`, () => db().fieldDefinition.findMany({ where: { entity } }));
  const active = defs.filter((d) => !d.archivedAt);
  const shape = Object.fromEntries(active.map((d) => [d.key, validatorFor(d)]));
  const result = z.object(shape).strict().safeParse({ ...pick(existing, active.map((d) => d.key)), ...(input ?? {}) });
  if (!result.success) {
    const fields: Record<string, string> = {};
    for (const i of result.error.issues) fields[`custom.${i.path.join('.') || i.message}`] = i.message;
    throw new AppError('VALIDATION_FAILED', 'Some custom fields are invalid.', { fields });
  }
  // Archived fields keep their old values (read-only)
  const archived = pick(existing, defs.filter((d) => d.archivedAt).map((d) => d.key));
  return { ...archived, ...result.data } as Record<string, unknown>;
}

const pick = (o: Record<string, unknown>, keys: string[]) => Object.fromEntries(keys.filter((k) => k in o).map((k) => [k, o[k]]));
