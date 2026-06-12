import assert from 'node:assert/strict';
import test from 'node:test';

import { buildBomSnapshot, createBomSnapshotEntry } from './build-bom-snapshot';
import {
  calculateBomSnapshotSurchargeTotal,
  countDroppedBomSnapshotSubstitutions,
  deriveCutlistSwapEffectsFromBomSnapshot,
  substitutionsFromBomSnapshot,
} from './snapshot-utils';

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

function makeMockClient(fixture: {
  links?: any[];
  products?: any[];
  bomRows?: any[];
  components?: any[];
  supplierComponents?: any[];
}) {
  return {
    from(table: string) {
      const query = { table, eq: [] as Array<[string, unknown]>, in: [] as Array<[string, unknown[]]> };
      const builder: any = {
        select() {
          return builder;
        },
        eq(column: string, value: unknown) {
          query.eq.push([column, value]);
          return builder;
        },
        in(column: string, values: unknown[]) {
          query.in.push([column, values]);
          return builder;
        },
        then(resolve: (value: { data: any[] | null; error: unknown }) => void) {
          if (table === 'product_bom_links') return resolve({ data: fixture.links ?? [], error: null });
          if (table === 'products') return resolve({ data: fixture.products ?? [], error: null });
          if (table === 'components') return resolve({ data: fixture.components ?? [], error: null });
          if (table === 'suppliercomponents') return resolve({ data: fixture.supplierComponents ?? [], error: null });
          if (table === 'billofmaterials') {
            const productIds = query.in.find(([column]) => column === 'product_id')?.[1] ?? [];
            return resolve({
              data: (fixture.bomRows ?? []).filter((row) => productIds.includes(row.product_id)),
              error: null,
            });
          }
          throw new Error(`Unexpected table ${table}`);
        },
      };
      return builder;
    },
  } as any;
}

const parentBomRow = {
  bom_id: 1,
  product_id: 100,
  component_id: 10,
  quantity_required: 2,
  supplier_component_id: 100,
  is_cutlist_item: false,
  cutlist_category: null,
  components: defaultComponent,
};

const childComponent = {
  component_id: 12,
  internal_code: 'SCREW',
  description: 'Drawer screw',
  category_id: 6,
  component_categories: { cat_id: 6, categoryname: 'Hardware' },
};

const childSupplierComponent = {
  supplier_component_id: 102,
  component_id: 12,
  price: 1.5,
  suppliers: { supplier_id: 2, name: 'Hardware Supplier' },
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

test('buildBomSnapshot parent-only output matches the pre-link snapshot shape', async () => {
  const snapshot = await buildBomSnapshot(100, 'org-1', [], new Map(), makeMockClient({
    links: [],
    bomRows: [parentBomRow],
    supplierComponents: [defaultSupplierComponent],
  }));

  assert.deepEqual(snapshot, [
    {
      source_bom_id: 1,
      component_id: 10,
      component_code: 'WHITE',
      component_description: 'White board',
      category_id: 5,
      category_name: 'Boards',
      supplier_component_id: 100,
      supplier_name: 'Default Supplier',
      unit_price: 20,
      quantity_required: 2,
      line_total: 40,
      swap_kind: 'default',
      is_removed: false,
      effective_component_id: 10,
      effective_component_code: 'WHITE',
      effective_quantity_required: 2,
      effective_unit_price: 20,
      effective_line_total: 40,
      default_unit_price: 20,
      surcharge_amount: 0,
      surcharge_label: null,
      is_substituted: false,
      default_component_id: 10,
      default_component_code: 'WHITE',
      is_cutlist_item: false,
      cutlist_category: null,
      cutlist_group_link: null,
      note: null,
    },
  ]);
});

test('buildBomSnapshot carries existing swap and surcharge substitutions through refresh', async () => {
  const substitutions = substitutionsFromBomSnapshot([
    {
      source_bom_id: 1,
      component_id: 11,
      component_code: 'BLACK',
      component_description: 'Black board',
      supplier_component_id: 101,
      quantity_required: 2,
      swap_kind: 'alternative',
      is_removed: false,
      effective_component_id: 11,
      effective_component_code: 'BLACK',
      effective_quantity_required: 2,
      surcharge_amount: 50,
      surcharge_label: 'Black upgrade',
      is_substituted: true,
      default_component_id: 10,
      default_component_code: 'WHITE',
    },
  ]);

  const snapshot = await buildBomSnapshot(100, 'org-1', substitutions, new Map(), makeMockClient({
    links: [],
    bomRows: [parentBomRow],
    components: [alternativeComponent],
    supplierComponents: [defaultSupplierComponent, alternativeSupplierComponent],
  }));

  assert.equal(snapshot[0].swap_kind, 'alternative');
  assert.equal(snapshot[0].effective_component_id, 11);
  assert.equal(snapshot[0].surcharge_amount, 50);
  assert.equal(calculateBomSnapshotSurchargeTotal(snapshot), 50);
  assert.equal(countDroppedBomSnapshotSubstitutions(substitutions, snapshot), 0);
});

test('dropped swap count increments when the source BOM row vanished before refresh', async () => {
  const substitutions = substitutionsFromBomSnapshot([
    {
      source_bom_id: 999,
      component_id: 11,
      swap_kind: 'alternative',
      effective_component_id: 11,
      surcharge_amount: 50,
      is_substituted: true,
      default_component_id: 10,
    },
  ]);
  const snapshot = await buildBomSnapshot(100, 'org-1', substitutions, new Map(), makeMockClient({
    links: [],
    bomRows: [parentBomRow],
    supplierComponents: [defaultSupplierComponent],
  }));

  assert.equal(countDroppedBomSnapshotSubstitutions(substitutions, snapshot), 1);
  assert.equal(calculateBomSnapshotSurchargeTotal(snapshot), 0);
});

test('buildBomSnapshot explodes phantom child BOM with scale and provenance', async () => {
  const snapshot = await buildBomSnapshot(100, 'org-1', [], new Map(), makeMockClient({
    links: [{ sub_product_id: 200, scale: 3, mode: 'phantom' }],
    products: [{ product_id: 200, name: 'Drawer Box' }],
    bomRows: [
      parentBomRow,
      {
        bom_id: 2,
        product_id: 200,
        component_id: 12,
        quantity_required: 8,
        supplier_component_id: 102,
        is_cutlist_item: false,
        cutlist_category: null,
        components: childComponent,
      },
    ],
    supplierComponents: [defaultSupplierComponent, childSupplierComponent],
  }));

  assert.equal(snapshot.length, 2);
  const child = snapshot[1];
  assert.equal(child.source_bom_id, 2);
  assert.equal(child.component_id, 12);
  assert.equal(child.effective_quantity_required, 24);
  assert.equal(child.line_total, 36);
  assert.equal(child.source_sub_product_id, 200);
  assert.equal(child.source_sub_product_name, 'Drawer Box');
  assert.equal(child.link_scale, 3);
});
