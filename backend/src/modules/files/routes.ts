import express, { Router, type Request } from 'express';
import { z } from 'zod';
import { requirePermission, tenantAuth, tx } from '../../middleware/auth';
import { validate } from '../../middleware/request';
import { getRolePermissions } from '../access/service';
import { withPlatform } from '../../kernel/db';
import { AppError } from '../../kernel/errors';
import { BRANDING_FIELDS, signedFilePath, storage, verifyFileSignature } from '../../kernel/storage';
import { db } from '../../kernel/db';
import { assertUnused, fileLibrary, storageUsage } from './usage';
import * as files from './service';

// Upload: the file is the request body (no multipart); its name rides in X-File-Name.
const raw = express.raw({ type: () => true, limit: '11mb' });
const UploadQuery = z.object({
  kind: z.enum(['image', 'document']).default('document'),
  entityType: z.string().regex(/^[a-z_]{2,32}$/).optional(),
  entityId: z.string().uuid().optional(),
  field: z.string().regex(/^[a-z_]{2,32}$/).optional(),
});
const ListQuery = z.object({ entityType: z.string().regex(/^[a-z_]{2,32}$/), entityId: z.string().uuid(), field: z.string().regex(/^[a-z_]{2,32}$/).optional() });
const AttachBody = z.object({ ids: z.array(z.string().uuid()).max(50), entityType: z.string().regex(/^[a-z_]{2,32}$/), entityId: z.string().uuid(), field: z.string().regex(/^[a-z_]{2,32}$/).optional() });
const LinksBody = z.object({ refs: z.array(z.string().max(500)).max(200) });
const IdParam = z.object({ id: z.string().uuid() });

const fileName = (req: Request) => {
  const h = req.header('x-file-name');
  if (!h) throw new AppError('VALIDATION_FAILED', 'The file has no name.');
  try {
    return decodeURIComponent(h);
  } catch {
    return h;
  }
};
const body = (req: Request) => (Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0));

// ── Public: open a file through its signed link (an <img>, a download, a print page) ──
export const publicFiles = Router();
publicFiles.get('/files/raw/:id', validate(IdParam, 'params'), async (req, res) => {
  const id = String(req.params.id);
  if (!verifyFileSignature(id, Number(req.query.e), String(req.query.s ?? ''))) throw new AppError('PERMISSION_DENIED', 'This link has run out. Open the file again from the app.');
  const { file, bytes } = await withPlatform(() => files.readForLink(id));
  res.setHeader('Content-Type', file.mime);
  res.setHeader('Content-Length', String(bytes.length));
  res.setHeader('Content-Disposition', `${file.mime.startsWith('image/') || file.mime === 'application/pdf' ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(file.name)}`);
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // Shown inside the app (another port in development)
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.end(bytes);
});

// A logo or signature: public by nature (printed on every bill), so a stable link that never runs
// out, also frozen on issued invoices. Any other file is not served here.
publicFiles.get('/files/public/:id', validate(IdParam, 'params'), async (req, res) => {
  const { file, bytes } = await withPlatform(() => files.readForLink(String(req.params.id)));
  if (!(BRANDING_FIELDS as readonly string[]).includes(file.field)) throw new AppError('NOT_FOUND', 'File not found.');
  res.setHeader('Content-Type', file.mime);
  res.setHeader('Content-Length', String(bytes.length));
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.end(bytes);
});

// ── A business's files (every member may add files to what they work on; RLS keeps them to the business) ──
const router = Router();
router.use(tenantAuth);

router.post('/files', raw, validate(UploadQuery, 'query'), tx(async (req, res) => {
  const q = req.query as unknown as z.infer<typeof UploadQuery>;
  res.status(201).json(await files.saveUpload({ tenantId: req.ctx!.tenantId, userId: req.ctx!.userId, bytes: body(req), name: fileName(req), kind: q.kind, entityType: q.entityType, entityId: q.entityId, field: q.field }));
}));
router.get('/files', validate(ListQuery, 'query'), tx(async (req, res) => {
  const q = req.query as unknown as z.infer<typeof ListQuery>;
  res.json({ data: await files.listFiles(req.ctx!.tenantId, q.entityType, q.entityId, q.field) });
}));
router.post('/files/attach', validate(AttachBody), tx(async (req, res) => {
  res.json({ attached: await files.attachFiles(req.ctx!.tenantId, req.ctx!.userId, req.body.ids, req.body.entityType, req.body.entityId, req.body.field) });
}));
router.post('/files/links', validate(LinksBody), tx(async (req, res) => {
  res.json({ data: await files.linksFor(req.ctx!.tenantId, req.body.refs) });
}));
// Settings › Files & storage: every file of the business, where it is used, and the storage left
router.get('/files/library', requirePermission('tenant.file.view'), tx(async (req, res) => {
  res.json(await fileLibrary(req.ctx!.tenantId, (id) => signedFilePath(id)));
}));
router.get('/files/usage', requirePermission('tenant.file.view'), tx(async (req, res) => {
  res.json(await storageUsage(req.ctx!.tenantId));
}));
router.delete('/files/library/:id', requirePermission('tenant.file.delete'), validate(IdParam, 'params'), tx(async (req, res) => {
  const f = await assertUnused(req.ctx!.tenantId, String(req.params.id));
  await db().storedFile.delete({ where: { id: f.id } });
  // The row is gone first: if the bytes can't be removed now, the disk keeps an orphan, never a broken record
  await storage.remove(f.storageKey).catch(() => undefined);
  res.status(204).end();
}));

router.delete('/files/:id', validate(IdParam, 'params'), tx(async (req, res) => {
  const canManage = (await getRolePermissions(req.ctx!.roleId)).has('tenant.settings.edit');
  await files.removeFile(req.ctx!.tenantId, String(req.params.id), req.ctx!.userId, canManage);
  res.status(204).end();
}));

export default router;
