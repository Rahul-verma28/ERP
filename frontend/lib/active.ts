/**
 * Choices for a picker: inactive masters (branches, price lists, categories…) are not offered
 * for new records, but the one a record already has stays so it still shows and saves as it was.
 */
export function activeOr<T extends { id: string; isActive?: boolean }>(rows: readonly T[], keep?: string | readonly string[] | null): T[] {
  const kept = new Set(keep == null ? [] : typeof keep === "string" ? [keep] : keep)
  return rows.filter((r) => r.isActive !== false || kept.has(r.id))
}
