import { prisma, type Tx } from '../../kernel/db';

/** A Console setting (seeded in prisma/seed.ts; Admin can change them) */
export async function getSetting<T>(key: string, tx: Tx | typeof prisma = prisma): Promise<T | null> {
  const row = await tx.setting.findUnique({ where: { key } });
  return (row?.value as T) ?? null;
}
