// One-time (safe to run again): logos and item photos saved before file storage existed are data
// images inside the database. Each one is written to file storage and the row then keeps
// "file:<id>". A row that fails is reported and left as it was; nothing else is touched.
//   npm run files:move-images
import 'dotenv/config';
import { createHash } from 'node:crypto';
import { v7 as uuidv7 } from 'uuid';
import { prisma } from '../src/kernel/db';
import { storage } from '../src/kernel/storage';

const DATA_URL = /^data:(image\/(?:png|jpeg|webp|svg\+xml));base64,([A-Za-z0-9+/=]+)$/;
const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/svg+xml': 'svg' };

async function moveOne(tenantId: string, dataUrl: string, name: string, field: string, save: (ref: string) => Promise<void>) {
  const m = DATA_URL.exec(dataUrl);
  if (!m) return false;
  const [, mime, b64] = m;
  const bytes = Buffer.from(b64, 'base64');
  const id = uuidv7();
  const now = new Date();
  const storageKey = `${tenantId}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${id}`;
  await storage.put(storageKey, bytes, mime);
  try {
    await prisma.$transaction(async (tx) => {
      await tx.storedFile.create({ data: { id, tenantId, field, name: `${name}.${EXT[mime]}`, mime, sizeBytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), storageKey } });
      await save(`file:${id}`);
    });
  } catch (e) {
    // The row stays as it was: take the bytes back off storage
    await storage.remove(storageKey).catch(() => undefined);
    throw e;
  }
  return true;
}

async function main() {
  let moved = 0;
  let failed = 0;
  const tenants = await prisma.tenant.findMany({ where: { logoUrl: { startsWith: 'data:' } }, select: { id: true, name: true, logoUrl: true } });
  for (const t of tenants) {
    try {
      if (await moveOne(t.id, t.logoUrl!, 'logo', 'logo', async (ref) => { await prisma.tenant.update({ where: { id: t.id }, data: { logoUrl: ref } }); })) moved++;
    } catch (e) {
      failed++;
      console.error(`logo of ${t.name}:`, e instanceof Error ? e.message : e);
    }
  }
  const items = await prisma.item.findMany({ where: { imageUrl: { startsWith: 'data:' } }, select: { id: true, tenantId: true, name: true, imageUrl: true } });
  for (const i of items) {
    try {
      if (await moveOne(i.tenantId, i.imageUrl!, i.name.slice(0, 60) || 'photo', 'photo', async (ref) => { await prisma.item.update({ where: { id: i.id }, data: { imageUrl: ref } }); })) moved++;
    } catch (e) {
      failed++;
      console.error(`photo of item ${i.name}:`, e instanceof Error ? e.message : e);
    }
  }
  console.log(`moved ${moved} image(s) to file storage${failed ? `, ${failed} failed (left as they were)` : ''}`);
  await prisma.$disconnect();
  if (failed) process.exit(1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
