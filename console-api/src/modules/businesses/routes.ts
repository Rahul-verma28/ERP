import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../kernel/db';
import { validate } from '../../middleware/request';
import { allow, requireStaff } from '../../middleware/auth';
import { CreateInput, closeBusiness, createBusiness, extendTrial, findScoped, refreshFacts, reopenBusiness, resendOwnerLink, scopeOf, setModule, setPlan } from './service';

const router = Router();
router.use(requireStaff);

const Id = z.object({ id: z.string().uuid() });

const ListQuery = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(['incomplete', 'trialing', 'active', 'past_due', 'free', 'closed']).optional(),
  plan: z.string().max(40).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

router.get('/', validate(ListQuery, 'query'), async (req, res) => {
  const q = req.query as unknown as z.infer<typeof ListQuery>;
  const where: Prisma.BusinessWhereInput = {
    ...scopeOf(req.staff!),
    ...(q.q ? { OR: [{ name: { contains: q.q, mode: 'insensitive' } }, { ownerName: { contains: q.q, mode: 'insensitive' } }, { ownerEmail: { contains: q.q, mode: 'insensitive' } }, { ownerMobile: { contains: q.q } }, { gstin: { contains: q.q.toUpperCase() } }] } : {}),
    ...(q.status || q.plan ? { subscription: { ...(q.status ? { status: q.status } : {}), ...(q.plan ? { planKey: q.plan } : {}) } } : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.business.count({ where }),
    prisma.business.findMany({
      where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize,
      include: { subscription: { include: { plan: { select: { name: true } } } }, partner: { select: { name: true } }, onboarder: { select: { name: true } } },
    }),
  ]);
  res.json({ data: rows, total, page: q.page, pageSize: q.pageSize });
});

router.post('/', allow('admin', 'staff', 'sales', 'vendor', 'partner_owner', 'partner_staff'), validate(CreateInput), async (req, res) => {
  res.status(201).json(await createBusiness(req.staff!, req.body));
});

router.get('/:id', validate(Id, 'params'), async (req, res) => {
  const id = String(req.params.id);
  await findScoped(req.staff!, id);
  const [business, live] = await Promise.all([
    prisma.business.findUniqueOrThrow({
      where: { id },
      include: {
        subscription: { include: { plan: true } }, partner: { select: { id: true, name: true } }, onboarder: { select: { id: true, name: true, role: true } },
        overrides: true, notes: { orderBy: { createdAt: 'desc' }, take: 50 },
        licences: { orderBy: { seq: 'desc' }, take: 1, select: { seq: true, status: true, planKey: true, issuedAt: true, expiresAt: true, deliveredAt: true } },
      },
    }),
    refreshFacts(id),
  ]);
  const deliveries = await prisma.delivery.findMany({ where: { businessId: id, doneAt: null }, orderBy: { createdAt: 'desc' }, select: { kind: true, attempts: true, lastError: true, nextAttemptAt: true } });
  res.json({ ...business, facts: live.facts, factsLive: live.live, pending: deliveries });
});

const staffOnly = allow('admin', 'staff');

router.post('/:id/plan', staffOnly, validate(Id, 'params'), validate(z.object({ planKey: z.string().min(1), cycle: z.enum(['monthly', 'yearly']).default('monthly') })), async (req, res) => {
  res.json(await setPlan(req.staff!, String(req.params.id), req.body.planKey, req.body.cycle));
});
router.post('/:id/trial', staffOnly, validate(Id, 'params'), validate(z.object({ days: z.number().int().min(1, 'At least 1 day').max(60, 'At most 60 days') })), async (req, res) => {
  res.json(await extendTrial(req.staff!, String(req.params.id), req.body.days));
});
router.post('/:id/close', staffOnly, validate(Id, 'params'), async (req, res) => {
  res.json(await closeBusiness(req.staff!, String(req.params.id)));
});
router.post('/:id/reopen', staffOnly, validate(Id, 'params'), async (req, res) => {
  res.json(await reopenBusiness(req.staff!, String(req.params.id)));
});
router.put(
  '/:id/modules/:moduleKey',
  staffOnly,
  validate(z.object({ id: z.string().uuid(), moduleKey: z.string().min(2).max(30) }), 'params'),
  validate(z.object({ state: z.enum(['on', 'off']).nullable(), until: z.string().datetime().nullish() })),
  async (req, res) => {
    await setModule(req.staff!, String(req.params.id), String(req.params.moduleKey), req.body.state, req.body.until ? new Date(req.body.until) : null);
    res.status(204).end();
  },
);
router.post('/:id/owner-link', validate(Id, 'params'), async (req, res) => {
  await resendOwnerLink(req.staff!, String(req.params.id));
  res.status(202).json({ queued: true });
});
router.post('/:id/notes', allow('admin', 'staff', 'sales', 'vendor'), validate(Id, 'params'), validate(z.object({ text: z.string().trim().min(1, 'Write the note').max(2000) })), async (req, res) => {
  await findScoped(req.staff!, String(req.params.id));
  res.status(201).json(await prisma.note.create({ data: { businessId: String(req.params.id), authorId: req.staff!.id, text: req.body.text } }));
});

export default router;
