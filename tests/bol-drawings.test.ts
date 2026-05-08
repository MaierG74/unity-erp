import assert from 'node:assert/strict';
import test from 'node:test';

import { validateImageFile } from '../lib/db/bol-drawings';

test('rejects non-image extension', () => {
  const file = new File(['%PDF'], 'drawing.pdf', { type: 'image/png' });
  assert.throws(() => validateImageFile(file), /PNG or JPEG required/);
});

test('rejects mismatched mime', () => {
  const file = new File(['not an image'], 'drawing.png', { type: 'application/pdf' });
  assert.throws(() => validateImageFile(file), /PNG or JPEG required/);
});

test('accepts PNG', () => {
  const file = new File(['png'], 'drawing.png', { type: 'image/png' });
  assert.doesNotThrow(() => validateImageFile(file));
});

test('accepts JPEG', () => {
  const file = new File(['jpeg'], 'drawing.jpeg', { type: 'image/jpeg' });
  assert.doesNotThrow(() => validateImageFile(file));
});
