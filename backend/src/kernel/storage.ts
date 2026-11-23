import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { env } from '../config/env';

/**
 * Where uploaded files' bytes live: Amazon S3 (or Cloudflare R2) when S3_BUCKET is set, otherwise
 * a folder on this computer (STORAGE_DIR, default backend/storage). Same three calls either way,
 * so nothing that uploads or shows a file changes. Tests always use the folder.
 */
export interface FileStorage {
  put(key: string, bytes: Buffer, mime: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
}

class LocalDiskStorage implements FileStorage {
  constructor(private readonly root: string) {}
  private path(key: string) {
    const p = resolve(this.root, key);
    // Keys are made by us, but never let one point outside the storage folder
    if (!p.startsWith(resolve(this.root))) throw new Error('Bad storage key');
    return p;
  }
  async put(key: string, bytes: Buffer) {
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, bytes);
  }
  get(key: string) {
    return readFile(this.path(key));
  }
  async remove(key: string) {
    await rm(this.path(key), { force: true });
  }
}

class S3Storage implements FileStorage {
  private readonly client: S3Client;
  constructor(private readonly bucket: string) {
    this.client = new S3Client({
      region: env.S3_REGION,
      ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT } : {}),
      credentials: env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY ? { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY } : undefined,
    });
  }
  async put(key: string, bytes: Buffer, mime: string) {
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: bytes, ContentType: mime }));
  }
  async get(key: string) {
    const out = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!out.Body) throw new Error('Empty file');
    return Buffer.from(await out.Body.transformToByteArray());
  }
  async remove(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

const testing = env.NODE_ENV === 'test' || !!process.env.VITEST;
export const storageKind: 'S3' | 'disk' = env.S3_BUCKET && !testing ? 'S3' : 'disk';
export const storage: FileStorage = storageKind === 'S3' ? new S3Storage(env.S3_BUCKET!) : new LocalDiskStorage(process.env.STORAGE_DIR || join(__dirname, '..', '..', 'storage'));

// ── Signed links: a file opens without a login header (an <img>, a new tab, a print page) only
// through a link that names it and runs out ──

const sign = (id: string, exp: number) => createHmac('sha256', env.JWT_SECRET).update(`file:${id}:${exp}`).digest('base64url');

/** A link to the file that works for `ttlSeconds` (default 2 hours) */
export function signedFilePath(id: string, ttlSeconds = 2 * 3600) {
  // Rounded to the hour so the same file gives the same link for a while (browsers can cache it)
  const exp = Math.ceil((Date.now() / 1000 + ttlSeconds) / 3600) * 3600;
  return `/api/v1/files/raw/${id}?e=${exp}&s=${sign(id, exp)}`;
}

export function verifyFileSignature(id: string, exp: number, sig: string) {
  if (!Number.isFinite(exp) || exp * 1000 < Date.now()) return false;
  const a = Buffer.from(sign(id, exp));
  const b = Buffer.from(sig);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Files that are public by nature: they print on every bill and show on public pages */
export const BRANDING_FIELDS = ['logo', 'signature'] as const;

/**
 * A business logo or signature as a link any page can show, also frozen on issued invoices: an
 * uploaded file ("file:<id>") gets a stable link that never runs out (served only for logo and
 * signature files, see files/routes.ts); older data images and links pass through.
 */
export function publicLink(ref: string | null | undefined): string | null {
  if (!ref) return null;
  return /^file:[0-9a-f-]{36}$/i.test(ref) ? `/api/v1/files/public/${ref.slice(5).toLowerCase()}` : ref;
}
