import { z } from 'zod';
import { db, withTenant } from '../../kernel/db';
import { AppError, notFound } from '../../kernel/errors';
import type { ConsoleCtx } from '../../kernel/context';
import { audit } from '../audit/service';
import { FONTS, withDefaults } from '../../contracts/workspace';
import { scopedTenantFilter } from './service';
import { sendAccessLink } from '../identity/accessLinks';
import * as workspace from '../tenancy/workspace';
import { importContacts } from '../crm/routes';
import { importItems } from '../catalog/routes';

// Console onboarding & handover (blueprint Phase B). Steps 1–3 (business, owner, plan) create the
// business; steps 4–7 are saved on it in tenants.onboarding.handover, so anyone in scope can
// resume them: branding, configuration, data import, then hand over (login link). The owner
// accepts the handover from their ERP. Business settings are written inside a transaction scoped
// to that business (RLS), never with platform rights.

export const HANDOVER_STEPS = ['branding', 'config', 'import'] as const;
export type HandoverStep = (typeof HANDOVER_STEPS)[number];

export interface HandoverState {
  startedAt: string;
  startedBy: string | null;
  steps: Partial<Record<HandoverStep, 'done' | 'skipped'>>;
  imported?: { contacts?: number; items?: number };
  sentAt?: string | null;
  sentBy?: string | null;
  acceptedAt?: string | null;
  acceptedBy?: string | null;
}

export const readHandover = (t: { onboarding: unknown }) => ((t.onboarding ?? {}) as { handover?: HandoverState }).handover ?? null;

/** Lock the row (NO KEY: inserts that reference the business still go through), then merge only the
 * handover key: other jobs write other keys of the same JSON. */
async function writeHandover(tenantId: string, patch: (h: HandoverState) => HandoverState) {
  const rows = await db().$queryRaw<{ onboarding: unknown }[]>`SELECT onboarding FROM tenants WHERE id = ${tenantId}::uuid FOR NO KEY UPDATE`;
  if (!rows[0]) throw notFound('Business');
  const current = readHandover(rows[0]) ?? { startedAt: new Date().toISOString(), startedBy: null, steps: {} };
  const next = patch(current);
  await db().$executeRaw`UPDATE tenants SET onboarding = onboarding || jsonb_build_object('handover', ${JSON.stringify(next)}::jsonb) WHERE id = ${tenantId}::uuid`;
  return next;
}

/** Mark a business as being set up through the wizard (called right after it is created). */
export async function startHandover(tenantId: string, userId: string | null) {
  return writeHandover(tenantId, (h) => ({ ...h, startedAt: h.startedAt ?? new Date().toISOString(), startedBy: h.startedBy ?? userId }));
}

async function scoped(ctx: ConsoleCtx, id: string) {
  const t = await db().tenant.findFirst({ where: { id, ...(await scopedTenantFilter(ctx)) }, select: { id: true, name: true, ownerUserId: true, onboarding: true, status: true, fyStartMonth: true, timezone: true, preferences: true, createdAt: true, billingOwner: true } });
  if (!t) throw notFound('Business');
  return t;
}

/** Run business-side work as that business (RLS on), acting for its owner. */
const asBusiness = <T>(t: { id: string; ownerUserId: string }, fn: () => Promise<T>) => withTenant({ kind: 'system', tenantId: t.id, userId: t.ownerUserId }, fn);

/** Businesses being set up: handed over but not accepted yet, or not handed over at all. */
export async function listOnboarding(ctx: ConsoleCtx) {
  const rows = await db().tenant.findMany({
    // Newest 300 in scope; the handover lives in JSON, so it is filtered here
    where: { ...(await scopedTenantFilter(ctx)), status: { notIn: ['closed', 'purged'] } },
    orderBy: { createdAt: 'desc' },
    take: 300,
    select: { id: true, name: true, industryKey: true, status: true, onboarding: true, createdAt: true, ownerUserId: true },
  });
  const owners = new Map((await db().user.findMany({ where: { id: { in: rows.map((r) => r.ownerUserId) } }, select: { id: true, name: true, lastLoginAt: true } })).map((u) => [u.id, u]));
  return rows
    .filter((t) => readHandover(t))
    .map((t) => {
      const h = readHandover(t)!;
      const owner = owners.get(t.ownerUserId);
      return { id: t.id, name: t.name, industryKey: t.industryKey, status: t.status, createdAt: t.createdAt, owner: owner?.name ?? null, ...progressOf(h, !!owner?.lastLoginAt) };
    })
    .filter((r) => r.stage !== 'accepted');
}

