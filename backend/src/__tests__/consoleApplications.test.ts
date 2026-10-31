import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { prisma, db, withPlatform } from '../kernel/db';
import type { ConsoleCtx } from '../kernel/context';
import { ApplicationInput, approveApplication, rejectApplication, submitApplication } from '../modules/console/applications';
import { listViews, saveViews } from '../modules/console/views';

// Blueprint Phase G: website applications (submit, approve, reject) and saved views. Rolled back.

class Rollback extends Error {}
async function rolledBack(fn: () => Promise<void>) {
  try {
    await withPlatform(async () => { await fn(); throw new Rollback(); }, { kind: 'platform' }, { timeoutMs: 90_000 });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
}

afterAll(() => prisma.$disconnect());

const digits = () => String(Math.floor(Math.random() * 1e9)).padStart(9, '0');

async function admin(): Promise<ConsoleCtx> {
  const n = digits();
  const user = await db().user.create({ data: { name: 'PG Admin', email: `pg-${n}@example.test`, mobile: `+916${n}` } });
  const role = await db().role.findFirstOrThrow({ where: { tenantId: null, layer: 'platform', key: 'super_admin' } });
  const member = await db().platformMember.create({ data: { userId: user.id, roleId: role.id } });
  return { kind: 'platform', userId: user.id, memberId: member.id, roleId: role.id, sessionId: randomUUID(), scope: 'all', partnerId: null };
}

const form = (kind: 'vendor' | 'partner', extra: Record<string, unknown> = {}) =>
  ApplicationInput.parse({ kind, name: 'Asha Rao', company: kind === 'partner' ? 'Rao Systems' : undefined, email: `apply-${digits()}@example.test`, mobile: `9${digits()}`, ...extra });

describe('applications', () => {
  it('needs a company name from a partner', () => {
    expect(ApplicationInput.safeParse({ kind: 'partner', name: 'Asha Rao', email: 'a@example.test', mobile: '9876543210' }).success).toBe(false);
  });

  it('stores one pending application per email and ignores bots', async () => {
    await rolledBack(async () => {
      const a = form('vendor');
      await submitApplication(a);
      await submitApplication(a);
      expect(await db().consoleApplication.count({ where: { email: a.email } })).toBe(1);
      const bot = form('vendor', { website: 'http://spam.example' });
      await submitApplication(bot);
      expect(await db().consoleApplication.count({ where: { email: bot.email } })).toBe(0);
    });
  }, 60_000);

  it('approving a vendor adds them to the Console with a login link; a decision is final', async () => {
    await rolledBack(async () => {
      const ctx = await admin();
      const a = form('vendor');
      await submitApplication(a);
      const app = await db().consoleApplication.findFirstOrThrow({ where: { email: a.email } });
      const done = await approveApplication(ctx, app.id, { discountPercent: 0 });
      expect(done.loginLink.url).toBeTruthy();
      const member = await db().platformMember.findUniqueOrThrow({ where: { id: done.resultId }, include: { role: true } });
      expect(member.role.key).toBe('vendor');
      await expect(rejectApplication(ctx, app.id, {})).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
    });
  }, 90_000);

  it('approving a partner creates the partner with its discount; rejecting keeps the note', async () => {
    await rolledBack(async () => {
      const ctx = await admin();
      const p = form('partner');
      await submitApplication(p);
      const app = await db().consoleApplication.findFirstOrThrow({ where: { email: p.email } });
      const done = await approveApplication(ctx, app.id, { discountPercent: 15 });
      const partner = await db().partner.findUniqueOrThrow({ where: { id: done.resultId } });
      expect(partner.name).toBe('Rao Systems');
      expect(partner.discountBp).toBe(1500);

      const r = form('vendor');
      await submitApplication(r);
      const rejected = await db().consoleApplication.findFirstOrThrow({ where: { email: r.email } });
      await rejectApplication(ctx, rejected.id, { note: 'Not in our area yet' });
      expect((await db().consoleApplication.findUniqueOrThrow({ where: { id: rejected.id } })).decisionNote).toBe('Not in our area yet');
    });
  }, 90_000);
});

describe('saved views', () => {
  it('keeps other preferences when saving', async () => {
    await rolledBack(async () => {
      const ctx = await admin();
      await db().user.update({ where: { id: ctx.userId }, data: { preferences: { theme: 'dark' } } });
      await saveViews(ctx.userId, [{ id: 'v1', name: 'Trials', filters: { status: 'trialing' } }]);
      expect(await listViews(ctx.userId)).toEqual([{ id: 'v1', name: 'Trials', filters: { status: 'trialing' } }]);
      const prefs = (await db().user.findUniqueOrThrow({ where: { id: ctx.userId } })).preferences as Record<string, unknown>;
      expect(prefs.theme).toBe('dark');
    });
  }, 60_000);
});
