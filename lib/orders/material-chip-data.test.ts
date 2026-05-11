import assert from 'node:assert/strict';

import { resolveMaterialChip } from './material-chip-data';

declare const test: (name: string, fn: () => void) => void;

test('resolveMaterialChip returns hidden when product has no cutlist snapshot', () => {
  const result = resolveMaterialChip({
    cutlistMaterialSnapshot: null,
    cutlistPrimaryMaterialId: null,
    cutlistPartOverrides: [],
  });
  assert.equal(result.kind, 'hidden');
});

test('resolveMaterialChip returns not-configured when snapshot exists but line primary is null', () => {
  const result = resolveMaterialChip({
    cutlistMaterialSnapshot: [{ board_type: '16mm-single', parts: [{ name: 'Top' }] } as any],
    cutlistPrimaryMaterialId: null,
    cutlistPartOverrides: [],
  });
  assert.equal(result.kind, 'not-configured');
});

test('resolveMaterialChip returns not-configured even when group carries a primary_material_id default', () => {
  const result = resolveMaterialChip({
    cutlistMaterialSnapshot: [{
      board_type: '16mm-single',
      primary_material_id: 42,
      primary_material_name: 'Dark Grey MFC',
      parts: [{ name: 'Top', effective_board_name: 'Dark Grey MFC' }],
    } as any],
    cutlistPrimaryMaterialId: null,
    cutlistPartOverrides: [],
  });
  assert.equal(result.kind, 'not-configured');
});

test('resolveMaterialChip prefers part effective_board_name from the snapshot', () => {
  const result = resolveMaterialChip({
    cutlistMaterialSnapshot: [{
      board_type: '16mm-single',
      primary_material_id: 42,
      primary_material_name: 'Dark Grey MFC',
      parts: [{ name: 'Top', effective_board_name: 'Oak Veneer' }],
    } as any],
    cutlistPrimaryMaterialId: 42,
    cutlistPartOverrides: [],
  });
  assert.equal(result.kind, 'single');
  assert.deepEqual(result.primaries, ['Oak Veneer']);
  assert.equal(result.overrideCount, 0);
});

test('resolveMaterialChip falls back to group primary_material_name when part has no effective name', () => {
  const result = resolveMaterialChip({
    cutlistMaterialSnapshot: [{
      board_type: '16mm-single',
      primary_material_id: 42,
      primary_material_name: 'Dark Grey MFC',
      parts: [{ name: 'Top' }],
    } as any],
    cutlistPrimaryMaterialId: 42,
    cutlistPartOverrides: [],
  });
  assert.equal(result.kind, 'single');
  assert.deepEqual(result.primaries, ['Dark Grey MFC']);
});

test('resolveMaterialChip surfaces override count when overrides exist', () => {
  const result = resolveMaterialChip({
    cutlistMaterialSnapshot: [{
      board_type: '16mm-single',
      primary_material_id: 42,
      primary_material_name: 'Dark Grey MFC',
      parts: [{ name: 'Top', effective_board_name: 'Dark Grey MFC' }],
    } as any],
    cutlistPrimaryMaterialId: 42,
    cutlistPartOverrides: [{ part_id: 'a' }, { part_id: 'b' }],
  });
  assert.equal(result.kind, 'single');
  assert.equal(result.overrideCount, 2);
});

test('resolveMaterialChip returns multiple primaries when groups carry different effective names', () => {
  const result = resolveMaterialChip({
    cutlistMaterialSnapshot: [
      {
        board_type: '32mm-backer',
        primary_material_id: 7,
        primary_material_name: 'Oak Veneer',
        parts: [{ name: 'Side', effective_board_name: 'Oak Veneer' }],
      } as any,
      {
        board_type: '16mm-single',
        primary_material_id: 42,
        primary_material_name: 'Dark Grey MFC',
        parts: [{ name: 'Top', effective_board_name: 'Dark Grey MFC' }],
      } as any,
    ],
    cutlistPrimaryMaterialId: 42,
    cutlistPartOverrides: [],
  });
  assert.equal(result.kind, 'multiple');
  assert.deepEqual(result.primaries.sort(), ['Dark Grey MFC', 'Oak Veneer']);
});

test('resolveMaterialChip falls back to Material <id> only when no snapshot name resolves', () => {
  const result = resolveMaterialChip({
    cutlistMaterialSnapshot: [{
      board_type: '16mm-single',
      parts: [{ name: 'Top' }],
    } as any],
    cutlistPrimaryMaterialId: 999,
    cutlistPartOverrides: [],
  });
  assert.equal(result.kind, 'single');
  assert.deepEqual(result.primaries, ['Material 999']);
});
