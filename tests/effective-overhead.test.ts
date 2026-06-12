import test from 'node:test'
import assert from 'node:assert/strict'

import {
  computeEffectiveOverheadLines,
  type DirectOverheadRow,
} from '@/lib/products/effective-overhead'

function fixed(id: number, value: number, quantity = 1): DirectOverheadRow {
  return {
    id,
    element_id: id,
    code: `FIX${id}`,
    name: `Fixed ${id}`,
    cost_type: 'fixed',
    percentage_basis: null,
    quantity,
    default_value: value,
    override_value: null,
  }
}

function percentage(
  id: number,
  value: number,
  basis: 'materials' | 'labor' | 'total',
  override_value: number | null = null,
): DirectOverheadRow {
  return {
    id,
    element_id: id,
    code: `PCT${id}`,
    name: `Percent ${id}`,
    cost_type: 'percentage',
    percentage_basis: basis,
    quantity: 1,
    default_value: value,
    override_value,
  }
}

test('fixed child overhead scales by link quantity', () => {
  const result = computeEffectiveOverheadLines({
    direct: [],
    links: [{ sub_product_id: 20, sub_product_name: 'Drawer Box', scale: 3, mode: 'phantom' }],
    childOverheadBySubId: new Map([[20, [fixed(1, 10)]]]),
    childBasisBySubId: new Map([[20, { materialsCost: 200, labourCost: 50 }]]),
  })

  assert.equal(result.length, 1)
  assert.equal(result[0].resolved_unit_amount, 30)
  assert.equal(result[0]._source, 'link')
  assert.equal(result[0]._editable, false)
  assert.equal(result[0]._sub_product_name, 'Drawer Box')
})

test('percentage child overhead resolves against child materials before scaling', () => {
  const result = computeEffectiveOverheadLines({
    direct: [],
    links: [{ sub_product_id: 20, sub_product_name: 'Drawer Box', scale: 3, mode: 'phantom' }],
    childOverheadBySubId: new Map([[20, [percentage(2, 5, 'materials')]]]),
    childBasisBySubId: new Map([[20, { materialsCost: 200, labourCost: 900 }]]),
  })

  assert.equal(result[0].resolved_unit_amount, 30)
})

test('percentage child overhead uses override value when present', () => {
  const result = computeEffectiveOverheadLines({
    direct: [],
    links: [{ sub_product_id: 20, sub_product_name: 'Drawer Box', scale: 2, mode: 'phantom' }],
    childOverheadBySubId: new Map([[20, [percentage(3, 5, 'labor', 10)]]]),
    childBasisBySubId: new Map([[20, { materialsCost: 200, labourCost: 50 }]]),
  })

  assert.equal(result[0].value, 10)
  assert.equal(result[0].resolved_unit_amount, 10)
})

test('two children contribute their own scaled overhead lines', () => {
  const result = computeEffectiveOverheadLines({
    direct: [],
    links: [
      { sub_product_id: 20, sub_product_name: 'Drawer Box', scale: 3, mode: 'phantom' },
      { sub_product_id: 30, sub_product_name: 'Runner Kit', scale: 2, mode: 'phantom' },
    ],
    childOverheadBySubId: new Map([
      [20, [fixed(4, 10)]],
      [30, [fixed(5, 7)]],
    ]),
    childBasisBySubId: new Map(),
  })

  assert.deepEqual(result.map((line) => line.resolved_unit_amount), [30, 14])
  assert.deepEqual(result.map((line) => line._sub_product_id), [20, 30])
})

test('stocked links are excluded', () => {
  const result = computeEffectiveOverheadLines({
    direct: [],
    links: [{ sub_product_id: 20, sub_product_name: 'Drawer Box', scale: 3, mode: 'stocked' }],
    childOverheadBySubId: new Map([[20, [fixed(6, 10)]]]),
    childBasisBySubId: new Map([[20, { materialsCost: 200, labourCost: 50 }]]),
  })

  assert.deepEqual(result, [])
})

test('child with no overhead contributes nothing while direct rows remain', () => {
  const result = computeEffectiveOverheadLines({
    direct: [fixed(7, 12, 2)],
    links: [{ sub_product_id: 20, sub_product_name: 'Drawer Box', scale: 3, mode: 'phantom' }],
    childOverheadBySubId: new Map([[20, []]]),
    childBasisBySubId: new Map([[20, { materialsCost: 200, labourCost: 50 }]]),
  })

  assert.equal(result.length, 1)
  assert.equal(result[0]._source, 'direct')
  assert.equal(result[0].resolved_unit_amount, 24)
})
