import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it, vi } from 'vitest';

// Uploads check the plan's storage; the plan is read outside the test's transaction, so it is
// given here: 20 GB (Professional)
vi.mock('../modules/subscription/entitlements', async (orig) => ({
  ...(await orig<typeof import('../modules/subscription/entitlements')>()),
  getEntitlements: async () => ({ limits: { storageMb: 20480 }, modules: {}, status: 'active' }),
}));
import { prisma, db, withPlatform } from '../kernel/db';
import type { TenantCtx } from '../kernel/context';
import { todayIST } from '../kernel/gst';
import { signedFilePath, verifyFileSignature } from '../kernel/storage';
import * as fin from '../modules/finance/service';
import * as files from '../modules/files/service';
import { alertIfNearlyFull, assertUnused } from '../modules/files/usage';

// Uploaded photos and documents: only real PDFs, photos, Word and Excel are taken; links are
// signed and run out; files are tied to records; and expenses above the business's amount
// need their bill attached.

class Rollback extends Error {}
async function rolledBack(fn: () => Promise<void>) {
  try {
    await withPlatform(async () => { await fn(); throw new Rollback(); }, { kind: 'platform' }, { timeoutMs: 120_000 });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
}
afterAll(() => prisma.$disconnect());

const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);

async function prepare() {
  const n = String(Math.floor(Math.random() * 1e9)).padStart(9, '0');
  const user = await db().user.create({ data: { name: 'Files', email: `files-${n}@example.test`, mobile: `+917${n}` } });
  const tenant = await db().tenant.create({ data: { name: `Files ${n}`, industryKey: 'general', templateVersion: 1, ownerUserId: user.id, billingStateCode: '09' } });
  const roleId = (await prisma.role.findFirstOrThrow({ where: { key: 'owner', tenantId: null }, select: { id: true } })).id;
  const ctx: TenantCtx = { kind: 'tenant', tenantId: tenant.id, userId: user.id, memberId: randomUUID(), roleId, sessionId: randomUUID(), branchIds: [], scope: 'all' };
  return { ctx, tenant };
}

