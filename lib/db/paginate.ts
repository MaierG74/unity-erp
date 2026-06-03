/**
 * Generic offset paginator for PostgREST / Supabase reads.
 *
 * Supabase enforces a server-side `max-rows` cap (1000 by default), so any
 * unbounded `.select()` silently returns only the first page once a table grows
 * past the cap. This walks every page and collects the full result set so
 * callers never lose rows.
 *
 * `fetchPage(from, to)` runs a single `.range(from, to)` request and returns the
 * rows plus the total row count (PostgREST `count: 'exact'`) when known. Request
 * the count only on the first page; later pages may return `null` and the
 * previously-seen total is reused.
 *
 * Exit is driven by the count when available (stop once every row is collected)
 * and otherwise by an empty page, so it stays correct even if the server cap is
 * smaller than `pageSize`. It advances by the number of rows actually returned,
 * never by `pageSize`, so a short page from a low server cap still makes
 * forward progress.
 */
export async function fetchAllPages<T>(
  fetchPage: (from: number, to: number) => Promise<{ rows: T[]; total: number | null }>,
  pageSize = 1000,
): Promise<T[]> {
  if (pageSize < 1) throw new Error('fetchAllPages: pageSize must be >= 1');

  const all: T[] = [];
  let from = 0;
  let total: number | null = null;

  // Defensive upper bound: far above any realistic page count, so a backend that
  // keeps returning non-empty pages can't loop forever.
  const MAX_PAGES = 10_000;
  for (let page = 0; page < MAX_PAGES; page++) {
    const { rows, total: pageTotal } = await fetchPage(from, from + pageSize - 1);
    if (pageTotal != null) total = pageTotal;

    all.push(...rows);

    if (rows.length === 0) break; // no more rows
    if (total != null && all.length >= total) break; // collected the whole set

    from += rows.length;
  }

  return all;
}
