import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCutlistDefaults, resolveOrgSettingsOrgId } from '../hooks/use-org-settings';

const legacyDimensionKey = 'minReusableOffcut' + 'DimensionMm';
const legacyAreaKey = 'minReusableOffcut' + 'AreaMm2';

test('null/missing -> strict new defaults', () => {
  assert.deepEqual(normalizeCutlistDefaults(null), {
    minReusableOffcutLengthMm: 300, minReusableOffcutWidthMm: 300,
    minReusableOffcutGrain: 'any', preferredOffcutDimensionMm: 300,
    sameBoardQuantityModel: 'pieces-v0',
  });
  assert.deepEqual(normalizeCutlistDefaults({}), {
    minReusableOffcutLengthMm: 300, minReusableOffcutWidthMm: 300,
    minReusableOffcutGrain: 'any', preferredOffcutDimensionMm: 300,
    sameBoardQuantityModel: 'pieces-v0',
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
    sameBoardQuantityModel: 'pieces-v0',
  });
});
test('mixed: any new key wins, legacy scalar ignored', () => {
  assert.deepEqual(normalizeCutlistDefaults({
    minReusableOffcutLengthMm: 600,
    [legacyDimensionKey]: 150,
  }), {
    minReusableOffcutLengthMm: 600, minReusableOffcutWidthMm: 300,
    minReusableOffcutGrain: 'any', preferredOffcutDimensionMm: 300,
    sameBoardQuantityModel: 'pieces-v0',
  });
});
test('fully-new passes through', () => {
  assert.deepEqual(normalizeCutlistDefaults({
    minReusableOffcutLengthMm: 600, minReusableOffcutWidthMm: 400,
    minReusableOffcutGrain: 'length', preferredOffcutDimensionMm: 500,
    sameBoardQuantityModel: 'finished-v1',
  }), {
    minReusableOffcutLengthMm: 600, minReusableOffcutWidthMm: 400,
    minReusableOffcutGrain: 'length', preferredOffcutDimensionMm: 500,
    sameBoardQuantityModel: 'finished-v1',
  });
});

test('org settings resolve active membership when JWT org metadata is missing', () => {
  const orgId = resolveOrgSettingsOrgId([
    {
      org_id: 'org-1',
      is_active: true,
      banned_until: null,
      inserted_at: '2026-01-01T00:00:00.000Z',
    },
  ], null);

  assert.equal(orgId, 'org-1');
});

test('org settings ignore inactive JWT org and fall back to active membership', () => {
  const orgId = resolveOrgSettingsOrgId([
    {
      org_id: 'org-jwt',
      is_active: false,
      banned_until: null,
      inserted_at: '2026-01-01T00:00:00.000Z',
    },
    {
      org_id: 'org-member',
      is_active: true,
      banned_until: null,
      inserted_at: '2026-01-02T00:00:00.000Z',
    },
  ], 'org-jwt');

  assert.equal(orgId, 'org-member');
});
