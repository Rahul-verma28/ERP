import { PrismaClient } from '@prisma/client';

// One client for the Console database. The Console is AHEAD's own system (no businesses' data,
// no row-level security): access is decided in each route from the person's role.

export const prisma = new PrismaClient();
export type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
