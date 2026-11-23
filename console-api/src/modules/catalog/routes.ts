import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { MODULE_KEYS } from '@contracts/modules';
import { prisma } from '../../kernel/db';
import { AppError } from '../../kernel/errors';
import { audit } from '../../kernel/audit';
import { validate } from '../../middleware/request';
import { allow, requireStaff } from '../../middleware/auth';
import { issueLicence } from '../licences/service';

// Plans and coupons. Everyone signed in reads the plans (to offer them); only Admin edits.
// Changing a plan's modules or limits issues fresh licences to every business on it.

const router = Router();
router.use(requireStaff);

router.get('/plans', async (_req, res) => {
  const plans = await prisma.plan.findMany({ orderBy: { sortOrder: 'asc' }, include: { _count: { select: { subscriptions: true } } } });
  res.json({ data: plans.map(({ _count, ...p }) => ({ ...p, businesses: _count.subscriptions })) });
});

const Limits = z.object({
  users: z.number().int().min(1).max(10_000),
  branches: z.number().int().min(1).max(1000),
  contacts: z.number().int().min(1).nullable(),
  items: z.number().int().min(1).nullable(),
  invoicesPerMonth: z.number().int().min(1).nullable(),
  storageMb: z.number().int().min(100).max(10_000_000),
  aiCredits: z.number().int().min(0),
});
const PlanInput = z.object({
  name: z.string().trim().min(2).max(40),
  tagline: z.string().trim().max(120),
  monthlyPaise: z.number().int().min(0).nullable(),
  yearlyPaise: z.number().int().min(0).nullable(),
  limits: Limits,
  modules: z.array(z.enum(MODULE_KEYS)).max(MODULE_KEYS.length),
  isPublic: z.boolean(),
  active: z.boolean(),
});

router.put('/plans/:key', allow('admin'), validate(z.object({ key: z.string().regex(/^[a-z_]{2,40}$/) }), 'params'), validate(PlanInput.partial()), async (req, res) => {
  const key = String(req.params.key);
  const out = await prisma.$transaction(async (tx) => {
    const before = await tx.plan.findUnique({ where: { key } });
    if (!before) throw new AppError('NOT_FOUND', 'Plan not found.');
    const p = await tx.plan.update({ where: { key }, data: req.body as Prisma.PlanUpdateInput });
    // Modules or limits changed: every business on the plan gets a licence that says so
    if (req.body.modules || req.body.limits) {
      const subs = await tx.subscription.findMany({ where: { planKey: key, status: { notIn: ['closed'] } }, select: { businessId: true } });
      for (const s of subs) await issueLicence(tx, s.businessId);
    }
    await audit({ actorId: req.staff!.id, action: 'plan.updated', entity: 'plan', entityId: key, before, after: p }, tx);
    return p;
  }, { timeout: 60_000 });
  res.json(out);
});

router.get('/coupons', allow('admin', 'staff', 'sales'), async (_req, res) => {
  res.json({ data: await prisma.coupon.findMany({ orderBy: { createdAt: 'desc' } }) });
});

const CouponInput = z
  .object({
    code: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{3,20}$/, '3–20 letters, digits or -'),
    percentOff: z.number().int().min(1).max(100).nullish(),
    amountOffPaise: z.number().int().min(100).nullish(),
    validUntil: z.string().datetime().nullish(),
    maxUses: z.number().int().min(1).nullish(),
    planKeys: z.array(z.string()).default([]),
  })
  .refine((c) => !!c.percentOff !== !!c.amountOffPaise, { message: 'Give a percent or an amount off, not both', path: ['percentOff'] });

router.post('/coupons', allow('admin'), validate(CouponInput), async (req, res) => {
  const c = await prisma.coupon.create({ data: { ...req.body, validUntil: req.body.validUntil ? new Date(req.body.validUntil) : null, createdById: req.staff!.id } });
  await audit({ actorId: req.staff!.id, action: 'coupon.created', entity: 'coupon', entityId: c.code, after: c });
  res.status(201).json(c);
});

router.patch('/coupons/:code', allow('admin'), validate(z.object({ active: z.boolean() })), async (req, res) => {
  const c = await prisma.coupon.update({ where: { code: String(req.params.code) }, data: { active: req.body.active } });
  await audit({ actorId: req.staff!.id, action: c.active ? 'coupon.on' : 'coupon.off', entity: 'coupon', entityId: c.code });
  res.json(c);
});

export default router;
