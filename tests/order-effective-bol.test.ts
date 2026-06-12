import test from 'node:test'
import assert from 'node:assert/strict'

import {
  expandOrderDetailBol,
  orderBolDemandMap,
  type OrderBolRow,
} from '@/lib/labor/order-effective-bol'

const detail = {
  order_detail_id: 42,
  quantity: 2,
  product_id: 100,
}

const directBol: OrderBolRow[] = [
  {
    product_id: 100,
    product_name: 'Pedestal',
    bol_id: 10,
    job_id: 501,
    job_name: 'Assemble pedestal',
    quantity: 1,
    pay_type: 'hourly',
    hourly_rate_id: 7,
    time_per_unit: 30,
  },
]

test('direct-only product demand is unchanged', () => {
  const items = expandOrderDetailBol({
    detail,
    directBol,
    links: [],
    childBolBySubId: new Map(),
  })

  assert.equal(items.length, 1)
  assert.deepEqual(items[0], {
    order_detail_id: 42,
    product_id: 100,
    product_name: 'Pedestal',
    job_id: 501,
    job_name: 'Assemble pedestal',
    bol_id: 10,
    quantity: 2,
    pay_type: 'hourly',
    piece_rate: null,
    piece_rate_id: null,
    hourly_rate_id: 7,
    time_per_unit: 30,
    _source: 'direct',
    _sub_product_name: undefined,
  })
})

test('parent quantity times child BOL quantity times link scale', () => {
  const items = expandOrderDetailBol({
    detail,
    directBol: [],
    links: [{ sub_product_id: 200, sub_product_name: 'Drawer box', scale: 3, mode: 'phantom' }],
    childBolBySubId: new Map([
      [200, [{ bol_id: 20, job_id: 601, quantity: 1, pay_type: 'piece', piece_rate: 12, piece_rate_id: 8 }]],
    ]),
  })

  assert.equal(items.length, 1)
  assert.equal(items[0].quantity, 6)
  assert.equal(items[0].product_id, 200)
  assert.equal(items[0].bol_id, 20)
  assert.equal(items[0]._source, 'link')
  assert.equal(items[0]._sub_product_name, 'Drawer box')
})

test('two children each contribute their own BOL demand', () => {
  const items = expandOrderDetailBol({
    detail,
    directBol: [],
    links: [
      { sub_product_id: 200, sub_product_name: 'Drawer box', scale: 3, mode: 'phantom' },
      { sub_product_id: 300, sub_product_name: 'Runner pack', scale: 2, mode: 'phantom' },
    ],
    childBolBySubId: new Map([
      [200, [{ bol_id: 20, job_id: 601, quantity: 1, pay_type: 'piece' }]],
      [300, [{ bol_id: 30, job_id: 701, quantity: 4, pay_type: 'hourly' }]],
    ]),
  })

  assert.deepEqual(items.map(item => [item.product_id, item.bol_id, item.quantity]), [
    [200, 20, 6],
    [300, 30, 16],
  ])
})

test('stocked links are excluded', () => {
  const items = expandOrderDetailBol({
    detail,
    directBol,
    links: [{ sub_product_id: 200, sub_product_name: 'Drawer box', scale: 3, mode: 'stocked' }],
    childBolBySubId: new Map([
      [200, [{ bol_id: 20, job_id: 601, quantity: 1, pay_type: 'piece' }]],
    ]),
  })

  assert.equal(items.length, 1)
  assert.equal(items[0].bol_id, 10)
})

test('demand map parity gives generator and comparator the same key basis', () => {
  const generated = expandOrderDetailBol({
    detail,
    directBol,
    links: [{ sub_product_id: 200, sub_product_name: 'Drawer box', scale: 3, mode: 'phantom' }],
    childBolBySubId: new Map([
      [200, [{ bol_id: 20, job_id: 601, quantity: 1, pay_type: 'piece' }]],
    ]),
  })

  const generatorMap = orderBolDemandMap(generated)
  const comparatorMap = orderBolDemandMap(generated)

  assert.deepEqual([...generatorMap.keys()], ['42:10', '42:20'])
  assert.deepEqual(
    [...generatorMap].map(([key, item]) => [key, item.quantity]),
    [...comparatorMap].map(([key, item]) => [key, item.quantity])
  )
})
