import { Prisma } from '@prisma/client';
import { prisma, withPlatform } from '../../kernel/db';
import { fileReferences } from '../files/usage';
import { JobTally } from '../../kernel/jobs';
import { storage } from '../../kernel/storage';

// Hourly clean-up. Every step runs on its own (one failing never stops the others) and only
// removes what nothing points at any more; each is safe to run again.

const DAY = 86_400_000;
/** A file uploaded but not saved on any record is kept this long (a form left open, a draft) */
const UNUSED_FILE_DAYS = 2;
const BATCH = 200;

/** Every file id a record still points at (see files/usage.ts: found from the database itself) */
const referencedFileIds = async () => new Set((await withPlatform(() => fileReferences())).keys());

/** Files uploaded and never kept on a record (the form was closed, the file replaced) */
async function unusedFiles(tally: JobTally) {
  const before = new Date(Date.now() - UNUSED_FILE_DAYS * DAY);
  const candidates = await prisma.storedFile.findMany({ where: { entityId: null, createdAt: { lt: before } }, select: { id: true, storageKey: true }, take: BATCH, orderBy: { createdAt: 'asc' } });
  if (!candidates.length) return;
  const used = await referencedFileIds();
  let removed = 0;
  for (const f of candidates) {
    if (used.has(f.id.toLowerCase())) continue;
    // The bytes first: if that fails the row stays and the next run tries again
    const ok = await tally.item(`file ${f.id}`, async () => {
      await storage.remove(f.storageKey);
      await prisma.storedFile.delete({ where: { id: f.id } });
    });
    if (ok) removed++;
  }
  tally.note(removed > 0 && `${removed} unused file${removed === 1 ? '' : 's'} removed`);
}

/** Simple deletes, each its own step */
const STEPS: { label: string; run: () => Promise<number> }[] = [
  // Sign-in codes are useless once expired; a day later they are gone
  { label: 'sign-in codes', run: async () => (await prisma.otpCode.deleteMany({ where: { expiresAt: { lt: new Date(Date.now() - DAY) } } })).count },
  // Sessions ended (signed out or expired) more than 30 days ago
  {
    label: 'old sessions',
    run: async () => (await prisma.userSession.deleteMany({ where: { OR: [{ revokedAt: { lt: new Date(Date.now() - 30 * DAY) } }, { expiresAt: { lt: new Date(Date.now() - 30 * DAY) } }] } })).count,
  },
  { label: 'expired trusted devices', run: async () => (await prisma.userTrustedDevice.deleteMany({ where: { expiresAt: { lt: new Date() } } })).count },
  // Background events done without error over 30 days ago, and their done-markers. Failed ones stay for System health.
  {
    label: 'old background events',
    run: async () => {
      const cut = new Date(Date.now() - 30 * DAY);
      const done = await prisma.$executeRaw(Prisma.sql`
        DELETE FROM processed_events p USING outbox_events o
         WHERE p.event_id = o.id AND o.published_at < ${cut} AND o.last_error IS NULL`);
      const events = (await prisma.outboxEvent.deleteMany({ where: { publishedAt: { lt: cut }, lastError: null } })).count;
      return events + done;
    },
  },
];

export async function runCleanup() {
  const tally = new JobTally();
  await tally.item('unused files', () => unusedFiles(tally)).then((ok) => ok && tally.done--);
  for (const s of STEPS) {
    let n = 0;
    await tally.item(s.label, async () => {
      n = await s.run();
    });
    tally.note(n > 0 && `${n} ${s.label} removed`);
  }
  return tally;
}
