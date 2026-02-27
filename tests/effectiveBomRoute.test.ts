import test from 'node:test'
import assert from 'node:assert/strict'
import { mock } from 'node:test'

process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'https://example.test'
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'service-role-key'

test('effective BOM resolver passes underscored arguments to RPC', async () => {
  const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = []

  const mockClient = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args })
      return {
        data: [
          {
            component_id: 646,
            quantity: 1,
            supplier_price: 12.34,
            configuration_scope: 'option_set',
            option_group_code: 'HS',
            option_value_code: 'BOWH',
          },
        ],
        error: null,
      }
    },
    from: (_table: string) => {
      const builder: any = {
        select: (_columns: unknown) => builder,
        eq: () => builder,
        then: (resolve: (value: { data: any[]; error: null }) => void) =>
          resolve({ data: [], error: null }),
      }
      return builder
    },
  }

  try {
    const { resolveEffectiveBom } = await import(
      '@/app/api/products/[productId]/effective-bom/route'
    )

    const { items, meta } = await resolveEffectiveBom(mockClient as any, 55, { HS: 'BOWH' }, 'test-org')

    assert.ok(Array.isArray(items))
    assert.deepEqual(meta, { direct_count: 1, links_count: 0, exploded_count: 0 })
    assert.deepEqual(rpcCalls, [
      {
        fn: 'get_product_components',
        args: {
          _product_id: 55,
          _selected_options: { HS: 'BOWH' },
        },
      },
    ])
  } finally {
    mock.restoreAll()
  }
})
