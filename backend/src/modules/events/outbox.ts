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

/** Claim a batch of unpublished events and dispatch them. Safe with several workers. */
export async function relayOnce(batchSize = 100): Promise<number> {
  const rows = await prisma.$queryRaw<
    { id: string; tenant_id: string | null; type: EventType; version: number; payload: Record<string, unknown>; actor: EventEnvelope['actor']; occurred_at: Date; attempts: number }[]
  >`
    WITH batch AS (
      SELECT id FROM outbox_events
       WHERE published_at IS NULL
       ORDER BY occurred_at
       LIMIT ${batchSize}
       FOR UPDATE SKIP LOCKED
    )
    UPDATE outbox_events o SET published_at = now(), attempts = attempts + 1
      FROM batch WHERE o.id = batch.id
    RETURNING o.id, o.tenant_id, o.type, o.version, o.payload, o.actor, o.occurred_at, o.attempts`;

  for (const row of rows) {
    const evt: EventEnvelope = {
      id: row.id, type: row.type, version: row.version, tenantId: row.tenant_id,
      occurredAt: row.occurred_at, actor: row.actor, payload: row.payload,
    };
    try {
      for (const c of consumers.get(evt.type) ?? []) await c.handler(evt);
      // A later attempt worked: the earlier error is no longer a problem
      if (row.attempts > 1) await prisma.outboxEvent.update({ where: { id: evt.id }, data: { lastError: null } });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error(`[outbox] ${evt.type} ${evt.id} failed (attempt ${row.attempts}):`, message);
      // Retry later unless attempts are exhausted (then it stays published with last_error = dead letter)
      await prisma.outboxEvent.update({
        where: { id: evt.id },
        data: { lastError: message.slice(0, 1000), publishedAt: row.attempts >= MAX_ATTEMPTS ? undefined : null },
      });
    }
  }
  return rows.length;
}
