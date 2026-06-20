import assert from 'node:assert/strict';
import test from 'node:test';

import { generateCupboardParts } from '../lib/configurator/templates/cupboard';
import { generatePigeonholeParts } from '../lib/configurator/templates/pigeonhole';
import {
  DEFAULT_CUPBOARD_CONFIG,
  DEFAULT_PIGEONHOLE_CONFIG,
} from '../lib/configurator/templates/types';
import type { CutlistPart } from '../lib/cutlist/types';

function partByName(parts: CutlistPart[], name: string): CutlistPart {
  const part = parts.find((candidate) => candidate.name === name);
  assert.ok(part, `Expected generated part named "${name}"`);
  return part;
}

test('cupboard laminated top/base keep pieces-v0 output by default', () => {
  const parts = generateCupboardParts({
    ...DEFAULT_CUPBOARD_CONFIG,
    topConstruction: 'laminated',
    baseConstruction: 'laminated',
  });

  assert.equal(partByName(parts, 'Top (laminated pair)').quantity, 2);
  assert.equal(partByName(parts, 'Base (laminated pair)').quantity, 2);
});

test('cupboard laminated top/base use finished-v1 output when enabled', () => {
  const parts = generateCupboardParts({
    ...DEFAULT_CUPBOARD_CONFIG,
    topConstruction: 'laminated',
    baseConstruction: 'laminated',
  }, true);

  assert.equal(partByName(parts, 'Top (laminated)').quantity, 1);
  assert.equal(partByName(parts, 'Base (laminated)').quantity, 1);
});

test('pigeonhole laminated top/base keep pieces-v0 output by default', () => {
  const parts = generatePigeonholeParts({
    ...DEFAULT_PIGEONHOLE_CONFIG,
    laminateTopBase: true,
  });

  assert.equal(partByName(parts, 'Top (laminated pair)').quantity, 2);
  assert.equal(partByName(parts, 'Base (laminated pair)').quantity, 2);
});

test('pigeonhole laminated top/base use finished-v1 output when enabled', () => {
  const parts = generatePigeonholeParts({
    ...DEFAULT_PIGEONHOLE_CONFIG,
    laminateTopBase: true,
  }, true);

  assert.equal(partByName(parts, 'Top (laminated)').quantity, 1);
  assert.equal(partByName(parts, 'Base (laminated)').quantity, 1);
});
