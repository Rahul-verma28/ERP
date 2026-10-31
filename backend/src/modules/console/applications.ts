import { z } from 'zod';
import { db } from '../../kernel/db';
import { AppError, notFound } from '../../kernel/errors';
import type { ConsoleCtx } from '../../kernel/context';
import { normaliseEmail, normaliseMobile } from '../../kernel/crypto';
import { optionalText, zEmail, zGstin, zMobileIN, zPersonName, zStateCode } from '../../kernel/zodRules';
import { gstinStateMismatch } from '../../contracts/validation';
import { audit } from '../audit/service';
import { addMember } from './members';
import { createPartner } from './partners';

// Applications (blueprint Phase G): someone fills in "Become a partner / vendor" on the website;
// an Admin approves it (the partner or vendor is created and gets a login link to set their own
// password) or turns it down. Nobody gets Console access by applying.

export const ApplicationInput = z
  .object({
    kind: z.enum(['vendor', 'partner']),
    name: zPersonName,
    company: optionalText(z.string().trim().min(2, 'Use 2–120 characters').max(120)),
    email: zEmail,
    mobile: zMobileIN,
    city: optionalText(z.string().trim().max(60)),
    stateCode: zStateCode.nullish(),
    gstin: optionalText(zGstin),
    message: optionalText(z.string().trim().max(1000)),
    /** Honeypot: people leave it empty, simple bots fill it */
    website: z.string().max(200).optional(),
  })
  .superRefine((b, c) => {
    if (b.kind === 'partner' && !b.company) c.addIssue({ code: z.ZodIssueCode.custom, path: ['company'], message: 'Your company name' });
    const mismatch = gstinStateMismatch(b.gstin, b.stateCode ?? undefined);
    if (mismatch) c.addIssue({ code: z.ZodIssueCode.custom, path: ['gstin'], message: mismatch });
  });

/** Public, platform transaction. The same answer whatever happens, so the form tells nobody who has applied. */
export async function submitApplication(input: z.infer<typeof ApplicationInput>) {
  if (input.website) return { received: true };
  const email = normaliseEmail(input.email);
  const pending = await db().consoleApplication.findFirst({ where: { email, kind: input.kind, status: 'new' } });
  if (pending) return { received: true };
  await db().consoleApplication.create({
    data: {
      kind: input.kind, name: input.name.trim(), company: input.company ?? null, email, mobile: normaliseMobile(input.mobile),
      city: input.city ?? null, stateCode: input.stateCode ?? null, gstin: input.gstin?.toUpperCase() ?? null, message: input.message ?? null,
    },
  });
  return { received: true };
}

export async function listApplications(status: 'new' | 'approved' | 'rejected') {
  const [rows, counts] = await Promise.all([
    db().consoleApplication.findMany({ where: { status }, orderBy: { createdAt: status === 'new' ? 'asc' : 'desc' }, take: 100 }),
    db().consoleApplication.groupBy({ by: ['status'], _count: true }),
  ]);
  // Is this person already in the Console (or already a partner)?
  const emails = rows.map((r) => r.email);
  const [members, partners, deciders] = await Promise.all([
    db().user.findMany({ where: { email: { in: emails }, platformMember: { status: 'active' } }, select: { email: true } }),
    db().partner.findMany({ where: { email: { in: emails } }, select: { email: true } }),
    db().user.findMany({ where: { id: { in: rows.map((r) => r.decidedBy).filter((x): x is string => !!x) } }, select: { id: true, name: true } }),
  ]);
  const inConsole = new Set(members.map((m) => m.email));
  const isPartner = new Set(partners.map((p) => p.email));
  const by = new Map(deciders.map((u) => [u.id, u.name]));
  return {
    counts: Object.fromEntries(['new', 'approved', 'rejected'].map((s) => [s, counts.find((c) => c.status === s)?._count ?? 0])),
    data: rows.map((r) => ({
      ...r,
      decidedBy: r.decidedBy ? by.get(r.decidedBy) ?? null : null,
      alreadyInConsole: inConsole.has(r.email),
      alreadyPartner: isPartner.has(r.email),
    })),
  };
}

async function pendingApplication(id: string) {
  const a = await db().consoleApplication.findUnique({ where: { id } });
  if (!a) throw notFound('Application');
  if (a.status !== 'new') throw new AppError('INVALID_TRANSITION', 'This application has already been decided.');
  return a;
}

export const ApproveInput = z.object({ discountPercent: z.number().min(0, 'From 0 to 90').max(90, 'From 0 to 90').default(0) });

/** Partner: creates the partner and its owner; vendor: adds a Console user with the Vendor role. */
export async function approveApplication(ctx: ConsoleCtx, id: string, input: z.infer<typeof ApproveInput>) {
  const a = await pendingApplication(id);
  const created =
    a.kind === 'partner'
      ? await createPartner(ctx, { name: a.company ?? a.name, contactName: a.name, email: a.email, mobile: a.mobile, gstin: a.gstin, stateCode: a.stateCode as never, discountPercent: input.discountPercent })
      : await addMember(ctx, { email: a.email, name: a.name, mobile: a.mobile, roleKey: 'vendor' });
  await db().consoleApplication.update({ where: { id }, data: { status: 'approved', decidedBy: ctx.userId, decidedAt: new Date(), resultId: created.id } });
  await audit({ tenantId: null, action: 'console.application_approved', entity: 'console_application', entityId: id, after: { kind: a.kind, email: a.email } });
  return { kind: a.kind, resultId: created.id, loginLink: created.loginLink, mobile: a.mobile };
}

export const RejectInput = z.object({ note: optionalText(z.string().trim().max(300)) });

export async function rejectApplication(ctx: ConsoleCtx, id: string, input: z.infer<typeof RejectInput>) {
  const a = await pendingApplication(id);
  await db().consoleApplication.update({ where: { id }, data: { status: 'rejected', decidedBy: ctx.userId, decidedAt: new Date(), decisionNote: input.note ?? null } });
  await audit({ tenantId: null, action: 'console.application_rejected', entity: 'console_application', entityId: id, after: { kind: a.kind, email: a.email, note: input.note ?? null } });
}
