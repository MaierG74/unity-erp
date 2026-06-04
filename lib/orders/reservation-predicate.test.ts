import assert from 'node:assert/strict';

import { targetReservable, canReserveMore } from './reservation-predicate';

declare const test: (name: string, fn: () => void) => void;

test('targetReservable returns 0 when available is 0', () => {
  assert.equal(targetReservable(4, 0), 0);
});

test('targetReservable returns required when available is plentiful', () => {
  assert.equal(targetReservable(4, 1934), 4);
});

test('targetReservable returns available when partial cover', () => {
  assert.equal(targetReservable(10, 6), 6);
});

test('targetReservable clamps negative available to 0', () => {
  assert.equal(targetReservable(4, -3), 0);
});

test('targetReservable clamps required = 0 to 0', () => {
  assert.equal(targetReservable(0, 1000), 0);
});

test('canReserveMore returns false when target equals already reserved', () => {
  assert.equal(canReserveMore(4, 1934, 4), false);
});

test('canReserveMore returns true when more can still be reserved', () => {
  assert.equal(canReserveMore(10, 6, 3), true);
});

test('canReserveMore returns false when no stock at all', () => {
  assert.equal(canReserveMore(4, 0, 0), false);
});

test('canReserveMore returns false when over-reserved (defensive)', () => {
  assert.equal(canReserveMore(4, 1934, 10), false);
});

test('canReserveMore handles NaN-safe inputs', () => {
  assert.equal(canReserveMore(Number.NaN, 100, 0), false);
  assert.equal(canReserveMore(4, Number.NaN, 0), false);
  assert.equal(canReserveMore(4, 100, Number.NaN), true);
});
