import test from 'node:test';
import assert from 'node:assert/strict';

import { getQuoteCostingGroups, hasPersistedQuoteCostingLines, isQuoteCostingMaterialsStale } from '../lib/quotes/costing-tree';
import { computeCutlistMaterialSignature, parseMaterialSignature, writeMaterialSignature } from '../lib/quotes/costing-material-signature';
import type { QuoteItem } from '../lib/db/quotes';

function makeItem(): QuoteItem {
  return {
    id: 'item-1',
    quote_id: 'quote-1',
    description: 'Cupboard',
    qty: 2,
    unit_price: 500,
    total: 1000,
    item_type: 'priced',
    text_align: 'left',
    position: 0,
    surcharge_total: 25,
    quote_item_clusters: [
      {
        id: 'cluster-1',
        quote_item_id: 'item-1',
        name: 'Quote Costing',
        position: 0,
        markup_percent: 0,
        created_at: '2026-05-19T00:00:00Z',
        updated_at: '2026-05-19T00:00:00Z',
        quote_cluster_lines: [
          {
            id: 'board-1',
            cluster_id: 'cluster-1',
            line_type: 'component',
            description: 'White melamine board',
            qty: 1.5,
            unit_cost: 120,
            unit_price: 100,
            component_id: 10,
            include_in_markup: true,
            sort_order: 0,
            cutlist_slot: 'primary_board',
            created_at: '',
            updated_at: '',
          },
          {
            id: 'edge-1',
            cluster_id: 'cluster-1',
            line_type: 'component',
            description: '1mm edging',
            qty: 3,
            unit_cost: 4,
            unit_price: 4,
            component_id: 20,
            include_in_markup: true,
            sort_order: 1,
            cutlist_slot: 'edging_1mm',
            created_at: '',
            updated_at: '',
          },
          {
            id: 'hardware-1',
            cluster_id: 'cluster-1',
            line_type: 'component',
            description: 'Hinge',
            qty: 4,
            unit_cost: 10,
            unit_price: 10,
            include_in_markup: true,
            sort_order: 2,
            created_at: '',
            updated_at: '',
          },
        ],
      },
    ],
  };
}

test('quote costing tree groups persisted cluster lines and reports quote-only board override', () => {
  const item = makeItem();
  const groups = getQuoteCostingGroups(item);

  assert.equal(hasPersistedQuoteCostingLines(item), true);

  const board = groups.find((group) => group.key === 'board_materials');
  assert.ok(board);
  assert.equal(board.total, 360); // 1.5 sheets × quote qty 2 × R120
  assert.equal(board.sourceTotal, 300);
  assert.equal(board.delta, 60);
  assert.equal(board.overrideCount, 1);
  assert.equal(board.lines[0].editable, true);

  const edging = groups.find((group) => group.key === 'edging');
  assert.ok(edging);
  assert.equal(edging.total, 24);
  assert.equal(edging.delta, 0);

  const hardware = groups.find((group) => group.key === 'hardware_components');
  assert.ok(hardware);
  assert.equal(hardware.total, 80);
});

test('commercial group summarizes unchanged quote price and surcharge', () => {
  const groups = getQuoteCostingGroups(makeItem());
  const commercial = groups.find((group) => group.key === 'commercial');

  assert.ok(commercial);
  assert.equal(commercial.lines.length, 2);
  assert.equal(commercial.lines[0].description, 'Quote line margin at current internal cost');
  assert.equal(commercial.lines[1].description, 'Quote swap and material surcharge total');
  assert.equal(commercial.lines[1].quoteTotal, 25);
});

test('missing board price becomes a warning line', () => {
  const item = makeItem();
  item.quote_item_clusters![0].quote_cluster_lines![0].unit_cost = null;
  item.quote_item_clusters![0].quote_cluster_lines![0].unit_price = null;

  const board = getQuoteCostingGroups(item).find((group) => group.key === 'board_materials');
  assert.ok(board);
  assert.equal(board.warningCount, 1);
  assert.equal(board.lines[0].status, 'missing_price');
  assert.equal(board.lines[0].note, 'check price on order');
});

test('material signature parser and writer preserve human notes', () => {
  const notes = writeMaterialSignature('Human note', 'abc123');
  assert.equal(notes, 'Human note\n<MATERIAL_SIGNATURE_V1:abc123>');
  assert.equal(parseMaterialSignature(notes), 'abc123');
  assert.equal(writeMaterialSignature(notes, 'def456'), 'Human note\n<MATERIAL_SIGNATURE_V1:def456>');
});

test('quote costing material stale detection uses marker and component-set fallback', () => {
  const snapshot = [{ id: 'g1', parts: [{ id: 'p1', length_mm: 100, width_mm: 50, quantity: 1, effective_board_id: 10, effective_edging_id: 20, band_edges: { top: true } }] }];
  const item = makeItem();
  item.cutlist_material_snapshot = snapshot as any;
  item.quote_item_clusters![0].notes = writeMaterialSignature('Human note', computeCutlistMaterialSignature(snapshot));
  assert.equal(isQuoteCostingMaterialsStale(item), false);

  item.quote_item_clusters![0].notes = writeMaterialSignature('Human note', 'changed');
  assert.equal(isQuoteCostingMaterialsStale(item), true);

  item.quote_item_clusters![0].notes = 'Human note only';
  assert.equal(isQuoteCostingMaterialsStale(item), false);

  (snapshot[0].parts[0] as any).effective_board_id = 99;
  assert.equal(isQuoteCostingMaterialsStale(item), true);
});

test('stale detection ignores default effective edging on parts with no active band edges', () => {
  const item = makeItem();
  item.quote_item_clusters![0].quote_cluster_lines = item.quote_item_clusters![0].quote_cluster_lines!.filter(
    (line) => !line.cutlist_slot?.startsWith('edging_')
  );
  item.cutlist_material_snapshot = [
    {
      source_group_id: 'g1',
      parts: [
        {
          id: 'p1',
          length_mm: 100,
          width_mm: 50,
          quantity: 1,
          effective_board_id: 10,
          effective_edging_id: 999,
          band_edges: {},
        },
      ],
    },
  ] as any;
  item.quote_item_clusters![0].notes = 'legacy note without marker';

  assert.equal(isQuoteCostingMaterialsStale(item), false);
});
