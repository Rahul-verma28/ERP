import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { env, testing } from '../config/env';

// Where the Console keeps papers (partner KYC): Amazon S3 under console/ when S3_BUCKET is set,
// otherwise a folder on this computer. Tests always use the folder.

export interface FileStorage {
  put(key: string, bytes: Buffer, mime: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
}

class Disk implements FileStorage {
  constructor(private readonly root: string) {}
  private path(key: string) {
    const p = resolve(this.root, key);
    if (!p.startsWith(resolve(this.root))) throw new Error('Bad storage key');
    return p;
  }
  async put(key: string, bytes: Buffer) {
    await mkdir(dirname(this.path(key)), { recursive: true });
    await writeFile(this.path(key), bytes);
  }
  get(key: string) {
    return readFile(this.path(key));
  }
  async remove(key: string) {
    await rm(this.path(key), { force: true });
  }
}

class S3 implements FileStorage {
  private readonly client = new S3Client({
    region: env.S3_REGION,
    ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT } : {}),
    credentials: env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY ? { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY } : undefined,
  });
  constructor(private readonly bucket: string) {}
  async put(key: string, bytes: Buffer, mime: string) {
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: `console/${key}`, Body: bytes, ContentType: mime }));
  }
  async get(key: string) {
    const out = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: `console/${key}` }));
    if (!out.Body) throw new Error('Empty file');
    return Buffer.from(await out.Body.transformToByteArray());
  }
  async remove(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: `console/${key}` }));
  }
}

export const storage: FileStorage = env.S3_BUCKET && !testing ? new S3(env.S3_BUCKET) : new Disk(process.env.STORAGE_DIR || join(__dirname, '..', '..', 'storage'));

/** What a file really is, from its first bytes (never trust the name or the browser's word) */
export function sniff(bytes: Buffer): { mime: string; ext: string } | null {
  if (bytes.subarray(0, 5).toString('latin1') === '%PDF-') return { mime: 'application/pdf', ext: 'pdf' };
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: 'image/png', ext: 'png' };
  if (bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP') return { mime: 'image/webp', ext: 'webp' };
  return null;
}
