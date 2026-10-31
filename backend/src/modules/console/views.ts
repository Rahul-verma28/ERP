import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { db } from '../../kernel/db';

// Saved views (blueprint Phase G): a person's named filter sets on the Businesses list, kept in
// their own preferences (users.preferences.consoleViews). Nobody else sees them.

const View = z.object({
  id: z.string().min(1).max(40),
  name: z.string().trim().min(1, 'Give the view a name').max(40, 'Up to 40 characters'),
  filters: z.object({
    search: z.string().trim().max(80).optional(),
    status: z.string().max(30).optional(),
    planKey: z.string().max(40).optional(),
    onboarded: z.string().max(20).optional(),
    industryKey: z.string().max(40).optional(),
  }),
});
export const ViewsInput = z.object({ views: z.array(View).max(12, 'Up to 12 saved views') });
export type SavedView = z.infer<typeof View>;

export async function listViews(userId: string): Promise<SavedView[]> {
  const u = await db().user.findUniqueOrThrow({ where: { id: userId }, select: { preferences: true } });
  const parsed = z.array(View).safeParse(((u.preferences ?? {}) as { consoleViews?: unknown }).consoleViews ?? []);
  return parsed.success ? parsed.data : [];
}

/** Replaces the whole list (add, rename, reorder and delete are one save). */
export async function saveViews(userId: string, views: SavedView[]) {
  const u = await db().user.findUniqueOrThrow({ where: { id: userId }, select: { preferences: true } });
  const preferences = { ...((u.preferences ?? {}) as Record<string, unknown>), consoleViews: views };
  await db().user.update({ where: { id: userId }, data: { preferences: preferences as Prisma.InputJsonValue } });
  return views;
}
