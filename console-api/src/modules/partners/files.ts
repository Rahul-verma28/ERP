import express, { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../kernel/db';
import { AppError } from '../../kernel/errors';
import { audit } from '../../kernel/audit';
import { sniff, storage } from '../../kernel/storage';
import { validate } from '../../middleware/request';
import { allow, requireStaff } from '../../middleware/auth';

// KYC papers on applications and partners. Admin and Staff add and read them; a partner owner may
// add and read its own. PDF, JPG, PNG or WebP, up to 10 MB, the type checked from the file itself.

const MAX = 10 * 1024 * 1024;
const router = Router();
router.use(requireStaff);
const raw = express.raw({ type: () => true, limit: '11mb' });
const Target = z.object({ entityType: z.enum(['partner', 'application']), entityId: z.string().uuid() });

function canTouch(req: { staff?: { role: string; partnerId: string | null } }, entityType: string, entityId: string) {
  const role = req.staff!.role;
  if (role === 'admin' || role === 'staff') return;
  if (role === 'partner_owner' && entityType === 'partner' && req.staff!.partnerId === entityId) return;
  throw new AppError('PERMISSION_DENIED', 'Your role can’t open these papers.');
}

router.get('/', validate(Target, 'query'), async (req, res) => {
  const q = req.query as unknown as z.infer<typeof Target>;
  canTouch(req, q.entityType, q.entityId);
  res.json({ data: await prisma.consoleFile.findMany({ where: q, orderBy: { createdAt: 'desc' }, select: { id: true, name: true, mime: true, sizeBytes: true, createdAt: true } }) });
});

router.post('/', allow('admin', 'staff', 'partner_owner'), raw, validate(Target, 'query'), async (req, res) => {
  const q = req.query as unknown as z.infer<typeof Target>;
  canTouch(req, q.entityType, q.entityId);
  const exists = q.entityType === 'partner' ? await prisma.partner.findUnique({ where: { id: q.entityId }, select: { id: true } }) : await prisma.application.findUnique({ where: { id: q.entityId }, select: { id: true } });
  if (!exists) throw new AppError('NOT_FOUND', 'Not found.');
  const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  if (!bytes.length) throw new AppError('VALIDATION_FAILED', 'The file is empty.');
  if (bytes.length > MAX) throw new AppError('VALIDATION_FAILED', 'Use a file up to 10 MB.');
  const kind = sniff(bytes);
  if (!kind) throw new AppError('VALIDATION_FAILED', 'Use a PDF, JPG, PNG or WebP file.');
  let name = 'document';
  try {
    name = decodeURIComponent(req.header('x-file-name') ?? 'document').replace(/[^\w.\- ()]/g, '_').slice(0, 120) || 'document';
  } catch {
    // keep the plain name
  }
  const file = await prisma.consoleFile.create({ data: { entityType: q.entityType, entityId: q.entityId, name, mime: kind.mime, sizeBytes: bytes.length, storageKey: `kyc/${q.entityType}/${q.entityId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${kind.ext}`, uploadedById: req.staff!.id } });
  try {
    await storage.put(file.storageKey, bytes, kind.mime);
  } catch (e) {
    await prisma.consoleFile.delete({ where: { id: file.id } });
    throw new AppError('PROVIDER_UNAVAILABLE', `The file couldn't be stored (${e instanceof Error ? e.message : e}).`);
  }
  await audit({ actorId: req.staff!.id, action: 'file.added', entity: q.entityType, entityId: q.entityId, after: { name, sizeBytes: bytes.length } });
  res.status(201).json({ id: file.id, name: file.name, mime: file.mime, sizeBytes: file.sizeBytes });
});

router.get('/:id', validate(z.object({ id: z.string().uuid() }), 'params'), async (req, res) => {
  const f = await prisma.consoleFile.findUnique({ where: { id: String(req.params.id) } });
  if (!f) throw new AppError('NOT_FOUND', 'File not found.');
  canTouch(req, f.entityType, f.entityId);
  const bytes = await storage.get(f.storageKey).catch(() => {
    throw new AppError('NOT_FOUND', 'File not found.');
  });
  res.setHeader('Content-Type', f.mime);
  res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(f.name)}`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, no-store');
  res.end(bytes);
});

router.delete('/:id', allow('admin'), validate(z.object({ id: z.string().uuid() }), 'params'), async (req, res) => {
  const f = await prisma.consoleFile.delete({ where: { id: String(req.params.id) } });
  await storage.remove(f.storageKey).catch(() => undefined);
  await audit({ actorId: req.staff!.id, action: 'file.removed', entity: f.entityType, entityId: f.entityId, after: { name: f.name } });
  res.status(204).end();
});

export default router;
