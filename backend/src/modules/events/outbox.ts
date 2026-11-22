import { prisma, currentCtx, db, withPlatform, withTenant } from '../../kernel/db';
import type { Prisma } from '@prisma/client';

// Transactional outbox (LLD §9). Producers call publish() inside their transaction;
// the relay below claims unpublished rows and runs registered consumers idempotently.
// In production the relay pushes to BullMQ; here consumers run in-process.

export type EventType =
  | 'tenant.created'
  | 'config.applied'
  | 'member.invited'
  | 'member.activated'
  | 'member.deactivated'
  | 'role.updated'
  | 'subscription.changed'
  | 'trial.reminder_due'
  | 'invoice.issued'
  | 'payment.received'
  | 'credit_note.issued'
  | 'credit_note.cancelled';

export interface EventEnvelope<P = Record<string, unknown>> {
  id: string;
  type: EventType;
  version: number;
  tenantId: string | null;
  occurredAt: Date;
  actor: { kind: 'user' | 'system' | 'platform'; id?: string };
  payload: P;
}

export async function publish(type: EventType, payload: Record<string, unknown>, opts: { tenantId?: string | null } = {}) {
  const ctx = currentCtx();
  const tenantId = opts.tenantId !== undefined ? opts.tenantId : (ctx?.tenantId ?? null);
  const actor = ctx?.kind === 'tenant' ? { kind: 'user', id: ctx.userId } : { kind: ctx?.kind ?? 'system', id: ctx?.userId };
  await db().outboxEvent.create({
    data: { type, tenantId, payload: payload as Prisma.InputJsonValue, actor },
  });
}

type Handler = (evt: EventEnvelope) => Promise<void>;
const consumers = new Map<EventType, { name: string; handler: Handler }[]>();

/**
 * Register a consumer. The handler runs inside withTenant(evt.tenantId) for tenant events
 * (system actor) or withPlatform for platform events; processed_events makes it idempotent.
 */
export function consumer(name: string, type: EventType, handler: Handler, opts: { platform?: boolean } = {}) {
  const list = consumers.get(type) ?? [];
  list.push({
    name,
    handler: async (evt) => {
      const run = async () => {
        const done = await db().processedEvent.findUnique({ where: { consumer_eventId: { consumer: name, eventId: evt.id } } });
        if (done) return;
        await handler(evt);
        await db().processedEvent.create({ data: { consumer: name, eventId: evt.id } });
      };
      if (evt.tenantId && !opts.platform) await withTenant({ kind: 'system', tenantId: evt.tenantId }, run);
      else await withPlatform(run);
    },
  });
  consumers.set(type, list);
}

export const MAX_ATTEMPTS = 8;
/** A claimed event is held this long; a relay that dies mid-way frees it for another */
const LEASE_SECONDS = 300;
/** Wait before try n+1: 10 s, 20 s, 40 s … up to an hour */
const backoffSeconds = (attempts: number) => Math.min(3600, 10 * 2 ** Math.max(0, attempts - 1));

/**
 * Claim a batch of due events and dispatch them. Safe with several relays (SKIP LOCKED + lease).
 * An event counts as published only after every consumer finished; a failure is retried later
 * with a growing wait, and after MAX_ATTEMPTS it is kept as failed for Console › System health.
 */
export async function relayOnce(batchSize = 100): Promise<number> {
  const rows = await prisma.$queryRaw<
    { id: string; tenant_id: string | null; type: EventType; version: number; payload: Record<string, unknown>; actor: EventEnvelope['actor']; occurred_at: Date; attempts: number }[]
  >`
    WITH batch AS (
      SELECT id FROM outbox_events
       WHERE published_at IS NULL
         AND (locked_until IS NULL OR locked_until < now())
         AND (next_attempt_at IS NULL OR next_attempt_at <= now())
       ORDER BY occurred_at
       LIMIT ${batchSize}
       FOR UPDATE SKIP LOCKED
    )
    UPDATE outbox_events o SET locked_until = now() + make_interval(secs => ${LEASE_SECONDS}::int), attempts = attempts + 1
      FROM batch WHERE o.id = batch.id
    RETURNING o.id, o.tenant_id, o.type, o.version, o.payload, o.actor, o.occurred_at, o.attempts`;

  for (const row of rows) {
    const evt: EventEnvelope = {
      id: row.id, type: row.type, version: row.version, tenantId: row.tenant_id,
      occurredAt: row.occurred_at, actor: row.actor, payload: row.payload,
    };
    try {
      for (const c of consumers.get(evt.type) ?? []) await c.handler(evt);
      // Done: published, and any earlier error is no longer a problem
      await prisma.outboxEvent.update({ where: { id: evt.id }, data: { publishedAt: new Date(), lockedUntil: null, nextAttemptAt: null, lastError: null } });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const dead = row.attempts >= MAX_ATTEMPTS;
      console.error(`[outbox] ${evt.type} ${evt.id} failed (attempt ${row.attempts}${dead ? ', giving up' : ''}):`, message);
      // Given up: published with its error (a dead letter, shown in System health to retry or dismiss)
      await prisma.outboxEvent
        .update({
          where: { id: evt.id },
          data: dead
            ? { lastError: message.slice(0, 1000), publishedAt: new Date(), lockedUntil: null, nextAttemptAt: null }
            : { lastError: message.slice(0, 1000), lockedUntil: null, nextAttemptAt: new Date(Date.now() + backoffSeconds(row.attempts) * 1000) },
        })
        .catch((x) => console.error('[outbox] could not record the failure:', x instanceof Error ? x.message : x));
    }
  }
  return rows.length;
}
