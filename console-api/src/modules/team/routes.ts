import { Router } from 'express';
import { z } from 'zod';
import type { ConsoleRole } from '@prisma/client';
import { prisma } from '../../kernel/db';
import { AppError } from '../../kernel/errors';
import { audit } from '../../kernel/audit';
import { normaliseEmail, normaliseMobile, randomToken } from '../../kernel/crypto';
import { validate } from '../../middleware/request';
import { allow, PARTNER_ROLES, requireStaff } from '../../middleware/auth';
import { sendAccountLink } from '../auth/service';

// Console people. Admin adds AHEAD staff, salespeople, vendors and partner people; a partner owner
// adds their own staff. Each new person gets an invite link and sets their own password.

const router = Router();
router.use(requireStaff);

const select = { id: true, name: true, email: true, mobile: true, role: true, status: true, referralCode: true, partnerId: true, mfaEnabledAt: true, lastLoginAt: true, createdAt: true } as const;

router.get('/', allow('admin', 'partner_owner'), async (req, res) => {
  const where = req.staff!.role === 'admin' ? {} : { partnerId: req.staff!.partnerId };
  res.json({ data: await prisma.consoleUser.findMany({ where, select: { ...select, partner: { select: { name: true } } }, orderBy: { createdAt: 'asc' } }) });
});

const Invite = z.object({
  name: z.string().trim().min(2, 'Enter the name').max(100),
  email: z.string().trim().email('Enter a valid email').transform(normaliseEmail),
  mobile: z.string().trim().regex(/^(\+91)?[6-9]\d{9}$/, 'Enter a 10-digit mobile').transform(normaliseMobile).nullish(),
  role: z.enum(['admin', 'staff', 'sales', 'vendor', 'partner_owner', 'partner_staff']),
  partnerId: z.string().uuid().nullish(),
});

/** Who may give which role */
function check(actor: { role: ConsoleRole; partnerId: string | null }, role: ConsoleRole, partnerId: string | null | undefined) {
  if (actor.role === 'partner_owner') {
    if (role !== 'partner_staff') throw new AppError('PERMISSION_DENIED', 'You can add your own staff only.');
    return actor.partnerId;
  }
  if (PARTNER_ROLES.includes(role) && !partnerId) throw new AppError('VALIDATION_FAILED', 'Choose the partner.', { fields: { partnerId: 'Choose the partner' } });
  return PARTNER_ROLES.includes(role) ? partnerId! : null;
}

router.post('/', allow('admin', 'partner_owner'), validate(Invite), async (req, res) => {
  const partnerId = check(req.staff!, req.body.role, req.body.partnerId);
  if (await prisma.consoleUser.findUnique({ where: { email: req.body.email } })) throw new AppError('EMAIL_TAKEN', 'Someone already uses this email in the Console.', { fields: { email: 'Already in the Console' } });
  const referral = ['sales', 'vendor'].includes(req.body.role) ? `${req.body.name.split(/\s+/)[0].toUpperCase().replace(/[^A-Z]/g, '').slice(0, 6)}${randomToken(3).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4)}` : null;
  const user = await prisma.consoleUser.create({
    data: { name: req.body.name, email: req.body.email, mobile: req.body.mobile ?? null, role: req.body.role, partnerId, referralCode: referral, createdById: req.staff!.id },
    select,
  });
  await audit({ actorId: req.staff!.id, action: 'team.invited', entity: 'console_user', entityId: user.id, after: { role: user.role, email: user.email } });
  await sendAccountLink(user.id, 'invite', req.staff!.id);
  res.status(201).json(user);
});

router.patch('/:id', allow('admin'), validate(z.object({ id: z.string().uuid() }), 'params'), validate(z.object({ role: Invite.shape.role.optional(), status: z.enum(['active', 'disabled']).optional() })), async (req, res) => {
  const id = String(req.params.id);
  if (id === req.staff!.id) throw new AppError('CONFLICT', 'You can’t change your own role or switch yourself off.');
  const before = await prisma.consoleUser.findUniqueOrThrow({ where: { id }, select });
  // Keep at least one active Admin
  if (before.role === 'admin' && (req.body.status === 'disabled' || (req.body.role && req.body.role !== 'admin'))) {
    const admins = await prisma.consoleUser.count({ where: { role: 'admin', status: 'active', id: { not: id } } });
    if (!admins) throw new AppError('CONFLICT', 'There must always be one active Admin.');
  }
  const user = await prisma.consoleUser.update({ where: { id }, data: req.body, select });
  // Switched off: signed out everywhere at once
  if (req.body.status === 'disabled') await prisma.consoleSession.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
  await audit({ actorId: req.staff!.id, action: 'team.changed', entity: 'console_user', entityId: id, before, after: user });
  res.json(user);
});

router.post('/:id/invite', allow('admin', 'partner_owner'), validate(z.object({ id: z.string().uuid() }), 'params'), async (req, res) => {
  const u = await prisma.consoleUser.findUniqueOrThrow({ where: { id: String(req.params.id) }, select: { partnerId: true, status: true, passwordHash: true } });
  if (req.staff!.role === 'partner_owner' && u.partnerId !== req.staff!.partnerId) throw new AppError('NOT_FOUND', 'Person not found.');
  await sendAccountLink(String(req.params.id), u.passwordHash ? 'reset' : 'invite', req.staff!.id);
  res.status(202).json({ sent: true });
});

export default router;
