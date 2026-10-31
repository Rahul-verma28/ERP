import { describe, expect, it } from 'vitest';
import { ListQuery, listArgs, listPage } from '../kernel/query';

// Console tables: numbered pages (skip/take, no cursor) next to the older cursor pages.

describe('list paging', () => {
  it('numbered pages skip whole pages and never return a cursor', () => {
    const q = ListQuery.parse({ limit: '20', page: '3' });
    expect(listArgs(q, { id: 'desc' })).toEqual({ orderBy: { id: 'desc' }, skip: 40, take: 20 });
    const rows = Array.from({ length: 20 }, (_, i) => ({ id: String(i) }));
    expect(listPage(rows, q)).toEqual({ data: rows, nextCursor: null });
  });

  it('cursor pages read one extra row to know if there is more', () => {
    const q = ListQuery.parse({ limit: '2', cursor: '01a18814-98e7-7850-b2c5-465d2c1e246a' });
    expect(listArgs(q, { id: 'desc' })).toEqual({ orderBy: { id: 'desc' }, take: 3, cursor: { id: q.cursor }, skip: 1 });
    expect(listPage([{ id: 'a' }, { id: 'b' }, { id: 'c' }], q)).toEqual({ data: [{ id: 'a' }, { id: 'b' }], nextCursor: 'b' });
    expect(listPage([{ id: 'a' }], q)).toEqual({ data: [{ id: 'a' }], nextCursor: null });
  });

  it('rejects page 0', () => {
    expect(ListQuery.safeParse({ page: '0' }).success).toBe(false);
  });
});
