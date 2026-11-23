import type { Prisma } from '@prisma/client';
import { prisma, type Tx } from './db';

/** Kept silently in the background (no reason dialogs on normal edits); Admin can read it */
export async function audit(e: { actorId?: string | null; action: string; entity: string; entityId?: string | null; before?: unknown; after?: unknown; ip?: string | null }, tx: Tx | typeof prisma = prisma) {
  await tx.auditEntry.create({
    data: {
      actorId: e.actorId ?? null,
      action: e.action,
      entity: e.entity,
      entityId: e.entityId ?? null,
      before: (e.before ?? undefined) as Prisma.InputJsonValue | undefined,
      after: (e.after ?? undefined) as Prisma.InputJsonValue | undefined,
      ip: e.ip ?? null,
    },
  });
}
