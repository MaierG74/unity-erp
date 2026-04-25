import test from 'node:test';
import assert from 'node:assert/strict';
import { isReusableOffcut } from '../lib/cutlist/offcuts';

test('grain=any: square at threshold passes', () => {
  assert.equal(isReusableOffcut({ w: 300, h: 300 }, { minUsableLength: 300, minUsableWidth: 300, minUsableGrain: 'any' }), true);
});
test('grain=any: square just below threshold fails', () => {
  assert.equal(isReusableOffcut({ w: 299, h: 299 }, { minUsableLength: 300, minUsableWidth: 300, minUsableGrain: 'any' }), false);
});
test('grain=any: long thin strip (legacy bug case) fails', () => {
  assert.equal(isReusableOffcut({ w: 150, h: 5000 }, { minUsableLength: 300, minUsableWidth: 300, minUsableGrain: 'any' }), false);
});
test('grain=any: 600x300 in either orientation passes', () => {
  assert.equal(isReusableOffcut({ w: 600, h: 300 }, { minUsableLength: 600, minUsableWidth: 300, minUsableGrain: 'any' }), true);
  assert.equal(isReusableOffcut({ w: 300, h: 600 }, { minUsableLength: 600, minUsableWidth: 300, minUsableGrain: 'any' }), true);
});
test('grain=length: long-grain piece passes', () => {
  assert.equal(isReusableOffcut({ w: 300, h: 600 }, { minUsableLength: 600, minUsableWidth: 300, minUsableGrain: 'length' }), true);
});
test('grain=length: same rect rotated fails (cross-grain orientation)', () => {
  assert.equal(isReusableOffcut({ w: 600, h: 300 }, { minUsableLength: 600, minUsableWidth: 300, minUsableGrain: 'length' }), false);
});
test('grain=width: swapped axis check', () => {
  assert.equal(isReusableOffcut({ w: 600, h: 300 }, { minUsableLength: 600, minUsableWidth: 300, minUsableGrain: 'width' }), true);
});
test('grain=length: below width minimum fails', () => {
  assert.equal(isReusableOffcut({ w: 300, h: 600 }, { minUsableLength: 600, minUsableWidth: 400, minUsableGrain: 'length' }), false);
});
test('grain=any: max-side gate uses Math.max correctly', () => {
  assert.equal(isReusableOffcut({ w: 200, h: 700 }, { minUsableLength: 600, minUsableWidth: 200, minUsableGrain: 'any' }), true);
  assert.equal(isReusableOffcut({ w: 200, h: 700 }, { minUsableLength: 600, minUsableWidth: 300, minUsableGrain: 'any' }), false);
});