/** Pure: where a handover stands and how far along it is (7 steps: 3 to create, then 4). */
export function progressOf(h: HandoverState, ownerSignedIn: boolean) {
  const setupDone = HANDOVER_STEPS.filter((s) => h.steps[s]).length;
  const nextStep: HandoverStep | 'handover' | null = HANDOVER_STEPS.find((s) => !h.steps[s]) ?? (h.sentAt ? null : 'handover');
  const stage = h.acceptedAt ? 'accepted' : h.sentAt ? (ownerSignedIn ? 'signed_in' : 'sent') : 'setting_up';
  const done = 3 + setupDone + (h.sentAt ? 1 : 0);
  return { stage: stage as 'setting_up' | 'sent' | 'signed_in' | 'accepted', nextStep, percent: Math.round((done / 7) * 100), steps: h.steps, sentAt: h.sentAt ?? null, acceptedAt: h.acceptedAt ?? null };
}

/** Everything the wizard's steps 4–7 show for one business. */
export async function onboardingDetail(ctx: ConsoleCtx, id: string) {
  const t = await scoped(ctx, id);
  const h = readHandover(t) ?? (await asBusiness(t, () => startHandover(t.id, ctx.userId)));
  const [owner, counts, sequences] = await Promise.all([
    db().user.findUniqueOrThrow({ where: { id: t.ownerUserId }, select: { name: true, email: true, mobile: true, lastLoginAt: true } }),
    asBusiness(t, async () => ({ contacts: await db().contact.count(), items: await db().item.count() })),
    asBusiness(t, () => workspace.listSequences(t.id)),
  ]);
  const prefs = withDefaults(t.preferences);
  return {
    id: t.id,
    name: t.name,
    status: t.status,
    owner,
    handover: h,
    progress: progressOf(h, !!owner.lastLoginAt),
    branding: prefs.branding,
    config: { fyStartMonth: t.fyStartMonth, timezone: t.timezone, documents: prefs.documents, sequences: sequences.data, fy: sequences.fy },
    counts,
  };
}

export const BrandingInput = z.object({
  brandColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a colour like #2450D8'),
  font: z.enum(FONTS.map((f) => f.key) as [string, ...string[]]),
  theme: z.enum(['light', 'dark', 'system']),
  density: z.enum(['comfortable', 'compact']),
});

export async function saveBranding(ctx: ConsoleCtx, id: string, input: z.infer<typeof BrandingInput>) {
  const t = await scoped(ctx, id);
  // The handover is written in the same business transaction: the tenant row is only ever
  // updated from one transaction at a time (the Console's own one stays read-only here)
  return asBusiness(t, async () => {
    await workspace.updatePreferences(t.id, 'branding', input);
    return writeHandover(t.id, (h) => ({ ...h, steps: { ...h.steps, branding: 'done' } }));
  });
}

export const ConfigInput = z.object({
  fyStartMonth: z.number().int().min(1).max(12),
  invoicePrefix: z.string().trim().max(12),
  quotationPrefix: z.string().trim().max(12),
  receiptPrefix: z.string().trim().max(12),
  template: z.string().max(20),
  /** Moving from another tool: the first invoice number this year */
  invoiceStartAt: z.number().int().min(1).max(9_999_999).nullish(),
});

