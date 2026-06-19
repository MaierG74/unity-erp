import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ACTIVITY_CODES,
  countCutPieces,
  countEdgeBundles,
  STRATEGIES,
  type CuttingPlanBatch,
  type PartInBatch,
} from '@/lib/piecework/strategies';

function batch(parts: PartInBatch[]): CuttingPlanBatch {
  return {
    cuttingPlanRunId: 'run-1',
    materialColorLabel: 'White Oak / Matte',
    parts,
  };
}

function finishedModelBatch(parts: PartInBatch[]): CuttingPlanBatch {
  return {
    ...batch(parts),
    sameBoardQuantityModel: 'finished-v1',
  };
}

function part(overrides: Partial<PartInBatch>): PartInBatch {
  return {
    partId: overrides.partId ?? 'p-1',
    quantity: overrides.quantity ?? 1,
    lamination: overrides.lamination ?? 'none',
    laminationGroup: overrides.laminationGroup,
    sameBoardSourceId: overrides.sameBoardSourceId,
    laminationGroupSourceId: overrides.laminationGroupSourceId,
    bandEdges: overrides.bandEdges ?? null,
    customLayerCount: overrides.customLayerCount,
  };
}

test('plain_piece_no_lamination_no_banding_cut_1_edge_0', () => {
  const input = batch([part({ lamination: 'none', quantity: 1, bandEdges: null })]);

  assert.equal(countCutPieces(input).count, 1);
  assert.equal(countEdgeBundles(input).count, 0);
});

test('plain_piece_all_four_edges_banded_cut_1_edge_1', () => {
  const input = batch([
    part({
      lamination: 'none',
      quantity: 1,
      bandEdges: { top: true, right: true, bottom: true, left: true },
    }),
  ]);

  assert.equal(countCutPieces(input).count, 1);
  assert.equal(countEdgeBundles(input).count, 1);
});

test('plain_piece_one_banded_edge_cut_1_edge_1', () => {
  const input = batch([
    part({
      lamination: 'none',
      quantity: 1,
      bandEdges: { top: true, right: false, bottom: false, left: false },
    }),
  ]);

  assert.equal(countCutPieces(input).count, 1);
  assert.equal(countEdgeBundles(input).count, 1);
});

test('worked_example_two_16mm_pieces_laminated', () => {
  const input = batch([
    part({
      lamination: 'with-backer',
      quantity: 1,
      bandEdges: { top: true, right: true, bottom: true, left: true },
    }),
  ]);

  assert.equal(countCutPieces(input).count, 2);
  assert.equal(countEdgeBundles(input).count, 1);
});

test('same_board_lamination_banded_counts_per_dp6_resolution', () => {
  const input = batch([
    part({
      lamination: 'same-board',
      quantity: 4,
      bandEdges: { top: true, right: true, bottom: true, left: true },
    }),
  ]);

  assert.equal(countCutPieces(input).count, 4);
  assert.equal(countEdgeBundles(input).count, 2);
});

test('product_derived_same_board_finished_qty_expands_cut_once_and_edges_finished_qty', () => {
  const input = finishedModelBatch([
    part({
      lamination: 'same-board',
      quantity: 1,
      bandEdges: { top: true, right: true, bottom: true, left: true },
    }),
  ]);

  assert.equal(countCutPieces(input).count, 2);
  assert.equal(countEdgeBundles(input).count, 1);
});

test('placement_derived_same_board_physical_pieces_are_not_doubled_again', () => {
  const input = batch([
    part({
      lamination: 'same-board',
      quantity: 2,
      bandEdges: { top: true, right: true, bottom: true, left: true },
    }),
  ]);

  assert.equal(countCutPieces(input).count, 2);
  assert.equal(countEdgeBundles(input).count, 1);
});

test('grouped_same_board_finished_model_edges_one_finished_bundle_for_two_layer_rows', () => {
  const input = finishedModelBatch([
    part({
      partId: 'top-a',
      lamination: 'same-board',
      laminationGroup: 'G1',
      quantity: 1,
      bandEdges: { top: true, right: true, bottom: true, left: true },
    }),
    part({
      partId: 'top-b',
      lamination: 'same-board',
      laminationGroup: 'G1',
      quantity: 1,
      bandEdges: { top: true, right: true, bottom: true, left: true },
    }),
  ]);

  assert.equal(countCutPieces(input).count, 2);
  assert.equal(countEdgeBundles(input).count, 1);
});

