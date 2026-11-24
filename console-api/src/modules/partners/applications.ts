import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { testing } from '../../config/env';
import { prisma } from '../../kernel/db';
import { AppError } from '../../kernel/errors';
import { audit } from '../../kernel/audit';
import { normaliseEmail, normaliseMobile } from '../../kernel/crypto';
import { sendEmail } from '../../kernel/mail';
import { validate } from '../../middleware/request';
import { allow, requireStaff } from '../../middleware/auth';
import { sendAccountLink } from '../auth/service';
import { createPartner } from './service';

// "Sell AHEAD" applications from the website: a vendor gets a Console login to bring in
// businesses; a partner is a company that sells AHEAD to its own clients. Admin decides; a partner
// needs its KYC papers (PAN, GST certificate or agreement) on file first.

const Apply = z.object({
  kind: z.enum(['vendor', 'partner']),
  name: z.string().trim().min(2, 'Enter your name').max(100),
  company: z.string().trim().max(120).nullish(),
  email: z.string().trim().email('Enter a valid email').transform(normaliseEmail),
  mobile: z.string().trim().regex(/^(\+91)?[6-9]\d{9}$/, 'Enter a 10-digit mobile').transform(normaliseMobile),
  city: z.string().trim().max(60).nullish(),
  stateCode: z.string().regex(/^\d{2}$/).nullish(),
  gstin: z.string().trim().toUpperCase().regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, 'Enter a valid GSTIN').nullish().or(z.literal('').transform(() => null)),
  message: z.string().trim().max(1000).nullish(),
}).refine((a) => a.kind === 'vendor' || !!a.company, { message: 'Enter the company name', path: ['company'] });

// ── Public: the website form ──
export const publicApplications = Router();
const limiter = rateLimit({ windowMs: 60 * 60_000, limit: testing ? 10_000 : 5, standardHeaders: true, legacyHeaders: false, message: { error: { code: 'RATE_LIMITED', message: 'Too many applications from here. Try again later.' } } });

publicApplications.post('/applications', limiter, validate(Apply), async (req, res) => {
  // The same person applying again updates the open application instead of making a second one
  const open = await prisma.application.findFirst({ where: { email: req.body.email, kind: req.body.kind, status: 'new' } });
  const row = open ? await prisma.application.update({ where: { id: open.id }, data: req.body }) : await prisma.application.create({ data: req.body });
  await sendEmail(row.email, 'We received your application to sell AHEAD', `Hi ${row.name},\n\nThank you for applying to become an AHEAD ${row.kind}. Our team will call you on ${row.mobile} within two working days.\n\nAHEAD`).catch(() => undefined);
  res.status(open ? 200 : 201).json({ received: true });
});

// ── Admin ──
const router = Router();
router.use(requireStaff);
const Id = z.object({ id: z.string().uuid() });

router.get('/', allow('admin', 'staff'), validate(z.object({ status: z.enum(['new', 'approved', 'rejected']).default('new') }), 'query'), async (req, res) => {
  const status = (req.query as unknown as { status: string }).status;
  const rows = await prisma.application.findMany({ where: { status }, orderBy: { createdAt: 'desc' }, take: 200 });
  const files = await prisma.consoleFile.groupBy({ by: ['entityId'], where: { entityType: 'application', entityId: { in: rows.map((r) => r.id) } }, _count: true });
  res.json({ data: rows.map((r) => ({ ...r, kycFiles: files.find((f) => f.entityId === r.id)?._count ?? 0 })) });
});

async function pending(id: string) {
  const a = await prisma.application.findUnique({ where: { id } });
  if (!a) throw new AppError('NOT_FOUND', 'Application not found.');
  if (a.status !== 'new') throw new AppError('CONFLICT', `This application was already ${a.status}.`);
  return a;
}

router.post('/:id/approve', allow('admin'), validate(Id, 'params'), validate(z.object({ discountPct: z.number().min(0).max(90).default(0) })), async (req, res) => {
  const a = await pending(String(req.params.id));
  const actor = req.staff!.id;
  let inviteUserId: string;
  let resultId: string;
  if (a.kind === 'partner') {
    const kyc = await prisma.consoleFile.findMany({ where: { entityType: 'application', entityId: a.id }, select: { id: true } });
    if (!kyc.length) throw new AppError('VALIDATION_FAILED', 'Add the partner’s KYC papers (PAN, GST certificate or agreement) before approving.', { fields: { kyc: 'Add KYC papers' } });
    const out = await prisma.$transaction(async (tx) => {
      const made = await createPartner(actor, { name: a.company!, contactName: a.name, email: a.email, mobile: a.mobile, gstin: a.gstin, stateCode: a.stateCode, city: a.city, discountPct: req.body.discountPct }, tx);
      // The papers now belong to the partner
      await tx.consoleFile.updateMany({ where: { id: { in: kyc.map((k) => k.id) } }, data: { entityType: 'partner', entityId: made.partner.id } });
      await tx.application.update({ where: { id: a.id }, data: { status: 'approved', decidedById: actor, decidedAt: new Date(), resultId: made.partner.id } });
      return made;
    });
    inviteUserId = out.ownerId;
    resultId = out.partner.id;
  } else {
    if (await prisma.consoleUser.findUnique({ where: { email: a.email } })) throw new AppError('EMAIL_TAKEN', 'Someone already uses this email in the Console.');
    const u = await prisma.$transaction(async (tx) => {
      const made = await tx.consoleUser.create({ data: { name: a.name, email: a.email, mobile: a.mobile, role: 'vendor', referralCode: `${a.name.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 6)}${a.id.slice(-4).toUpperCase()}`, createdById: actor } });
      await tx.application.update({ where: { id: a.id }, data: { status: 'approved', decidedById: actor, decidedAt: new Date(), resultId: made.id } });
      return made;
    });
    inviteUserId = u.id;
    resultId = u.id;
  }
  await audit({ actorId: actor, action: 'application.approved', entity: 'application', entityId: a.id, after: { kind: a.kind, resultId } });
  await sendAccountLink(inviteUserId, 'invite', actor);
  res.json({ kind: a.kind, resultId });
});

router.post('/:id/reject', allow('admin'), validate(Id, 'params'), validate(z.object({ note: z.string().trim().max(300).nullish() })), async (req, res) => {
  const a = await pending(String(req.params.id));
  await prisma.application.update({ where: { id: a.id }, data: { status: 'rejected', decidedById: req.staff!.id, decidedAt: new Date(), decisionNote: req.body.note ?? null } });
  await audit({ actorId: req.staff!.id, action: 'application.rejected', entity: 'application', entityId: a.id, after: { note: req.body.note ?? null } });
  res.status(204).end();
});

export default router;
