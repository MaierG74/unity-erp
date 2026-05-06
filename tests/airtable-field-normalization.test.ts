import assert from 'node:assert/strict';
import test from 'node:test';
import {
  airtableAttachmentUrl,
  airtableFieldToNumber,
  airtableFieldToString,
} from '../lib/inventory/airtable-field-normalization';

test('normalizes Airtable scalar and lookup fields to strings', () => {
  assert.equal(airtableFieldToString('Melamine'), 'Melamine');
  assert.equal(airtableFieldToString(['Melamine']), 'Melamine');
  assert.equal(airtableFieldToString(['Board', 'Accessories']), 'Board, Accessories');
  assert.equal(airtableFieldToString(null), '');
});

test('normalizes Airtable numeric fields', () => {
  assert.equal(airtableFieldToNumber(12.5), 12.5);
  assert.equal(airtableFieldToNumber(['12.5']), 12.5);
  assert.equal(airtableFieldToNumber('not a number'), 0);
});

test('extracts the first Airtable attachment url', () => {
  assert.equal(airtableAttachmentUrl([{ url: 'https://example.com/image.jpg' }]), 'https://example.com/image.jpg');
  assert.equal(airtableAttachmentUrl([]), null);
  assert.equal(airtableAttachmentUrl('https://example.com/image.jpg'), null);
});
