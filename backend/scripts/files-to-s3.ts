import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { prisma } from '../src/kernel/db';
import { env } from '../src/config/env';
import { storage, storageKind } from '../src/kernel/storage';

// One-time move: files uploaded while they were kept on this computer are copied to the S3 bucket
// (same keys), so links keep working after S3_BUCKET is set. Safe to run again: files already in
// the bucket are skipped. The copies on disk are left as they are.
//   npm run files:to-s3

async function main() {
  if (storageKind !== 'S3') throw new Error('Set S3_BUCKET (and the S3 keys) in .env first.');
  const dir = process.env.STORAGE_DIR || join(__dirname, '..', 'storage');
  const s3 = new S3Client({ region: env.S3_REGION, ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT } : {}), credentials: { accessKeyId: env.S3_ACCESS_KEY_ID!, secretAccessKey: env.S3_SECRET_ACCESS_KEY! } });
  const files = await prisma.storedFile.findMany({ select: { storageKey: true, mime: true } });
  let copied = 0, there = 0, missing = 0;
  for (const f of files) {
    try {
      await s3.send(new HeadObjectCommand({ Bucket: env.S3_BUCKET!, Key: f.storageKey }));
      there++;
      continue;
    } catch {
      // not in the bucket yet
    }
    const path = join(dir, f.storageKey);
    if (!existsSync(path)) {
      missing++;
      continue;
    }
    await storage.put(f.storageKey, await readFile(path), f.mime);
    copied++;
  }
  console.log(`${files.length} files: ${copied} copied to S3, ${there} already there, ${missing} not on this computer`);
}

main().then(() => process.exit(0), (e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
