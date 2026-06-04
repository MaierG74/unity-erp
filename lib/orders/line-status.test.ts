import assert from 'node:assert/strict';

import { computeLineStatus, type LineStatusInput } from './line-status';

declare const test: (name: string, fn: () => void) => void;

const baseInput: LineStatusInput = {
  hasCutlistSnapshot: true,
  primaryMaterialId: 1,
  shortfallCount: 0,
};

test('computeLineStatus returns ready when materials configured and no shortfalls', () => {
  const result = computeLineStatus(baseInput);
  assert.equal(result.kind, 'ready');
  assert.equal(result.sentence, 'Ready to plan');
});

test('computeLineStatus returns needs-material when cutlist snapshot exists but primary is null', () => {
  const result = computeLineStatus({ ...baseInput, primaryMaterialId: null });
  assert.equal(result.kind, 'needs-material');
  assert.equal(result.sentence, 'Needs cutlist material');
});

test('computeLineStatus returns shortfall and pluralizes correctly', () => {
  const single = computeLineStatus({ ...baseInput, shortfallCount: 1 });
  assert.equal(single.kind, 'shortfall');
  assert.equal(single.sentence, '1 component short');

  const multi = computeLineStatus({ ...baseInput, shortfallCount: 3 });
  assert.equal(multi.kind, 'shortfall');
  assert.equal(multi.sentence, '3 components short');
});

test('computeLineStatus prioritizes shortfall over needs-material', () => {
  const result = computeLineStatus({
    hasCutlistSnapshot: true,
    primaryMaterialId: null,
    shortfallCount: 2,
  });
  assert.equal(result.kind, 'shortfall');
});

test('computeLineStatus returns ready when product has no cutlist snapshot', () => {
  const result = computeLineStatus({
    hasCutlistSnapshot: false,
    primaryMaterialId: null,
    shortfallCount: 0,
  });
  assert.equal(result.kind, 'ready');
});