export async function saveConfig(ctx: ConsoleCtx, id: string, input: z.infer<typeof ConfigInput>) {
  const t = await scoped(ctx, id);
  return asBusiness(t, async () => {
    const issued = await db().salesDocument.count({ where: { kind: 'invoice', number: { not: null } } });
    if (issued && input.fyStartMonth !== t.fyStartMonth) throw new AppError('VALIDATION_FAILED', "The financial year can't change once an invoice is numbered.", { fields: { fyStartMonth: 'Locked: invoices exist' } });
    if (input.fyStartMonth !== t.fyStartMonth) await db().tenant.update({ where: { id: t.id }, data: { fyStartMonth: input.fyStartMonth } });
    await workspace.updatePreferences(t.id, 'documents', { invoicePrefix: input.invoicePrefix, quotationPrefix: input.quotationPrefix, receiptPrefix: input.receiptPrefix, template: input.template });
    if (input.invoiceStartAt && input.invoiceStartAt > 1) await workspace.setInvoiceStart(t.id, input.invoiceStartAt);
    return writeHandover(t.id, (h) => ({ ...h, steps: { ...h.steps, config: 'done' } }));
  });
}

export const ImportInput = z.object({
  kind: z.enum(['contacts', 'items']),
  rows: z.array(z.record(z.unknown())).min(1).max(1000),
  onDuplicate: z.enum(['skip', 'update']).default('skip'),
});

export async function importForBusiness(ctx: ConsoleCtx, id: string, input: z.infer<typeof ImportInput>) {
  const t = await scoped(ctx, id);
  const actor = { tenantId: t.id, userId: t.ownerUserId };
  const result = await asBusiness(t, async () => {
    const r = input.kind === 'contacts' ? await importContacts(actor, { type: 'customer', rows: input.rows, onDuplicate: input.onDuplicate }) : await importItems(actor, { rows: input.rows, onDuplicate: input.onDuplicate });
    await writeHandover(t.id, (h) => ({ ...h, steps: { ...h.steps, import: 'done' }, imported: { ...h.imported, [input.kind]: (h.imported?.[input.kind] ?? 0) + r.created } }));
    return r;
  });
  await audit({ tenantId: null, action: 'console.onboarding_import', entity: 'tenant', entityId: t.id, after: { kind: input.kind, created: result.created, updated: result.updated, errors: result.errors.length } });
  return result;
}

export async function skipStep(ctx: ConsoleCtx, id: string, step: HandoverStep) {
  const t = await scoped(ctx, id);
  return asBusiness(t, () => writeHandover(t.id, (h) => ({ ...h, steps: { ...h.steps, [step]: h.steps[step] === 'done' ? 'done' : 'skipped' } })));
}

/** Step 7: send the owner their login link and record the handover. */
export async function handOver(ctx: ConsoleCtx, id: string) {
  const t = await scoped(ctx, id);
  const link = await sendAccessLink({ kind: 'client_owner', userId: t.ownerUserId, tenantId: t.id, createdBy: ctx.userId, extra: 'Your workspace is set up and ready.' });
  await asBusiness(t, () => writeHandover(t.id, (h) => ({ ...h, sentAt: new Date().toISOString(), sentBy: ctx.userId })));
  await audit({ tenantId: null, action: 'console.handover_sent', entity: 'tenant', entityId: t.id });
  return link;
}

// ── Owner side (ERP) ──

/** What the owner's ERP shows: a "your workspace is ready" card until they accept. */
export async function handoverForOwner(tenantId: string, userId: string) {
  const t = await db().tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { onboarding: true, ownerUserId: true } });
  const h = readHandover(t);
  if (!h || !h.sentAt || h.acceptedAt || t.ownerUserId !== userId) return null;
  return { sentAt: h.sentAt, steps: h.steps, imported: h.imported ?? {} };
}

export async function acceptHandover(tenantId: string, userId: string) {
  const t = await db().tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { onboarding: true, ownerUserId: true } });
  if (t.ownerUserId !== userId) throw new AppError('PERMISSION_DENIED', 'Only the owner accepts the handover.');
  const h = readHandover(t);
  if (!h?.sentAt) throw new AppError('INVALID_TRANSITION', 'There is no handover to accept.');
  if (h.acceptedAt) return h;
  const next = await writeHandover(tenantId, (cur) => ({ ...cur, acceptedAt: new Date().toISOString(), acceptedBy: userId }));
  await audit({ action: 'tenant.handover_accepted', entity: 'tenant', entityId: tenantId });
  return next;
}
