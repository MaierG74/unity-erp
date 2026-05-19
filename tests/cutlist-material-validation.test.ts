import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcilePartMaterials } from '../lib/cutlist/materialValidation';

const part = {
  id: 'cfg-1',
  name: 'Top',
  length_mm: 400,
  width_mm: 400,
  quantity: 1,
  grain: 'length' as const,
  band_edges: { top: false, right: false, bottom: false, left: false },
  material_id: 'orphan-board',
  lamination_type: 'none' as const,
};

test('reconciles orphan part material to the only configured board', () => {
  const result = reconcilePartMaterials([part], [
    {
      id: 'nordic-board',
      name: '16mm Nordic Ice',
      length_mm: 2750,
      width_mm: 1830,
      cost: 963,
      isDefault: true,
      component_id: 408,
    },
  ]);

  assert.equal(result.invalidParts.length, 0);
  assert.equal(result.changed, true);
  assert.equal(result.parts[0].material_id, 'nordic-board');
  assert.equal(result.parts[0].material_label, '16mm Nordic Ice');
});

test('marks orphan material invalid when multiple boards are configured', () => {
  const result = reconcilePartMaterials([part], [
    {
      id: 'alegria-board',
      name: '16mm Alegria',
      length_mm: 2730,
      width_mm: 1830,
      cost: 797.05,
      isDefault: true,
      component_id: 448,
    },
    {
      id: 'nordic-board',
      name: '16mm Nordic Ice',
      length_mm: 2750,
      width_mm: 1830,
      cost: 963,
      isDefault: false,
      component_id: 408,
    },
  ]);

  assert.equal(result.changed, false);
  assert.equal(result.invalidParts.length, 1);
  assert.equal(result.invalidParts[0].id, 'cfg-1');
});
