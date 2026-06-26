import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isPurchaseOrderQNumber,
  suggestPurchaseOrderQNumber,
} from '@/lib/purchasing/q-number';

test('purchase-order Q numbers allow three or more sequence digits', () => {
  assert.equal(isPurchaseOrderQNumber('Q26-001'), true);
  assert.equal(isPurchaseOrderQNumber('Q26-999'), true);
  assert.equal(isPurchaseOrderQNumber('Q26-1002'), true);
  assert.equal(isPurchaseOrderQNumber(' Q26-1002 '), true);
});

test('purchase-order Q numbers keep the Q-year-hyphen shape', () => {
  assert.equal(isPurchaseOrderQNumber('26-1002'), false);
  assert.equal(isPurchaseOrderQNumber('Q2026-1002'), false);
  assert.equal(isPurchaseOrderQNumber('Q26-99'), false);
});

test('purchase-order Q number suggestions keep ids above 999 intact', () => {
  const date = new Date('2026-06-23T12:00:00Z');

  assert.equal(suggestPurchaseOrderQNumber(42, date), 'Q26-042');
  assert.equal(suggestPurchaseOrderQNumber(1002, date), 'Q26-1002');
});
