import assert from 'node:assert/strict';
import test from 'node:test';

import { productDrawingStoragePath } from '../lib/configurator/captureProductDrawing';

test('returns product drawing storage path', () => {
  assert.equal(
    productDrawingStoragePath(859, '123e4567-e89b-12d3-a456-426614174000'),
    'Product Drawings/859/123e4567-e89b-12d3-a456-426614174000.png',
  );
});

test('rejects invalid product id', () => {
  assert.throws(() => productDrawingStoragePath(0, 'uuid'), /productId must be a positive integer/);
});
