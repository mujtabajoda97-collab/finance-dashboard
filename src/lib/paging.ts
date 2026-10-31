export interface PagedResult<T> {
  rows: T[];
  /** True when the cap was hit and more rows may exist. */
  truncated: boolean;
}

/**
 * Reads every page of a range-based query. `fetchPage(from, to)` must return the rows for the
 * inclusive range [from, to]. Stops at the first short page; stops at `cap` rows and says so.
 */
export async function fetchAllPages<T>(
  fetchPage: (from: number, to: number) => Promise<T[]>,
  pageSize: number,
  cap: number,
): Promise<PagedResult<T>> {
  const rows: T[] = [];
  for (let offset = 0; offset < cap; offset += pageSize) {
    const page = await fetchPage(offset, offset + pageSize - 1);
    rows.push(...page);
    if (page.length < pageSize) return { rows, truncated: false };
  }
  return { rows, truncated: true };
}
