import assert from 'node:assert/strict';

import { computePaddedLineCost } from './padded-line-cost';

declare const test: (name: string, fn: () => void) => void;

test('non-cutlist BOM cost prefers effective_line_total over legacy line_total', () => {
  const result = computePaddedLineCost({
    quantity: 2,
    snapshot: null,
    bom_snapshot: [
      { is_cutlist_item: false, line_total: 80, effective_line_total: 30, component_id: 1 },
      { is_cutlist_item: true, line_total: 999, effective_line_total: 999, component_id: 2 },
    ],
  });

  assert.equal(result.non_cutlist_portion, 60);
  assert.equal(result.padded_cost, 60);
});

test('removed non-cutlist BOM entries with zero effective total do not contribute cost', () => {
  const result = computePaddedLineCost({
    quantity: 3,
    snapshot: null,
    bom_snapshot: [
      { is_cutlist_item: false, line_total: 80, effective_line_total: 0, component_id: 1 },
      { is_cutlist_item: false, line_total: 20, component_id: 2 },
    ],
  });

  assert.equal(result.non_cutlist_portion, 60);
});