describe('files', () => {
  it('takes real PDFs and photos only, judged by their bytes', () => {
    expect(files.sniff(PDF, 'bill.pdf')).toBe('application/pdf');
    expect(files.sniff(PNG, 'photo.png')).toBe('image/png');
    expect(files.sniff(Buffer.from('hello'), 'bill.pdf')).toBeNull();
    // A zip is Word only when it is named .docx
    const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]);
    expect(files.sniff(zip, 'a.docx')).toContain('wordprocessingml');
    expect(files.sniff(zip, 'a.zip')).toBeNull();
  });

  it('signs links that run out', () => {
    const id = randomUUID();
    const url = new URL(`http://x${signedFilePath(id)}`);
    expect(verifyFileSignature(id, Number(url.searchParams.get('e')), url.searchParams.get('s')!)).toBe(true);
    expect(verifyFileSignature(randomUUID(), Number(url.searchParams.get('e')), url.searchParams.get('s')!)).toBe(false);
    expect(verifyFileSignature(id, Math.floor(Date.now() / 1000) - 10, url.searchParams.get('s')!)).toBe(false);
  });

  it('saves a file, ties it to a record, lists it and refuses a wrong type', async () => {
    await rolledBack(async () => {
      const { ctx } = await prepare();
      await expect(files.saveUpload({ tenantId: ctx.tenantId, userId: ctx.userId, bytes: Buffer.from('not a pdf'), name: 'x.pdf', kind: 'document' })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
      await expect(files.saveUpload({ tenantId: ctx.tenantId, userId: ctx.userId, bytes: PDF, name: 'x.pdf', kind: 'image' })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
      const f = await files.saveUpload({ tenantId: ctx.tenantId, userId: ctx.userId, bytes: PDF, name: 'GST certificate.pdf', kind: 'document' });
      expect(f).toMatchObject({ ref: `file:${f.id}`, mime: 'application/pdf', size: PDF.length });
      const customerId = randomUUID();
      expect(await files.attachFiles(ctx.tenantId, ctx.userId, [f.id], 'customer', customerId)).toBe(1);
      // Already tied: not moved again
      expect(await files.attachFiles(ctx.tenantId, ctx.userId, [f.id], 'customer', randomUUID())).toBe(0);
      expect((await files.listFiles(ctx.tenantId, 'customer', customerId)).map((x) => x.name)).toEqual(['GST certificate.pdf']);
      const links = await files.linksFor(ctx.tenantId, [f.ref, 'https://example.com/a.pdf', 'file:00000000-0000-0000-0000-000000000000']);
      expect(links[f.ref]?.url).toContain(`/files/raw/${f.id}`);
      expect(links['https://example.com/a.pdf']?.url).toBe('https://example.com/a.pdf');
      expect(links['file:00000000-0000-0000-0000-000000000000']).toBeNull();
      // Another business can't reach it
      expect((await files.linksFor(randomUUID(), [f.ref]))[f.ref]).toBeNull();
      await files.removeFile(ctx.tenantId, f.id, ctx.userId, false);
      expect(await files.listFiles(ctx.tenantId, 'customer', customerId)).toEqual([]);
    });
  });

  it('needs the bill on expenses above the amount set in Finance', async () => {
    await rolledBack(async () => {
      const { ctx, tenant } = await prepare();
      const accounts = await fin.ensureFinance(ctx);
      const bank = accounts.find((a) => a.kind === 'bank')!;
      await db().tenant.update({ where: { id: tenant.id }, data: { preferences: { finance: { receiptRequiredAbovePaise: 200_000 } } } });
      const base = { category: 'Rent', paidOn: todayIST(), accountId: bank.id };
      // Under the amount: no bill needed
      await fin.createExpense(ctx, fin.ExpenseInput.parse({ ...base, amountPaise: 150_000 }));
      await expect(fin.createExpense(ctx, fin.ExpenseInput.parse({ ...base, amountPaise: 250_000 }))).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
      const bill = await files.saveUpload({ tenantId: ctx.tenantId, userId: ctx.userId, bytes: PDF, name: 'rent.pdf', kind: 'document' });
      const e = await fin.createExpense(ctx, fin.ExpenseInput.parse({ ...base, amountPaise: 250_000, receiptUrl: bill.ref }));
      expect(e.receiptUrl).toBe(bill.ref);
    });
  });
  it('tells the owner once when storage passes 80%, and never deletes a file in use', async () => {
    await rolledBack(async () => {
      const { ctx, tenant } = await prepare();
      const MB = 1024 * 1024;
      const before = { usedBytes: 70 * MB, files: 3, limitBytes: 100 * MB, percent: 70 };
      await alertIfNearlyFull(tenant.id, before, 15 * MB);
      await alertIfNearlyFull(tenant.id, before, 15 * MB);
      const sent = await db().notification.findMany({ where: { tenantId: tenant.id, userId: ctx.userId } });
      expect(sent.map((n) => n.title)).toEqual(['File storage is 80% used']);
      // Under 80% after the upload: no message
      await alertIfNearlyFull(tenant.id, { ...before, usedBytes: 10 * MB }, MB);
      expect(await db().notification.count({ where: { tenantId: tenant.id } })).toBe(1);

      const used = await files.saveUpload({ tenantId: null, userId: ctx.userId, bytes: PDF, name: 'used.pdf', kind: 'document', entityType: 'customer', entityId: randomUUID() });
      const loose = await files.saveUpload({ tenantId: null, userId: ctx.userId, bytes: PDF, name: 'loose.pdf', kind: 'document' });
      // Console-less files have no business; check through the same rule with tenant null stored rows
      await db().storedFile.updateMany({ where: { id: { in: [used.id, loose.id] } }, data: { tenantId: tenant.id } });
      await expect(assertUnused(tenant.id, used.id)).rejects.toMatchObject({ code: 'CONFLICT' });
      expect((await assertUnused(tenant.id, loose.id)).id).toBe(loose.id);
    });
  });
});
