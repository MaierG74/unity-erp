import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCutlistDefaults } from '../hooks/use-org-settings';

const legacyDimensionKey = 'minReusableOffcut' + 'DimensionMm';
const legacyAreaKey = 'minReusableOffcut' + 'AreaMm2';

test('null/missing -> strict new defaults', () => {
  assert.deepEqual(normalizeCutlistDefaults(null), {
    minReusableOffcutLengthMm: 300, minReusableOffcutWidthMm: 300,
    minReusableOffcutGrain: 'any', preferredOffcutDimensionMm: 300,
  });
  assert.deepEqual(normalizeCutlistDefaults({}), {
    minReusableOffcutLengthMm: 300, minReusableOffcutWidthMm: 300,
    minReusableOffcutGrain: 'any', preferredOffcutDimensionMm: 300,
  });
});
test('pure-legacy -> carry scalar to both axes, drop area', () => {
  assert.deepEqual(normalizeCutlistDefaults({
    [legacyDimensionKey]: 150,
    preferredOffcutDimensionMm: 300,
    [legacyAreaKey]: 100000,
  }), {
    minReusableOffcutLengthMm: 150, minReusableOffcutWidthMm: 150,
    minReusableOffcutGrain: 'any', preferredOffcutDimensionMm: 300,
  });
});
test('mixed: any new key wins, legacy scalar ignored', () => {
  assert.deepEqual(normalizeCutlistDefaults({
    minReusableOffcutLengthMm: 600,
    [legacyDimensionKey]: 150,
  }), {
    minReusableOffcutLengthMm: 600, minReusableOffcutWidthMm: 300,
    minReusableOffcutGrain: 'any', preferredOffcutDimensionMm: 300,
  });
});
test('fully-new passes through', () => {
  assert.deepEqual(normalizeCutlistDefaults({
    minReusableOffcutLengthMm: 600, minReusableOffcutWidthMm: 400,
    minReusableOffcutGrain: 'length', preferredOffcutDimensionMm: 500,
  }), {
    minReusableOffcutLengthMm: 600, minReusableOffcutWidthMm: 400,
    minReusableOffcutGrain: 'length', preferredOffcutDimensionMm: 500,
  });
});
