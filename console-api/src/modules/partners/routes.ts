import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../kernel/db';
import { AppError } from '../../kernel/errors';
import { audit } from '../../kernel/audit';
import { validate } from '../../middleware/request';
import { allow, PARTNER_ROLES, requireStaff } from '../../middleware/auth';
import { sendAccountLink } from '../auth/service';
import { PartnerInput, PartnerPatch, createPartner, markBillPaid, sendPartnerBill, statement, updatePartner } from './service';

const router = Router();
router.use(requireStaff);
const Id = z.object({ id: z.string().uuid() });

/** AHEAD's team works with any partner; a partner's people only with their own */
function partnerScope(req: { staff?: { role: string; partnerId: string | null } }, id: string) {
  if (PARTNER_ROLES.includes(req.staff!.role as never) && req.staff!.partnerId !== id) throw new AppError('NOT_FOUND', 'Partner not found.');
}

router.get('/', allow('admin', 'staff'), async (_req, res) => {
  const rows = await prisma.partner.findMany({ orderBy: { name: 'asc' }, include: { _count: { select: { businesses: true, users: { where: { status: 'active' } } } } } });
  const live = await prisma.business.groupBy({ by: ['partnerId'], where: { partnerId: { in: rows.map((r) => r.id) }, subscription: { status: { in: ['trialing', 'active', 'past_due'] } } }, _count: true });
  const unpaid = await prisma.partnerBill.groupBy({ by: ['partnerId'], where: { status: 'awaiting_payment' }, _sum: { totalPaise: true } });
  res.json({
    data: rows.map(({ _count, ...p }) => ({
      ...p, discountPct: p.discountBp / 100, businesses: _count.businesses, people: _count.users,
      liveBusinesses: live.find((l) => l.partnerId === p.id)?._count ?? 0, unpaidPaise: unpaid.find((u) => u.partnerId === p.id)?._sum.totalPaise ?? 0,
    })),
  });
});

router.post('/', allow('admin'), validate(PartnerInput), async (req, res) => {
  const out = await prisma.$transaction((tx) => createPartner(req.staff!.id, req.body, tx));
  // The invite goes out once the partner is saved
  await sendAccountLink(out.ownerId, 'invite', req.staff!.id);
  res.status(201).json(out.partner);
});

/** One partner: details, people, clients, bills, KYC papers and this month so far */
router.get('/:id', allow('admin', 'staff', 'partner_owner', 'partner_staff'), validate(Id, 'params'), async (req, res) => {
  const id = String(req.params.id);
  partnerScope(req, id);
  const [partner, people, businesses, bills, files, now] = await Promise.all([
    prisma.partner.findUnique({ where: { id } }),
    prisma.consoleUser.findMany({ where: { partnerId: id }, orderBy: { createdAt: 'asc' }, select: { id: true, name: true, email: true, role: true, status: true, lastLoginAt: true } }),
    prisma.business.findMany({ where: { partnerId: id }, orderBy: { createdAt: 'desc' }, include: { subscription: { select: { status: true, planKey: true, trialEndsAt: true, plan: { select: { name: true } } } } } }),
    prisma.partnerBill.findMany({ where: { partnerId: id }, orderBy: { month: 'desc' }, take: 24 }),
    prisma.consoleFile.findMany({ where: { entityType: 'partner', entityId: id }, orderBy: { createdAt: 'desc' }, select: { id: true, name: true, mime: true, sizeBytes: true, createdAt: true } }),
    statement(id).catch(() => null),
  ]);
  if (!partner) throw new AppError('NOT_FOUND', 'Partner not found.');
  res.json({ ...partner, discountPct: partner.discountBp / 100, people, businesses, bills, files, thisMonth: now && { lines: now.lines, subtotalPaise: now.subtotalPaise, totalPaise: now.totalPaise } });
});

router.patch('/:id', allow('admin'), validate(Id, 'params'), validate(PartnerPatch), async (req, res) => {
  res.json(await updatePartner(req.staff!.id, String(req.params.id), req.body));
});

router.post('/bills/:id/link', allow('admin', 'staff', 'partner_owner'), validate(Id, 'params'), async (req, res) => {
  const b = await prisma.partnerBill.findUniqueOrThrow({ where: { id: String(req.params.id) }, select: { partnerId: true } });
  partnerScope(req, b.partnerId);
  res.json(await sendPartnerBill(String(req.params.id)));
});

/** Admin or Staff: a partner paid its bill outside the link (bank transfer, UPI, cheque) */
router.post('/bills/:id/paid', allow('admin', 'staff'), validate(Id, 'params'), validate(z.object({ reference: z.string().trim().min(3, 'Enter the UTR, UPI or cheque number').max(60) })), async (req, res) => {
  const paid = await prisma.$transaction((tx) => markBillPaid(tx, String(req.params.id), req.body.reference));
  if (!paid) throw new AppError('CONFLICT', 'This bill is already paid.');
  await audit({ actorId: req.staff!.id, action: 'partner_bill.recorded', entity: 'partner_bill', entityId: paid.id, after: { reference: req.body.reference } });
  res.json(paid);
});

export default router;
