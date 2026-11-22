import { createHash } from 'node:crypto';
import { extname } from 'node:path';
import { v7 as uuidv7 } from 'uuid';
import { db } from '../../kernel/db';
import { AppError, notFound } from '../../kernel/errors';
import { FILE_REF } from '../../kernel/zodRules';
import { signedFilePath, storage } from '../../kernel/storage';

// Uploaded photos and documents. Only these types are taken, and the bytes must really be that
// type (checked from the file's first bytes, not just its name).

export const KINDS = {
  /** Photos: shrunk in the browser before upload; 5 MB is the hard stop */
  image: { maxBytes: 5 * 1024 * 1024, types: ['image/jpeg', 'image/png', 'image/webp'] },
  /** Documents: PDF, photos of papers, Word and Excel */
  document: {
    maxBytes: 10 * 1024 * 1024,
    types: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/msword', 'application/vnd.ms-excel'],
  },
} as const;
export type FileKind = keyof typeof KINDS;

/** What the bytes really are (null = not a type we take) */
export function sniff(bytes: Buffer, name: string): string | null {
  const ext = extname(name).toLowerCase();
  const head = bytes.subarray(0, 12);
  if (head.subarray(0, 4).toString('latin1') === '%PDF') return 'application/pdf';
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg';
  if (head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (head.subarray(0, 4).toString('latin1') === 'RIFF' && head.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  // Word and Excel files are zip (new) or OLE (old) containers; the name tells which one
  if (head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04) {
    if (ext === '.docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    if (ext === '.xlsx') return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  }
  if (head.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))) {
    if (ext === '.doc') return 'application/msword';
    if (ext === '.xls') return 'application/vnd.ms-excel';
  }
  return null;
}

const MB = (n: number) => `${Math.round(n / 1024 / 1024)} MB`;
const cleanName = (name: string) => name.replace(/[\u0000-\u001f<>:"/\\|?*]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200) || 'file';

export interface FileRow {
  id: string;
  ref: string;
  name: string;
  mime: string;
  size: number;
  field: string;
  url: string;
  createdAt: Date;
}

const toRow = (f: { id: string; name: string; mime: string; sizeBytes: number; field: string; createdAt: Date }): FileRow => ({
  id: f.id, ref: `file:${f.id}`, name: f.name, mime: f.mime, size: f.sizeBytes, field: f.field, url: signedFilePath(f.id), createdAt: f.createdAt,
});

export async function saveUpload(opts: {
  tenantId: string | null;
  userId: string | null;
  bytes: Buffer;
  name: string;
  kind: FileKind;
  entityType?: string | null;
  entityId?: string | null;
  field?: string | null;
}): Promise<FileRow> {
  const rule = KINDS[opts.kind];
  const name = cleanName(opts.name);
  if (!opts.bytes.length) throw new AppError('VALIDATION_FAILED', 'The file is empty.');
  if (opts.bytes.length > rule.maxBytes) throw new AppError('VALIDATION_FAILED', `The file is larger than ${MB(rule.maxBytes)}.`);
  const mime = sniff(opts.bytes, name);
  if (!mime || !(rule.types as readonly string[]).includes(mime)) {
    throw new AppError('VALIDATION_FAILED', opts.kind === 'image' ? 'Use a JPG, PNG or WebP photo.' : 'Use a PDF, photo (JPG, PNG, WebP), Word or Excel file.');
  }
  const id = uuidv7();
  const now = new Date();
  const storageKey = `${opts.tenantId ?? 'console'}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${id}`;
  await storage.put(storageKey, opts.bytes, mime);
  const f = await db().storedFile.create({
    data: {
      id, tenantId: opts.tenantId, entityType: opts.entityType ?? null, entityId: opts.entityId ?? null, field: opts.field || 'attachments',
      name, mime, sizeBytes: opts.bytes.length, sha256: createHash('sha256').update(opts.bytes).digest('hex'), storageKey, uploadedBy: opts.userId,
    },
  });
  return toRow(f);
}

/** The files on a record (row-level security keeps it to this business) */
export async function listFiles(tenantId: string | null, entityType: string, entityId: string, field?: string) {
  const rows = await db().storedFile.findMany({ where: { tenantId, entityType, entityId, ...(field ? { field } : {}) }, orderBy: { createdAt: 'asc' } });
  return rows.map(toRow);
}

/** Files uploaded while the record was being made are tied to it once it is saved */
export async function attachFiles(tenantId: string | null, userId: string, ids: string[], entityType: string, entityId: string, field?: string) {
  if (!ids.length) return 0;
  const { count } = await db().storedFile.updateMany({
    // Only files nobody has tied to a record yet, uploaded by this person
    where: { id: { in: ids }, tenantId, uploadedBy: userId, entityId: null },
    data: { entityType, entityId, ...(field ? { field } : {}) },
  });
  return count;
}

export async function removeFile(tenantId: string | null, id: string, userId: string, canManage: boolean) {
  const f = await db().storedFile.findFirst({ where: { id, tenantId } });
  if (!f) throw notFound('File');
  if (f.uploadedBy !== userId && !canManage) throw new AppError('PERMISSION_DENIED', 'Only the person who added this file or an admin can remove it.');
  await db().storedFile.delete({ where: { id } });
  await storage.remove(f.storageKey).catch(() => undefined);
}

/** Links that open each "file:<id>" (and pass ordinary links through), for showing saved records */
export async function linksFor(tenantId: string | null, refs: string[]) {
  const ids = [...new Set(refs.filter((r) => FILE_REF.test(r)).map((r) => r.slice(5).toLowerCase()))];
  const rows = ids.length ? await db().storedFile.findMany({ where: { id: { in: ids }, tenantId }, select: { id: true, name: true, mime: true, sizeBytes: true, field: true, createdAt: true } }) : [];
  const out: Record<string, { url: string; name: string; mime: string; size: number } | null> = {};
  for (const r of refs) {
    if (!FILE_REF.test(r)) out[r] = /^https?:\/\//i.test(r) ? { url: r, name: r.split('/').pop() || 'Link', mime: '', size: 0 } : null;
    else {
      const f = rows.find((x) => x.id === r.slice(5).toLowerCase());
      out[r] = f ? { url: signedFilePath(f.id), name: f.name, mime: f.mime, size: f.sizeBytes } : null;
    }
  }
  return out;
}

/** The bytes behind a signed link (no login: the signature is the permission) */
export async function readForLink(id: string) {
  const f = await db().storedFile.findUnique({ where: { id } });
  if (!f) throw notFound('File');
  return { file: f, bytes: await storage.get(f.storageKey) };
}
