import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildOrderDetailDeleteBlock,
  buildOrderDetailMaterialBlock,
} from '@/lib/orders/order-detail-delete-guard';

test('order detail with no work pool rows can delete normally', () => {
  assert.equal(buildOrderDetailDeleteBlock([]), null);
});

test('order detail with unissued active work pool rows is blocked explicitly', () => {
  const block = buildOrderDetailDeleteBlock([
    {
      pool_id: 10,
      source: 'bol',
      status: 'active',
      required_qty: 4,
      issued_qty: 0,
      job_name: 'Assembly',
      product_name: 'Desk',
    },
  ]);

  assert.deepEqual(block, {
    code: 'ORDER_DETAIL_HAS_WORK_POOL',
    message:
      'This product still has generated work-pool rows. Clear those work-pool rows before removing the product from the order.',
    work_pool_rows: 1,
    issued_qty: 0,
    required_qty: 4,
    linked_job_card_items: 0,
    can_clear_generated_work: true,
  });
});

test('cancelled work pool rows still block until they are cleared', () => {
  const block = buildOrderDetailDeleteBlock([
    {
      pool_id: 10,
      source: 'bol',
      status: 'cancelled',
      required_qty: 4,
      issued_qty: 0,
    },
  ]);

  assert.equal(block?.code, 'ORDER_DETAIL_HAS_WORK_POOL');
  assert.match(block?.message ?? '', /Clear those work-pool rows/);
  assert.equal(block?.can_clear_generated_work, true);
});

test('order detail with issued job-card work is blocked with stricter message', () => {
  const block = buildOrderDetailDeleteBlock([
    {
      pool_id: 10,
      source: 'bol',
      status: 'active',
      required_qty: 4,
      issued_qty: 2,
      job_name: 'Assembly',
      product_name: 'Desk',
    },
  ]);

  assert.equal(block?.code, 'ORDER_DETAIL_HAS_ISSUED_JOB_CARDS');
  assert.equal(block?.work_pool_rows, 1);
  assert.equal(block?.issued_qty, 2);
  assert.equal(block?.can_clear_generated_work, false);
  assert.match(block?.message ?? '', /Cancel or reverse the job cards/);
});

test('order detail with linked job-card history cannot clear generated work inline', () => {
  const block = buildOrderDetailDeleteBlock([
    {
      pool_id: 10,
      source: 'bol',
      status: 'active',
      required_qty: 4,
      issued_qty: 0,
      linked_job_card_items: 1,
    },
  ]);

  assert.equal(block?.code, 'ORDER_DETAIL_HAS_ISSUED_JOB_CARDS');
  assert.equal(block?.linked_job_card_items, 1);
  assert.equal(block?.can_clear_generated_work, false);
});

test('order detail with component activity is blocked for material review', () => {
  const block = buildOrderDetailMaterialBlock([
    {
      component_id: 7,
      component_label: 'LEG-001 Desk leg',
      reserved_qty: 0,
      ordered_qty: 12,
      received_qty: 0,
      issued_qty: 0,
      supplier_order_count: 1,
      stock_issuance_count: 0,
    },
  ]);

  assert.equal(block?.code, 'ORDER_DETAIL_HAS_COMPONENT_ACTIVITY');
  assert.equal(block?.can_clear_generated_work, false);
  assert.match(block?.message ?? '', /purchase-order allocations/);
});

test('order detail with no component activity has no material block', () => {
  assert.equal(
    buildOrderDetailMaterialBlock([
      {
        component_id: 7,
        component_label: 'LEG-001 Desk leg',
        reserved_qty: 0,
        ordered_qty: 0,
        received_qty: 0,
        issued_qty: 0,
        supplier_order_count: 0,
        stock_issuance_count: 0,
      },
    ]),
    null
  );
});
