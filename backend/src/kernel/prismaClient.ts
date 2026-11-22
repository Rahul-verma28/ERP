import { PrismaClient } from '@prisma/client';

/**
 * Build the Prisma client: plain PostgreSQL over TCP (local in development, the PostgreSQL
 * container in production). DATABASE_URL says where.
 */
export function createPrismaClient(log: ('warn' | 'error' | 'info' | 'query')[] = ['warn', 'error']) {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
  return new PrismaClient({ log });
}
