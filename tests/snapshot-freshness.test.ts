import test from 'node:test';
import assert from 'node:assert/strict';
import { decideSnapshotSave } from '../lib/cutlist/snapshot-freshness';

test('decideSnapshotSave: allows when result hash matches current parts', () => {
  const r = decideSnapshotSave({ resultPartsHash: 'abc123', currentPartsHash: 'abc123' });
  assert.equal(r.canSave, true);
});

test('decideSnapshotSave: blocks when result is out of date vs current parts', () => {
  const r = decideSnapshotSave({ resultPartsHash: 'abc123', currentPartsHash: 'xyz789' });
  assert.equal(r.canSave, false);
  assert.ok(r.reason);
  assert.match(r.reason!, /recalculate|out of date|stale/i);
});

test('decideSnapshotSave: blocks when no result has been computed yet', () => {
  const r = decideSnapshotSave({ resultPartsHash: undefined, currentPartsHash: 'xyz789' });
  assert.equal(r.canSave, false);
});

test('decideSnapshotSave: blocks when no current parts (empty cutlist)', () => {
  const r = decideSnapshotSave({ resultPartsHash: 'abc123', currentPartsHash: undefined });
  assert.equal(r.canSave, false);
});
