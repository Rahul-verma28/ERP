import { Router } from 'express';
import { z } from 'zod';
import { env } from '../../config/env';
import { db, prisma, withPlatform } from '../../kernel/db';
import { notFound } from '../../kernel/errors';
import { requireSigned } from '../../kernel/signedCalls';
import { validate } from '../../middleware/request';
import { readSetup } from '../tenancy/workspace';
import { createAccessLink } from '../identity/accessLinks';
import { applyLicence } from './service';
import { ProvisionInput, provisionWorkspace } from './provision';

// Provisioning API: the only way the Console changes or reads anything in this ERP. Every call is
// signed (kernel/signedCalls.ts). Mounted at /api/v1/internal/v1. See docs/architecture/console-erp-split.md.

const router = Router();
router.use(requireSigned(() => env.PROVISION_KEY));

const Id = z.object({ id: z.string().uuid() });

/** Set up a business the Console made: workspace, main branch, owner login, licence. Safe to retry. */
router.post('/tenants', validate(ProvisionInput), async (req, res) => {
  const out = await withPlatform(() => provisionWorkspace(req.body));
  res.status(out.created ? 201 : 200).json({ tenantId: out.tenantId, created: out.created, ownerLink: { url: out.ownerLink.url, expiresAt: out.ownerLink.expiresAt } });
});

/** Store a newer licence for a business (an older one is ignored) */
router.put('/tenants/:id/licence', validate(Id, 'params'), validate(z.object({ licence: z.string().min(50).max(20_000) })), async (req, res) => {
  const out = await withPlatform(() => applyLicence(req.body.licence, { tenantId: String(req.params.id), source: 'console' }));
  res.json({ applied: out.applied, status: out.licence.status, seq: out.licence.seq });
});

/** A fresh one-use setup link for the owner (handover, lost access); older ones stop working */
router.post('/tenants/:id/owner-link', validate(Id, 'params'), async (req, res) => {
  const out = await withPlatform(async () => {
    const t = await db().tenant.findUnique({ where: { id: String(req.params.id) }, select: { id: true, ownerUserId: true } });
    if (!t) throw notFound('Business');
    return createAccessLink({ kind: 'client_owner', userId: t.ownerUserId, tenantId: t.id, createdBy: null });
  });
  res.json({ url: out.url, expiresAt: out.expiresAt });
});

/** Facts the Console shows on a client: owner progress, team, activity and usage */
async function overviews(ids: string[]) {
  const month = new Date().toISOString().slice(0, 7);
  const [tenants, links, sessions, members, invites, branches, invoices, customers, licences, files] = await Promise.all([
    prisma.tenant.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, status: true, createdAt: true, onboarding: true, ownerUserId: true } }),
    prisma.accessLink.findMany({ where: { tenantId: { in: ids }, kind: 'client_owner' }, orderBy: { createdAt: 'desc' }, distinct: ['tenantId'], select: { tenantId: true, createdAt: true, usedAt: true } }),
    prisma.userSession.groupBy({ by: ['tenantId'], where: { tenantId: { in: ids } }, _max: { createdAt: true } }),
    prisma.tenantMember.groupBy({ by: ['tenantId'], where: { tenantId: { in: ids }, status: 'active' }, _count: true }),
    prisma.invitation.groupBy({ by: ['tenantId'], where: { tenantId: { in: ids }, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } }, _count: true }),
    prisma.branch.groupBy({ by: ['tenantId'], where: { tenantId: { in: ids } }, _count: true }),
    prisma.usageCounter.findMany({ where: { tenantId: { in: ids }, metric: 'invoices', period: month }, select: { tenantId: true, used: true } }),
    prisma.contact.groupBy({ by: ['tenantId'], where: { tenantId: { in: ids }, type: 'customer' }, _count: true }),
    prisma.tenantLicence.findMany({ where: { tenantId: { in: ids } }, select: { tenantId: true, seq: true, status: true, planKey: true, expiresAt: true } }),
    prisma.storedFile.groupBy({ by: ['tenantId'], where: { tenantId: { in: ids } }, _sum: { sizeBytes: true } }),
  ]);
  const owners = await prisma.user.findMany({ where: { id: { in: tenants.map((t) => t.ownerUserId) } }, select: { id: true, name: true, email: true, mobile: true, lastLoginAt: true } });
  const by = <T extends { tenantId: string | null }>(rows: T[]) => new Map(rows.map((r) => [r.tenantId!, r]));
  const [link, seen, team, invited, branchCount, invoiceCount, customerCount, licence, stored] = [by(links), by(sessions), by(members), by(invites), by(branches), by(invoices), by(customers), by(licences), by(files)];
  const out = [];
  for (const t of tenants) {
    const owner = owners.find((o) => o.id === t.ownerUserId);
    const setup = readSetup(t);
    out.push({
      id: t.id,
      name: t.name,
      status: t.status,
      createdAt: t.createdAt,
      owner: owner ? { name: owner.name, email: owner.email, mobile: owner.mobile, lastLoginAt: owner.lastLoginAt } : null,
      ownerLink: link.get(t.id) ? { sentAt: link.get(t.id)!.createdAt, usedAt: link.get(t.id)!.usedAt } : null,
      setupDone: !!setup.completedAt,
      lastActiveAt: seen.get(t.id)?._max.createdAt ?? null,
      team: { active: team.get(t.id)?._count ?? 0, invited: invited.get(t.id)?._count ?? 0, branches: branchCount.get(t.id)?._count ?? 0 },
      usage: { invoicesThisMonth: Number(invoiceCount.get(t.id)?.used ?? 0), customers: customerCount.get(t.id)?._count ?? 0, storageBytes: Number(stored.get(t.id)?._sum.sizeBytes ?? 0) },
      licence: licence.get(t.id) ? { seq: licence.get(t.id)!.seq, status: licence.get(t.id)!.status, plan: licence.get(t.id)!.planKey, expiresAt: licence.get(t.id)!.expiresAt } : null,
    });
  }
  return out;
}

router.get('/tenants/:id/overview', validate(Id, 'params'), async (req, res) => {
  const [one] = await overviews([String(req.params.id)]);
  if (!one) throw notFound('Business');
  res.json(one);
});

router.get('/tenants', validate(z.object({ ids: z.string().transform((v) => v.split(',')).pipe(z.array(z.string().uuid()).min(1).max(200)) }), 'query'), async (req, res) => {
  res.json({ data: await overviews((req.query as unknown as { ids: string[] }).ids) });
});

export default router;
