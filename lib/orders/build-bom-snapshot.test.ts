import assert from 'node:assert/strict';

import { createBomSnapshotEntry } from './build-bom-snapshot';
import {
  calculateBomSnapshotSurchargeTotal,
  deriveCutlistSwapEffectsFromBomSnapshot,
} from './snapshot-utils';

declare const test: (name: string, fn: () => void) => void;

const defaultComponent = {
  component_id: 10,
  internal_code: 'WHITE',
  description: 'White board',
  category_id: 5,
  component_categories: { cat_id: 5, categoryname: 'Boards' },
};

const alternativeComponent = {
  component_id: 11,
  internal_code: 'BLACK',
  description: 'Black board',
  category_id: 5,
  component_categories: { cat_id: 5, categoryname: 'Boards' },
};

const defaultSupplierComponent = {
  supplier_component_id: 100,
  component_id: 10,
  price: 20,
  suppliers: { supplier_id: 1, name: 'Default Supplier' },
};

const alternativeSupplierComponent = {
  supplier_component_id: 101,
  component_id: 11,
  price: 35,
  suppliers: { supplier_id: 1, name: 'Default Supplier' },
};

test('default snapshot entry populates effective fields with current values', () => {
  const entry = createBomSnapshotEntry({
    sourceBomId: 1,
    defaultComponent,
    effectiveComponent: defaultComponent,
    defaultSupplierComponent,
    effectiveSupplierComponent: defaultSupplierComponent,
    quantityRequired: 2,
    swapKind: 'default',
    isCutlistItem: false,
    cutlistCategory: null,
    cutlistGroupLink: null,
  });

  assert.equal(entry.swap_kind, 'default');
  assert.equal(entry.is_removed, false);
  assert.equal(entry.is_substituted, false);
  assert.equal(entry.effective_component_id, 10);
  assert.equal(entry.effective_quantity_required, 2);
  assert.equal(entry.effective_unit_price, 20);
  assert.equal(entry.effective_line_total, 40);
  assert.equal(entry.default_unit_price, 20);
  assert.equal(entry.surcharge_amount, 0);
  assert.equal(entry.surcharge_label, null);
});

test('alternative snapshot entry stores swapped component and surcharge label override', () => {
  const entry = createBomSnapshotEntry({
    sourceBomId: 1,
    defaultComponent,
    effectiveComponent: alternativeComponent,
    defaultSupplierComponent,
    effectiveSupplierComponent: alternativeSupplierComponent,
    quantityRequired: 2,
    swapKind: 'alternative',
    isCutlistItem: true,
    cutlistCategory: 'primary',
    cutlistGroupLink: 44,
    surchargeAmount: 15,
    surchargeLabel: ' Black upgrade ',
  });

  assert.equal(entry.swap_kind, 'alternative');
  assert.equal(entry.is_removed, false);
  assert.equal(entry.is_substituted, true);
  assert.equal(entry.component_id, 11);
  assert.equal(entry.effective_component_id, 11);
  assert.equal(entry.default_component_id, 10);
  assert.equal(entry.line_total, 70);
  assert.equal(entry.effective_line_total, 70);
  assert.equal(entry.default_unit_price, 20);
  assert.equal(entry.surcharge_amount, 15);
  assert.equal(entry.surcharge_label, 'Black upgrade');
});

test('removed snapshot entry preserves default component context but has zero effective demand', () => {
  const entry = createBomSnapshotEntry({
    sourceBomId: 1,
    defaultComponent,
    effectiveComponent: defaultComponent,
    defaultSupplierComponent,
    effectiveSupplierComponent: defaultSupplierComponent,
    quantityRequired: 2,
    swapKind: 'removed',
    isCutlistItem: true,
    cutlistCategory: 'primary',
    cutlistGroupLink: 44,
    surchargeAmount: -5,
  });

  assert.equal(entry.swap_kind, 'removed');
  assert.equal(entry.is_removed, true);
  assert.equal(entry.is_substituted, true);
  assert.equal(entry.component_id, 10);
  assert.equal(entry.effective_component_id, 10);
  assert.equal(entry.quantity_required, 2);
  assert.equal(entry.line_total, 40);
  assert.equal(entry.effective_quantity_required, 0);
  assert.equal(entry.effective_unit_price, 0);
  assert.equal(entry.effective_line_total, 0);
  assert.equal(entry.surcharge_amount, -5);
});

test('surcharge amount accepts zero and numeric strings', () => {
  const zero = createBomSnapshotEntry({
    sourceBomId: 1,
    defaultComponent,
    effectiveComponent: defaultComponent,
    defaultSupplierComponent,
    effectiveSupplierComponent: defaultSupplierComponent,
    quantityRequired: 1,
    swapKind: 'default',
    isCutlistItem: false,
    cutlistCategory: null,
    cutlistGroupLink: null,
    surchargeAmount: 0,
  });
  const positiveString = createBomSnapshotEntry({
    sourceBomId: 1,
    defaultComponent,
    effectiveComponent: defaultComponent,
    defaultSupplierComponent,
    effectiveSupplierComponent: defaultSupplierComponent,
    quantityRequired: 1,
    swapKind: 'default',
    isCutlistItem: false,
    cutlistCategory: null,
    cutlistGroupLink: null,
    surchargeAmount: '12.5',
  });

  assert.equal(zero.surcharge_amount, 0);
  assert.equal(positiveString.surcharge_amount, 12.5);
});

test('calculateBomSnapshotSurchargeTotal sums negative zero and positive amounts', () => {
  assert.equal(
    calculateBomSnapshotSurchargeTotal([
      { surcharge_amount: -5 },
      { surcharge_amount: 0 },
      { surcharge_amount: 12.5 },
    ]),
    7.5
  );
});

test('deriveCutlistSwapEffectsFromBomSnapshot returns alternative overrides and removed ids', () => {
  const effects = deriveCutlistSwapEffectsFromBomSnapshot([
    {
      is_cutlist_item: true,
      default_component_id: 10,
      component_id: 11,
      effective_component_id: 11,
      effective_component_code: 'ALT',
      swap_kind: 'alternative',
    },
    {
      is_cutlist_item: true,
      default_component_id: 20,
      component_id: 20,
      effective_component_id: 20,
      is_removed: true,
      swap_kind: 'removed',
    },
  ]);

  assert.deepEqual(effects.materialOverrides.get(10), { component_id: 11, name: 'ALT' });
  assert.equal(effects.removedMaterialIds.has(20), true);
});
