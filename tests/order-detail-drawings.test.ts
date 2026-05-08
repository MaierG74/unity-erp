import assert from 'node:assert/strict';
import test from 'node:test';

import { orderDrawingStoragePath } from '../lib/db/order-detail-drawings';

test('returns order-detail drawing storage path', () => {
  assert.equal(
    orderDrawingStoragePath(123, 456, '123e4567-e89b-12d3-a456-426614174000', 'png'),
    'Order Drawings/123-456/123e4567-e89b-12d3-a456-426614174000.png',
  );
});

test('rejects invalid ids', () => {
  assert.throws(() => orderDrawingStoragePath(0, 456, 'uuid', 'png'), /orderDetailId must be a positive integer/);
  assert.throws(() => orderDrawingStoragePath(123, 0, 'uuid', 'png'), /bolId must be a positive integer/);
});
