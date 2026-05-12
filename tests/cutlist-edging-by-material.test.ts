import test from 'node:test';
import assert from 'node:assert/strict';
import { computeEdgingByMaterialMap } from '../lib/cutlist/edgingByMaterial';

const edgingMaterials = [
  { id: 'edge-16', thickness_mm: 16, isDefaultForThickness: true },
  { id: 'edge-32', thickness_mm: 32, isDefaultForThickness: true },
  { id: 'edge-black', thickness_mm: 16, isDefaultForThickness: false },
];

test('computeEdgingByMaterialMap derives default and explicit edging selections', () => {
  const result = computeEdgingByMaterialMap(
    [
      {
        length_mm: 1000,
        width_mm: 500,
        quantity: 2,
        band_edges: { top: true, bottom: true, left: false, right: false },
        lamination_type: 'none',
      },
      {
        length_mm: 700,
        width_mm: 300,
        quantity: 1,
        band_edges: { top: true, bottom: true, left: true, right: true },
        lamination_type: 'with-backer',
      },
      {
        length_mm: 400,
        width_mm: 200,
        quantity: 1,
        band_edges: { top: false, bottom: false, left: true, right: false },
        lamination_type: 'none',
        edging_material_id: 'edge-black',
      },
    ],
    edgingMaterials
  );

  assert.deepEqual(Object.fromEntries(result), {
    'edge-16': 2000,
    'edge-32': 2000,
    'edge-black': 400,
  });
});

test('computeEdgingByMaterialMap merges grouped lamination edges onto the 32mm default', () => {
  const result = computeEdgingByMaterialMap(
    [
      {
        length_mm: 1000,
        width_mm: 300,
        quantity: 2,
        band_edges: { top: true, bottom: false, left: false, right: false },
        lamination_group: 'grp-1',
      },
      {
        length_mm: 1000,
        width_mm: 300,
        quantity: 3,
        band_edges: { top: false, bottom: false, left: true, right: false },
        lamination_group: 'grp-1',
      },
    ],
    edgingMaterials
  );

  assert.deepEqual(Object.fromEntries(result), {
    'edge-32': 2600,
  });
});

test('computeEdgingByMaterialMap returns no default rows when no edging material can be resolved', () => {
  const result = computeEdgingByMaterialMap(
    [
      {
        length_mm: 1000,
        width_mm: 500,
        quantity: 1,
        band_edges: { top: true, bottom: false, left: false, right: false },
        lamination_type: 'none',
      },
    ],
    []
  );

  assert.deepEqual(Object.fromEntries(result), {});
});