test('grouped_same_board_shared_label_namespaced_by_source_edges_each_assembly', () => {
  const edges = { top: true, right: true, bottom: true, left: true };
  const input = finishedModelBatch([
    part({
      partId: 'order-1-top-a',
      lamination: 'same-board',
      laminationGroup: 'G1',
      laminationGroupSourceId: 'order-detail-1',
      quantity: 1,
      bandEdges: edges,
    }),
    part({
      partId: 'order-1-top-b',
      lamination: 'same-board',
      laminationGroup: 'G1',
      laminationGroupSourceId: 'order-detail-1',
      quantity: 1,
      bandEdges: edges,
    }),
    part({
      partId: 'order-2-top-a',
      lamination: 'same-board',
      laminationGroup: 'G1',
      laminationGroupSourceId: 'order-detail-2',
      quantity: 1,
      bandEdges: edges,
    }),
    part({
      partId: 'order-2-top-b',
      lamination: 'same-board',
      laminationGroup: 'G1',
      laminationGroupSourceId: 'order-detail-2',
      quantity: 1,
      bandEdges: edges,
    }),
  ]);

  assert.equal(countCutPieces(input).count, 4);
  assert.equal(countEdgeBundles(input).count, 2);
});

test('placement_derived_same_board_unique_part_ids_pair_by_source_part_id', () => {
  const input = batch([
    part({
      partId: 'top#1',
      sameBoardSourceId: 'top',
      lamination: 'same-board',
      quantity: 1,
      bandEdges: { top: true, right: true, bottom: true, left: true },
    }),
    part({
      partId: 'top#2',
      sameBoardSourceId: 'top',
      lamination: 'same-board',
      quantity: 1,
      bandEdges: { top: true, right: true, bottom: true, left: true },
    }),
  ]);

  assert.equal(countCutPieces(input).count, 2);
  assert.equal(countEdgeBundles(input).count, 1);
});

test('custom_lamination_banded_counts_per_dp6_resolution', () => {
  const input = batch([
    part({
      lamination: 'custom',
      quantity: 2,
      customLayerCount: 3,
      bandEdges: { top: true, right: true, bottom: true, left: true },
    }),
  ]);

  assert.equal(countCutPieces(input).count, 6);
  assert.equal(countEdgeBundles(input).count, 2);
});

test('mixed_batch_sums_correctly', () => {
  const input = batch([
    part({ partId: 'plain', lamination: 'none', quantity: 1, bandEdges: null }),
    part({
      partId: 'with-backer',
      lamination: 'with-backer',
      quantity: 2,
      bandEdges: { top: true, right: true, bottom: true, left: true },
    }),
    part({
      partId: 'same-board',
      lamination: 'same-board',
      quantity: 4,
      bandEdges: { top: true, right: false, bottom: false, left: false },
    }),
    part({
      partId: 'custom',
      lamination: 'custom',
      quantity: 1,
      customLayerCount: 3,
      bandEdges: { top: true, right: true, bottom: true, left: true },
    }),
  ]);

  assert.equal(countCutPieces(input).count, 12);
  assert.equal(countEdgeBundles(input).count, 5);
});

test('quantity_greater_than_one_multiplies_for_each_lamination_type', () => {
  const input = batch([
    part({ partId: 'none', lamination: 'none', quantity: 3, bandEdges: { top: true, right: false, bottom: false, left: false } }),
    part({ partId: 'with-backer', lamination: 'with-backer', quantity: 3, bandEdges: { top: true, right: true, bottom: true, left: true } }),
    part({ partId: 'same-board', lamination: 'same-board', quantity: 6, bandEdges: { top: true, right: true, bottom: true, left: true } }),
    part({ partId: 'custom', lamination: 'custom', quantity: 3, customLayerCount: 4, bandEdges: { top: true, right: true, bottom: true, left: true } }),
  ]);

  assert.equal(countCutPieces(input).count, 27);
  assert.equal(countEdgeBundles(input).count, 12);
});

test('strategy_registry_is_exhaustive_for_activity_code_union', () => {
  assert.ok(STRATEGIES[ACTIVITY_CODES.CUT_PIECES]);
  assert.ok(STRATEGIES[ACTIVITY_CODES.EDGE_BUNDLES]);
});
