import { AsyncLocalStorage } from 'node:async_hooks';
import type { Prisma } from '@prisma/client';
import { createPrismaClient } from './prismaClient';
import { isDev } from '../config/env';
import type { Ctx } from './context';

/**
 * The single Prisma client. It connects as the database owner (BYPASSRLS), so
 * tenant work must go through withTenant(), which drops to the `app_user` role
 * for the duration of the transaction so that row-level security applies.
 */
export const prisma = createPrismaClient(isDev ? ['warn', 'error'] : ['error']);

type Store = { tx: Prisma.TransactionClient; ctx: Ctx; after: (() => void)[] };
const als = new AsyncLocalStorage<Store>();

// A development database far away takes ~300 ms a query, so a long request (a cash bill with
// stock) needs more room there; production keeps the tight limit.
const TX_OPTIONS = { timeout: isDev ? 45_000 : 15_000, maxWait: 10_000, isolationLevel: 'ReadCommitted' } as const;

/** Transaction client for the current unit of work. Fails closed outside one. */
export const db = (): Prisma.TransactionClient => {
  const store = als.getStore();
  if (!store) throw new Error('NO_DB_CONTEXT');
  return store.tx;
};

export const currentCtx = (): Ctx | undefined => als.getStore()?.ctx;

/**
 * Run fn once the current transaction has committed (e.g. drop a cache, so no request that ran
 * before the commit can re-cache the old value). Outside a transaction it runs at once; if the
 * transaction rolls back it never runs.
 */
export function afterCommit(fn: () => void) {
  const store = als.getStore();
  if (store) store.after.push(fn);
  else fn();
}

function runAfter(after: (() => void)[]) {
  for (const fn of after) {
    try {
      fn();
    } catch {
      // A cache drop must never turn a committed request into an error
    }
  }
}

/** Run fn in one transaction scoped to ctx.tenantId (RLS enforced). */
export async function withTenant<T>(ctx: Ctx & { tenantId: string }, fn: () => Promise<T>): Promise<T> {
  const existing = als.getStore();
  if (existing && existing.ctx.kind !== 'platform' && existing.ctx.tenantId === ctx.tenantId) return fn();

  const after: (() => void)[] = [];
  const out = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT set_config('app.tenant_id', ${ctx.tenantId}, true), set_config('app.user_id', ${ctx.userId ?? ''}, true)`;
    await tx.$executeRawUnsafe('SET LOCAL ROLE app_user');
    return als.run({ tx, ctx, after }, fn);
  }, TX_OPTIONS);
  runAfter(after);
  return out;
}

/**
 * Run fn in one transaction with platform privileges (no RLS). Only platform
 * modules (identity, tenancy creation, subscription, billing-platform, jobs) may use this.
 */
export async function withPlatform<T>(fn: () => Promise<T>, ctx: Ctx = { kind: 'platform' }, opts: { timeoutMs?: number } = {}): Promise<T> {
  const existing = als.getStore();
  if (existing && existing.ctx.kind === 'platform') return fn();
  const after: (() => void)[] = [];
  const out = await prisma.$transaction(async (tx) => als.run({ tx, ctx, after }, fn), opts.timeoutMs ? { ...TX_OPTIONS, timeout: opts.timeoutMs } : TX_OPTIONS);
  runAfter(after);
  return out;
}
