import test from 'node:test'
import assert from 'node:assert/strict'

import { assertProductsSellable } from '@/lib/products/sales-guard'

type ProductsQuery = {
  table: string
  select: string
  eq: Array<[string, unknown]>
  in: Array<[string, unknown[]]>
}

type ProductRow = {
  product_id: number
  product_kind: 'sellable' | 'internal_subcomponent'
}

function makeClient(rows: ProductRow[], log: ProductsQuery[] = []) {
  return {
    from(table: string) {
      const query: ProductsQuery = { table, select: '', eq: [], in: [] }
      log.push(query)
      const builder: any = {
        select(columns: string) {
          query.select = columns
          return builder
        },
        eq(column: string, value: unknown) {
          query.eq.push([column, value])
          return builder
        },
        in(column: string, values: unknown[]) {
          query.in.push([column, values])
          return builder
        },
        then(resolve: (value: { data: ProductRow[]; error: null }) => void) {
          const ids = query.in.find(([column]) => column === 'product_id')?.[1] ?? []
          resolve({
            data: rows.filter((row) => ids.includes(row.product_id)),
            error: null,
          })
        },
      }
      return builder
    },
  } as any
}

test('assertProductsSellable passes when every found product is sellable', async () => {
  const log: ProductsQuery[] = []
  const client = makeClient([{ product_id: 1, product_kind: 'sellable' }], log)

  const result = await assertProductsSellable(client, 'org-1', [1])

  assert.deepEqual(result, { ok: true })
  assert.equal(log[0].table, 'products')
  assert.equal(log[0].select, 'product_id, product_kind')
  assert.deepEqual(log[0].eq, [['org_id', 'org-1']])
  assert.deepEqual(log[0].in, [['product_id', [1]]])
})

test('assertProductsSellable rejects an internal subcomponent', async () => {
  const client = makeClient([{ product_id: 2, product_kind: 'internal_subcomponent' }])

  const result = await assertProductsSellable(client, 'org-1', [2])

  assert.deepEqual(result, { ok: false, offendingIds: [2] })
})

test('assertProductsSellable returns only offending ids from a mixed list', async () => {
  const client = makeClient([
    { product_id: 1, product_kind: 'sellable' },
    { product_id: 2, product_kind: 'internal_subcomponent' },
    { product_id: 3, product_kind: 'internal_subcomponent' },
  ])

  const result = await assertProductsSellable(client, 'org-1', [1, 2, 3])

  assert.deepEqual(result, { ok: false, offendingIds: [2, 3] })
})

test('assertProductsSellable ignores missing product ids', async () => {
  const client = makeClient([{ product_id: 1, product_kind: 'sellable' }])

  const result = await assertProductsSellable(client, 'org-1', [1, 999])

  assert.deepEqual(result, { ok: true })
})

test('assertProductsSellable de-dupes and ignores invalid ids before querying', async () => {
  const log: ProductsQuery[] = []
  const client = makeClient([{ product_id: 5, product_kind: 'sellable' }], log)

  const result = await assertProductsSellable(client, 'org-1', [5, 5, 0, -1, Number.NaN])

  assert.deepEqual(result, { ok: true })
  assert.deepEqual(log[0].in, [['product_id', [5]]])
})
