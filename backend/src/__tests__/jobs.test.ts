import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../kernel/db';
import { JobTally } from '../kernel/jobs';
import { storage } from '../kernel/storage';
import { consumer, relayOnce } from '../modules/events/outbox';
import { ALREADY_RUNNING, runTracked } from '../modules/system/jobs';
import { runCleanup } from '../modules/system/cleanup';

// Scheduled jobs and background events: one failing item never stops the rest and still marks
// the run failed; a job never runs twice at once; clean-up only removes what nothing uses; a
// failed event waits before it is tried again and is published only after it worked.

afterAll(() => prisma.$disconnect());

describe('jobs', () => {
  it('counts each item, keeps going after a failure and says so', async () => {
    const t = new JobTally();
    await t.item('a', async () => undefined);
    await t.item('b', async () => {
      throw new Error('disk full');
    });
    await t.item('c', async () => undefined);
    t.note('2 things made');
    expect(t).toMatchObject({ done: 2, failed: 1 });
    expect(t.errors[0]).toBe('b: disk full');
    expect(t.summary()).toBe('2 things made, 2 done, 1 failed');
  });

  it('never runs the same job twice at once', async () => {
    // Hold the lock as if another server were running it
    await prisma.jobRun.upsert({ where: { name: 'cleanup' }, create: { name: 'cleanup', lockedUntil: new Date(Date.now() + 60_000) }, update: { lockedUntil: new Date(Date.now() + 60_000) } });
    try {
      expect(await runTracked('cleanup')).toBe(ALREADY_RUNNING);
    } finally {
      await prisma.jobRun.update({ where: { name: 'cleanup' }, data: { lockedUntil: null } });
    }
    // Free again: it runs and records what it did
    expect(await runTracked('cleanup')).toBeNull();
    const run = await prisma.jobRun.findUniqueOrThrow({ where: { name: 'cleanup' } });
    expect(run.lockedUntil).toBeNull();
    expect(run.lastSummary).toMatch(/done/);
  });

  it('clean-up removes old unused files but keeps any a record points at', async () => {
    const old = new Date(Date.now() - 5 * 86_400_000);
    const make = async (name: string) => {
      const id = randomUUID();
      const key = `test/${id}`;
      await storage.put(key, Buffer.from('%PDF-1.4\n'), 'application/pdf');
      await prisma.storedFile.create({ data: { id, tenantId: null, name, mime: 'application/pdf', sizeBytes: 9, sha256: '0'.repeat(64), storageKey: key, createdAt: old } });
      return id;
    };
    const unused = await make('left behind.pdf');
    const kept = await make('profile.pdf');
    const fresh = randomUUID();
    await prisma.storedFile.create({ data: { id: fresh, tenantId: null, name: 'just now.pdf', mime: 'application/pdf', sizeBytes: 9, sha256: '0'.repeat(64), storageKey: `test/${fresh}` } });
    const n = String(Math.floor(Math.random() * 1e9)).padStart(9, '0');
    const user = await prisma.user.create({ data: { name: 'Keeps a file', email: `jobs-${n}@example.test`, mobile: `+918${n}`, avatarUrl: `file:${kept}` } });
    try {
      const tally = await runCleanup();
      expect(tally.failed).toBe(0);
      expect(await prisma.storedFile.findUnique({ where: { id: unused } })).toBeNull();
      await expect(storage.get(`test/${unused}`)).rejects.toThrow();
      expect(await prisma.storedFile.findUnique({ where: { id: kept } })).not.toBeNull();
      expect(await prisma.storedFile.findUnique({ where: { id: fresh } })).not.toBeNull();
    } finally {
      await prisma.user.delete({ where: { id: user.id } });
      for (const id of [kept, fresh]) {
        await prisma.storedFile.deleteMany({ where: { id } });
        await storage.remove(`test/${id}`);
      }
    }
  });

  it('retries a failed event later, and publishes it only once it worked', async () => {
    let fail = true;
    consumer('jobs-test', 'credit_note.cancelled', async (evt) => {
      if ((evt.payload as { test?: string }).test !== 'jobs') return;
      if (fail) throw new Error('mail server down');
    }, { platform: true });
    const evt = await prisma.outboxEvent.create({ data: { type: 'credit_note.cancelled', tenantId: null, payload: { test: 'jobs' }, actor: { kind: 'system' }, occurredAt: new Date(0) } });
    try {
      await relayOnce();
      let row = await prisma.outboxEvent.findUniqueOrThrow({ where: { id: evt.id } });
      expect(row.publishedAt).toBeNull();
      expect(row.lastError).toBe('mail server down');
      expect(row.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now());
      // Not tried again straight away
      await relayOnce();
      expect((await prisma.outboxEvent.findUniqueOrThrow({ where: { id: evt.id } })).attempts).toBe(1);
      // Due again and working now: published, error cleared
      fail = false;
      await prisma.outboxEvent.update({ where: { id: evt.id }, data: { nextAttemptAt: new Date(Date.now() - 1000) } });
      await relayOnce();
      row = await prisma.outboxEvent.findUniqueOrThrow({ where: { id: evt.id } });
      expect(row.publishedAt).not.toBeNull();
      expect(row.lastError).toBeNull();
      expect(row.attempts).toBe(2);
    } finally {
      await prisma.processedEvent.deleteMany({ where: { eventId: evt.id } });
      await prisma.outboxEvent.delete({ where: { id: evt.id } });
    }
  });
});
