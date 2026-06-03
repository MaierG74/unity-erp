import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchAllPages } from '../lib/db/paginate';

// Fake page-fetcher over an in-memory dataset. `serverCap` simulates a
// PostgREST `max-rows` smaller than the requested page size; `reportCount`
// toggles whether the backend returns an exact count on the first page.
function makeFetcher(
  dataset: number[],
  opts: { serverCap?: number; reportCount?: boolean } = {},
) {
  const { serverCap = Infinity, reportCount = true } = opts;
  let calls = 0;
  const fetchPage = async (from: number, to: number) => {
    calls++;
    const requested = to - from + 1;
    const limit = Math.min(requested, serverCap);
    const rows = dataset.slice(from, from + limit);
    return { rows, total: reportCount && from === 0 ? dataset.length : null };
  };
  return { fetchPage, getCalls: () => calls };
}

test('collects every row across multiple pages when total exceeds the page size', async () => {
  const data = Array.from({ length: 2500 }, (_, i) => i);
  const { fetchPage } = makeFetcher(data);
  const all = await fetchAllPages(fetchPage, 1000);
  assert.equal(all.length, 2500);
  assert.deepEqual(all, data); // order preserved, no dupes or skips
});

test('handles a server cap smaller than the requested page size (count known)', async () => {
  const data = Array.from({ length: 1500 }, (_, i) => i);
  const { fetchPage } = makeFetcher(data, { serverCap: 500 });
  const all = await fetchAllPages(fetchPage, 1000);
  assert.equal(all.length, 1500);
  assert.deepEqual(all, data);
});

test('terminates on an empty page when no count is reported', async () => {
  const data = Array.from({ length: 1500 }, (_, i) => i);
  const { fetchPage } = makeFetcher(data, { reportCount: false });
  const all = await fetchAllPages(fetchPage, 1000);
  assert.equal(all.length, 1500);
  assert.deepEqual(all, data);
});

test('returns an empty array for an empty dataset', async () => {
  const { fetchPage, getCalls } = makeFetcher([]);
  const all = await fetchAllPages(fetchPage, 1000);
  assert.deepEqual(all, []);
  assert.equal(getCalls(), 1);
});

test('fetches exactly one page when the dataset fits under the cap (count known)', async () => {
  const data = Array.from({ length: 673 }, (_, i) => i); // mirrors live inventory size
  const { fetchPage, getCalls } = makeFetcher(data);
  const all = await fetchAllPages(fetchPage, 1000);
  assert.equal(all.length, 673);
  assert.equal(getCalls(), 1); // count says 673 < 1000 → no wasted second request
});

test('rejects an invalid page size', async () => {
  const { fetchPage } = makeFetcher([1, 2, 3]);
  await assert.rejects(() => fetchAllPages(fetchPage, 0), /pageSize must be >= 1/);
});
