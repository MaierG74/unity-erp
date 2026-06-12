import test from 'node:test'
import assert from 'node:assert/strict'

process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'https://example.test'
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'service-role-key'

import {
  buildQuoteProductCostingLines,
  planQuoteCostingClusterRefresh,
  type QuoteCostingLineDraft,
} from '@/lib/quotes/build-costing-cluster'

function line(overrides: Partial<any>): any {
  return {
    id: overrides.id ?? 'old-line',
    cluster_id: 'cluster-1',
    line_type: overrides.line_type ?? 'component',
    description: overrides.description ?? 'SCREW',
    qty: overrides.qty ?? 1,
    unit_cost: overrides.unit_cost ?? 10,
    unit_price: overrides.unit_price ?? 10,
    component_id: overrides.component_id ?? 20,
    supplier_component_id: overrides.supplier_component_id ?? null,
    include_in_markup: true,
    sort_order: overrides.sort_order ?? 0,
    cutlist_slot: overrides.cutlist_slot ?? null,
    cost_surcharge_kind: overrides.cost_surcharge_kind ?? null,
    cost_surcharge_value: overrides.cost_surcharge_value ?? null,
    cost_surcharge_label: overrides.cost_surcharge_label ?? null,
    cost_surcharge_resolved: overrides.cost_surcharge_resolved ?? null,
    created_at: '',
    updated_at: '',
  }
}

test('costing cluster refresh preserves manual lines and replaces product-derived lines by id', () => {
  const rebuilt: QuoteCostingLineDraft[] = [
    {
      line_type: 'component',
      description: 'SCREW',
      qty: 24,
      unit_cost: 1.5,
      unit_price: 1.5,
      component_id: 20,
      include_in_markup: true,
      sort_order: 100,
    },
  ]

  const plan = planQuoteCostingClusterRefresh(rebuilt, [
    line({ id: 'manual-1', line_type: 'manual', description: 'Install allowance', component_id: null, unit_cost: 50, unit_price: 50 }),
    line({ id: 'component-1', line_type: 'component', description: 'OLD SCREW', component_id: 20 }),
  ])

  assert.deepEqual(plan.preservedManualIds, ['manual-1'])
  assert.deepEqual(plan.deleteIds, ['component-1'])
  assert.equal(plan.insertLines.length, 1)
  assert.equal(plan.insertLines[0].description, 'SCREW')
})

test('costing cluster refresh carries matching user unit-cost override', () => {
  const rebuilt: QuoteCostingLineDraft[] = [
    {
      line_type: 'component',
      description: 'SCREW',
      qty: 24,
      unit_cost: 1.5,
      unit_price: 1.5,
      component_id: 20,
      include_in_markup: true,
      sort_order: 100,
    },
  ]

  const plan = planQuoteCostingClusterRefresh(rebuilt, [
    line({ id: 'component-1', line_type: 'component', description: 'SCREW', component_id: 20, unit_cost: 2.25, unit_price: 1.5 }),
  ])

  assert.equal(plan.insertLines[0].unit_cost, 2.25)
  assert.equal(plan.insertLines[0].unit_price, 1.5)
  assert.deepEqual(plan.deleteIds, ['component-1'])
})

test('costing cluster refresh carries matching surcharge metadata', () => {
  const rebuilt: QuoteCostingLineDraft[] = [
    {
      line_type: 'component',
      description: 'SCREW',
      qty: 24,
      unit_cost: 1.5,
      unit_price: 1.5,
      component_id: 20,
      include_in_markup: true,
      sort_order: 100,
    },
  ]

  const plan = planQuoteCostingClusterRefresh(rebuilt, [
    line({
      id: 'component-1',
      line_type: 'component',
      description: 'SCREW',
      component_id: 20,
      unit_cost: 1.8,
      unit_price: 1.5,
      cost_surcharge_kind: 'percentage',
      cost_surcharge_value: 20,
      cost_surcharge_label: 'Waste factor',
    }),
  ])

  assert.equal(plan.insertLines[0].unit_cost, 1.8)
  assert.equal(plan.insertLines[0].cost_surcharge_kind, 'percentage')
  assert.equal(plan.insertLines[0].cost_surcharge_value, 20)
  assert.equal(plan.insertLines[0].cost_surcharge_label, 'Waste factor')
})

function makeCostingClient() {
  return {
    rpc() {
      return Promise.resolve({ data: [], error: null })
    },
    from(table: string) {
      const query = { table, eq: [] as Array<[string, unknown]>, in: [] as Array<[string, unknown[]]> }
      const result = () => {
        if (table === 'product_cutlist_costing_snapshots') return { data: null, error: null }
        if (table === 'product_cutlist_groups') return { data: [], error: null }
        if (table === 'billoflabour') return { data: [], error: null }
        if (table === 'piecework_activities') return { data: [], error: null }
        if (table === 'products') return { data: [{ product_id: 200, name: 'Drawer Box' }], error: null }
        if (table === 'product_overhead_costs') return { data: [], error: null }
        if (table === 'product_bom_links') {
          return { data: [{ sub_product_id: 200, scale: 3, mode: 'phantom' }], error: null }
        }
        if (table === 'billofmaterials') {
          const productId = query.eq.find(([column]) => column === 'product_id')?.[1]
          return {
            data: productId === 200
              ? [{ product_id: 200, quantity_required: 8, suppliercomponents: { price: 1.5 } }]
              : [],
            error: null,
          }
        }
        return { data: [], error: null }
      }
      const builder: any = {
        select() { return builder },
        eq(column: string, value: unknown) {
          query.eq.push([column, value])
          return builder
        },
        in(column: string, values: unknown[]) {
          query.in.push([column, values])
          return builder
        },
        order() { return builder },
        limit() { return builder },
        maybeSingle() {
          return Promise.resolve(result())
        },
        then(resolve: (value: { data: unknown[] | null; error: unknown }) => void) {
          resolve(result())
        },
      }
      return builder
    },
  } as any
}

test('quote costing materials use exploded bom_snapshot once, not live links again', async () => {
  const lines = await buildQuoteProductCostingLines({
    supabase: makeCostingClient(),
    productId: 100,
    orgId: 'org-1',
    bomSnapshot: [
      {
        source_bom_id: 1,
        component_id: 10,
        component_code: 'PARENT',
        component_description: 'Parent component',
        quantity_required: 2,
        line_total: 20,
        is_cutlist_item: false,
        is_removed: false,
        effective_component_id: 10,
        effective_component_code: 'PARENT',
        effective_quantity_required: 2,
        effective_unit_price: 10,
        default_unit_price: 10,
      },
      {
        source_bom_id: 2,
        component_id: 20,
        component_code: 'SCREW',
        component_description: 'Drawer screw',
        quantity_required: 24,
        line_total: 36,
        is_cutlist_item: false,
        is_removed: false,
        effective_component_id: 20,
        effective_component_code: 'SCREW',
        effective_quantity_required: 24,
        effective_unit_price: 1.5,
        default_unit_price: 1.5,
        source_sub_product_id: 200,
        source_sub_product_name: 'Drawer Box',
        link_scale: 3,
      },
    ],
  })

  const componentLines = lines.filter((item) => item.line_type === 'component')
  assert.equal(componentLines.length, 2)
  assert.equal(componentLines.find((item) => item.component_id === 20)?.qty, 24)
})
