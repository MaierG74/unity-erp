import test from 'node:test';
import assert from 'node:assert/strict';
import { computeSourceRevision } from '../lib/orders/cutting-plan-utils';
import type { MaterialAssignments } from '../lib/orders/material-assignment-types';

const detailA = { order_detail_id: 1, quantity: 2, cutlist_snapshot: [{ a: 1 }] };
const detailB = { order_detail_id: 2, quantity: 1, cutlist_snapshot: [{ b: 2 }] };

const emptyAssignments: MaterialAssignments = {
  version: 1,
  assignments: [],
  backer_default: null,
  edging_defaults: [],
  edging_overrides: [],
};

test('same details + same assignments → same hash', () => {
  const a = computeSourceRevision([detailA, detailB], emptyAssignments);
  const b = computeSourceRevision([detailA, detailB], emptyAssignments);
  assert.equal(a, b);
});

test('different assignments → different hash (same details)', () => {
  const assignmentsV1: MaterialAssignments = {
    ...emptyAssignments,
    assignments: [{
      order_detail_id: 1, board_type: 'carcass_16mm', part_name: 'Top',
      length_mm: 100, width_mm: 50, component_id: 500, component_name: 'White MFC',
    }],
  };
  const assignmentsV2: MaterialAssignments = {
    ...emptyAssignments,
    assignments: [{
      order_detail_id: 1, board_type: 'carcass_16mm', part_name: 'Top',
      length_mm: 100, width_mm: 50, component_id: 501, component_name: 'Oak MFC',
    }],
  };
  const a = computeSourceRevision([detailA], assignmentsV1);
  const b = computeSourceRevision([detailA], assignmentsV2);
  assert.notEqual(a, b);
});

test('null assignments is treated as empty (stable hash)', () => {
  const a = computeSourceRevision([detailA], null);
  const b = computeSourceRevision([detailA], emptyAssignments);
  assert.equal(a, b, 'null and empty assignments should hash identically');
});

test('reordering assignments does not change hash (canonicalised)', () => {
  const row1 = {
    order_detail_id: 1, board_type: 'c', part_name: 'Top',
    length_mm: 100, width_mm: 50, component_id: 500, component_name: 'A',
  };
  const row2 = {
    order_detail_id: 2, board_type: 'c', part_name: 'Side',
    length_mm: 200, width_mm: 50, component_id: 501, component_name: 'B',
  };
  const a = computeSourceRevision([detailA], { ...emptyAssignments, assignments: [row1, row2] });
  const b = computeSourceRevision([detailA], { ...emptyAssignments, assignments: [row2, row1] });
  assert.equal(a, b);
});

test('backer_default change produces a different hash', () => {
  const a = computeSourceRevision([detailA], emptyAssignments);
  const b = computeSourceRevision([detailA], {
    ...emptyAssignments,
    backer_default: { component_id: 900, component_name: 'Hardboard' },
  });
  assert.notEqual(a, b);
});
