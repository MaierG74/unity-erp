import test from 'node:test'
import assert from 'node:assert/strict'

process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'https://example.test'
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'service-role-key'

function createMockClient(defaultListId: string | null, sellingPrice: number | string | null) {
  const calls: Array<{ table: string; column: string; value: unknown }> = []

  return {
    calls,
    client: {
      from(table: string) {
        const filters: Record<string, unknown> = {}
        const builder = {
          select: () => builder,
          eq: (column: string, value: unknown) => {
            filters[column] = value
            calls.push({ table, column, value })
            return builder
          },
          maybeSingle: async () => {
            if (table === 'product_price_lists') {
              return { data: defaultListId ? { id: defaultListId } : null, error: null }
            }
            if (table === 'product_prices') {
              return { data: sellingPrice == null ? null : { selling_price: sellingPrice }, error: null }
            }
            return { data: null, error: null }
          },
        }
        return builder
      },
    },
  }
}

test('quote product item route resolves default product selling price', async () => {
  const { resolveDefaultProductSellingPrice } = await import(
    '@/app/api/quotes/[id]/items/product/route'
  )
  const mock = createMockClient('standard-list', '1010.004')

  const price = await resolveDefaultProductSellingPrice(mock.client as any, 856, 'org-1')

  assert.equal(price, 1010)
  assert.deepEqual(mock.calls, [
    { table: 'product_price_lists', column: 'org_id', value: 'org-1' },
    { table: 'product_price_lists', column: 'is_default', value: true },
    { table: 'product_prices', column: 'org_id', value: 'org-1' },
    { table: 'product_prices', column: 'product_id', value: 856 },
    { table: 'product_prices', column: 'price_list_id', value: 'standard-list' },
  ])
})

test('quote product item route falls back to zero without a saved default price', async () => {
  const { resolveDefaultProductSellingPrice } = await import(
    '@/app/api/quotes/[id]/items/product/route'
  )
  const mock = createMockClient('standard-list', null)

  const price = await resolveDefaultProductSellingPrice(mock.client as any, 856, 'org-1')

  assert.equal(price, 0)
})
