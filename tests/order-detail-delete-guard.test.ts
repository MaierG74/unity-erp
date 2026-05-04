import test from 'node:test';
import assert from 'node:assert/strict';

import { buildOrderDetailDeleteBlock } from '@/lib/orders/order-detail-delete-guard';

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
  assert.match(block?.message ?? '', /Cancel or reverse the issued job cards/);
});
