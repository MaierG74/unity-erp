import assert from 'node:assert/strict';
import test from 'node:test';

import { compactPartsToCuttingPlanBatches, computeProductPieceworkLabor } from '@/lib/piecework/productCosting';
import type { CompactPart } from '@/components/features/cutlist/primitives/CompactPartsTable';

function part(overrides: Partial<CompactPart>): CompactPart {
  return {
    id: overrides.id ?? 'part-1',
    name: overrides.name ?? 'Side panel',
    length_mm: overrides.length_mm ?? 720,
    width_mm: overrides.width_mm ?? 560,
    quantity: overrides.quantity ?? 1,
    grain: overrides.grain ?? 'length',
    band_edges: overrides.band_edges ?? { top: false, right: false, bottom: false, left: false },
    lamination_type: overrides.lamination_type ?? 'none',
    material_id: overrides.material_id,
    material_label: overrides.material_label,
    material_thickness: overrides.material_thickness,
    lamination_config: overrides.lamination_config,
  };
}

test('compactPartsToCuttingPlanBatches groups by material and preserves strategy inputs', () => {
  const batches = compactPartsToCuttingPlanBatches([
    part({
      id: 'plain',
      quantity: 2,
      material_id: '1',
      material_label: 'White',
      band_edges: { top: true, right: false, bottom: false, left: false },
    }),
    part({
      id: 'custom',
      quantity: 1,
      material_id: '1',
      material_label: 'White',
      lamination_type: 'custom',
      lamination_config: {
        finalThickness: 48,
        edgeThickness: 48,
        layers: [
          { materialId: '1', materialName: 'White', isPrimary: true },
          { materialId: '2', materialName: 'Backer', isPrimary: false },
          { materialId: '3', materialName: 'Core', isPrimary: false },
        ],
      },
    }),
    part({ id: 'other', quantity: 1, material_id: '2', material_label: 'Oak' }),
  ]);

  assert.equal(batches.length, 2);
  assert.equal(batches[0].materialColorLabel, 'White');
  assert.equal(batches[0].parts.length, 2);
  assert.deepEqual(batches[0].parts[0].bandEdges, { top: true, right: false, bottom: false, left: false });
  assert.equal(batches[0].parts[1].customLayerCount, 3);
});

test('computeProductPieceworkLabor returns sorted non-zero active activity lines', async () => {
  const tables: Record<string, unknown[]> = {
    piecework_activities: [
      { id: 'edge', code: 'edge_bundles', label: 'Edging', default_rate: 4, unit_label: 'bundle' },
      { id: 'cut', code: 'cut_pieces', label: 'Cutting', default_rate: 6.5, unit_label: 'piece' },
      { id: 'future', code: 'future_activity', label: 'Future', default_rate: 99, unit_label: 'unit' },
    ],
    product_cutlist_groups: [
      {
        id: 1,
        product_id: 123,
        name: '16mm',
        board_type: '16mm',
        primary_material_id: 10,
        primary_material_name: 'White',
        backer_material_id: null,
        backer_material_name: null,
        sort_order: 0,
        parts: [
          part({
            id: 'plain',
            quantity: 3,
            band_edges: { top: true, right: false, bottom: false, left: false },
          }),
          part({
            id: 'backed',
            quantity: 1,
            lamination_type: 'with-backer',
            band_edges: { top: true, right: true, bottom: true, left: true },
          }),
        ],
      },
    ],
  };

  const supabase = {
    from(table: string) {
      const query = {
        select: () => query,
        eq: () => query,
        order: () => Promise.resolve({ data: tables[table] ?? [], error: null }),
      };
      return query;
    },
  };

  const lines = await computeProductPieceworkLabor('123', 'org-1', supabase as never);

  assert.deepEqual(lines.map((line) => line.activityLabel), ['Cutting', 'Edging']);
  assert.equal(lines[0].count, 5);
  assert.equal(lines[0].total, 32.5);
  assert.equal(lines[1].count, 4);
  assert.equal(lines[1].total, 16);
});
