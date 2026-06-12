import test from 'node:test'
import assert from 'node:assert/strict'

process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'https://example.test'
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'service-role-key'

import type { LinkedCutlistGroup } from '@/lib/cutlist/linkedCutlistGroups'
import { fetchLinkedCutlistGroups } from '@/lib/cutlist/linkedCutlistGroups'
import { excludeBomRowsCoveredByLinkedGroups, type EffectiveBomItem } from '@/lib/cutlist/productCutlistLoader'
import { buildCutlistSnapshot } from '@/lib/orders/build-cutlist-snapshot'
import { resolveAggregatedGroups, type AggregateDetail } from '@/lib/orders/cutting-plan-aggregate'

// ---------------------------------------------------------------------------
// Minimal chainable supabase mock. Each query records its table, selected
// columns, and filter calls; awaiting the builder resolves via the handler.
// ---------------------------------------------------------------------------

type RecordedQuery = {
  table: string
  select: string
  eq: Array<[string, unknown]>
  in: Array<[string, unknown[]]>
  order: string[]
}

type QueryHandler = (query: RecordedQuery) => { data: unknown[] | null; error: unknown }

function makeMockClient(handler: QueryHandler, log: RecordedQuery[] = []) {
  return {
    from(table: string) {
      const query: RecordedQuery = { table, select: '', eq: [], in: [], order: [] }
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
        order(column: string) {
          query.order.push(column)
          return builder
        },
        then(resolve: (value: { data: unknown[] | null; error: unknown }) => void) {
          resolve(handler(query))
        },
      }
      return builder
    },
  } as any
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ORG = 'org-1'
const PARENT_ID = 10
const CHILD_ID = 20

const parentGroupRow = {
  id: 100,
  name: 'Carcass',
  board_type: '16mm',
  primary_material_id: 500,
  primary_material_name: 'Oak Melamine',
  backer_material_id: null,
  backer_material_name: null,
  parts: [
    {
      id: 'pp-1',
      name: 'Side',
      length_mm: 700,
      width_mm: 400,
      quantity: 2,
      grain: 'length',
      band_edges: { top: true, right: false, bottom: false, left: false },
      lamination_type: 'none',
    },
  ],
}

const childGroupRow = {
  id: 200,
  product_id: CHILD_ID,
  name: 'Drawer Sides',
  board_type: '16mm',
  primary_material_id: 600,
  primary_material_name: 'White Melamine',
  backer_material_id: null,
  backer_material_name: null,
  parts: [
    {
      id: 'cp-1',
      name: 'Drawer Side',
      length_mm: 450,
      width_mm: 150,
      quantity: 2,
      grain: 'length',
      band_edges: { top: false, right: false, bottom: false, left: false },
      lamination_type: 'none',
    },
  ],
  sort_order: 0,
}

type Fixture = {
  parentGroups?: unknown[]
  links?: Array<{ sub_product_id: number; scale: number }>
  linksError?: unknown
  childProducts?: Array<{ product_id: number; name: string }>
  childGroups?: unknown[]
}

function clientFor(fixture: Fixture, log: RecordedQuery[] = []) {
  return makeMockClient((query) => {
    if (query.table === 'product_bom_links') {
      if (fixture.linksError) return { data: null, error: fixture.linksError }
      return { data: fixture.links ?? [], error: null }
    }
    if (query.table === 'products') {
      return { data: fixture.childProducts ?? [], error: null }
    }
    if (query.table === 'product_cutlist_groups') {
      // The linked-groups query uses .in(); the parent query uses .eq('product_id').
      if (query.in.length > 0) {
        return { data: fixture.childGroups ?? [], error: null }
      }
      return { data: fixture.parentGroups ?? [], error: null }
    }
    throw new Error(`Unexpected table: ${query.table}`)
  }, log)
}

// ---------------------------------------------------------------------------
// 1. fetchLinkedCutlistGroups
// ---------------------------------------------------------------------------

test('fetchLinkedCutlistGroups returns [] when the parent has no links', async () => {
  const log: RecordedQuery[] = []
  const client = clientFor({ links: [] }, log)

  const result = await fetchLinkedCutlistGroups(client, PARENT_ID, ORG)

  assert.deepEqual(result, [])
  // Only the links query ran — no follow-up product/group fetches.
  assert.equal(log.length, 1)
  assert.equal(log[0].table, 'product_bom_links')
  assert.deepEqual(log[0].eq, [['product_id', PARENT_ID], ['org_id', ORG], ['mode', 'phantom']])
})

test('fetchLinkedCutlistGroups maps provenance and link_scale onto child groups', async () => {
  const log: RecordedQuery[] = []
  const client = clientFor({
    links: [{ sub_product_id: CHILD_ID, scale: 3 }],
    childProducts: [{ product_id: CHILD_ID, name: 'Normal Drawer Box' }],
    childGroups: [childGroupRow],
  }, log)

  const result = await fetchLinkedCutlistGroups(client, PARENT_ID, ORG)

  assert.equal(result.length, 1)
  assert.equal(result[0].id, 200)
  assert.equal(result[0].source_sub_product_id, CHILD_ID)
  assert.equal(result[0].source_sub_product_name, 'Normal Drawer Box')
  assert.equal(result[0].link_scale, 3)
  // Quantities NOT multiplied at this layer.
  assert.equal(result[0].parts[0].quantity, 2)

  const groupsQuery = log.find((q) => q.table === 'product_cutlist_groups')
  assert.ok(groupsQuery)
  assert.deepEqual(groupsQuery!.in, [['product_id', [CHILD_ID]]])
  assert.deepEqual(groupsQuery!.eq, [['org_id', ORG]])
})

// ---------------------------------------------------------------------------
// 2. buildCutlistSnapshot golden regression — parent-only product
// ---------------------------------------------------------------------------

test('buildCutlistSnapshot parent-only output matches current mapping exactly', async () => {
  const client = clientFor({ parentGroups: [parentGroupRow], links: [] })

  const { snapshot, groupMap } = await buildCutlistSnapshot(PARENT_ID, ORG, {}, client)

  assert.deepEqual(Array.from(groupMap.entries()), [[500, 100]])
  assert.deepEqual(snapshot, [
    {
      source_group_id: 100,
      name: 'Carcass',
      board_type: '16mm',
      primary_material_id: 500,
      primary_material_name: 'Oak Melamine',
      backer_material_id: null,
      backer_material_name: null,
      effective_backer_id: null,
      effective_backer_name: null,
      parts: [
        {
          id: 'pp-1',
          name: 'Side',
          length_mm: 700,
          width_mm: 400,
          quantity: 2,
          grain: 'length',
          band_edges: { top: true, right: false, bottom: false, left: false },
          lamination_type: 'none',
          effective_board_id: 500,
          effective_board_name: 'Oak Melamine',
          effective_thickness_mm: 16,
          effective_edging_id: null,
          effective_edging_name: null,
          is_overridden: false,
        },
      ],
    },
  ])
})

// ---------------------------------------------------------------------------
// 3. Parent + child ×3 — scale applied once, overrides parent-only
// ---------------------------------------------------------------------------

test('buildCutlistSnapshot explodes child groups: scale baked once, linePrimary parent-only', async () => {
  const client = clientFor({
    parentGroups: [parentGroupRow],
    links: [{ sub_product_id: CHILD_ID, scale: 3 }],
    childProducts: [{ product_id: CHILD_ID, name: 'Normal Drawer Box' }],
    childGroups: [childGroupRow],
  })

  const { snapshot, groupMap } = await buildCutlistSnapshot(PARENT_ID, ORG, {
    linePrimary: { component_id: 999, component_name: 'Walnut Melamine' },
  }, client)

  assert.ok(snapshot)
  assert.equal(snapshot!.length, 2)

  const [parent, child] = snapshot!

  // Parent group: linePrimary applied, quantities untouched, no provenance.
  assert.equal(parent.source_group_id, 100)
  assert.equal(parent.primary_material_id, 999)
  assert.equal(parent.parts[0].effective_board_id, 999)
  assert.equal(parent.parts[0].quantity, 2)
  assert.equal(parent.source_sub_product_id, undefined)
  assert.equal(parent.link_scale, undefined)

  // Child group: keeps its OWN material, quantity multiplied exactly once.
  assert.equal(child.source_group_id, 200)
  assert.equal(child.primary_material_id, 600)
  assert.equal(child.primary_material_name, 'White Melamine')
  assert.equal(child.parts[0].effective_board_id, 600)
  assert.equal(child.parts[0].quantity, 6) // 2 × scale 3
  assert.equal(child.source_sub_product_id, CHILD_ID)
  assert.equal(child.source_sub_product_name, 'Normal Drawer Box')
  assert.equal(child.link_scale, 3)

  // groupMap stays parent-only.
  assert.deepEqual(Array.from(groupMap.entries()), [[500, 100]])
})

// ---------------------------------------------------------------------------
// 4. Children-only parent — snapshot must be non-null
// ---------------------------------------------------------------------------

test('buildCutlistSnapshot returns a non-null snapshot for a children-only parent', async () => {
  const client = clientFor({
    parentGroups: [],
    links: [{ sub_product_id: CHILD_ID, scale: 2 }],
    childProducts: [{ product_id: CHILD_ID, name: 'Normal Drawer Box' }],
    childGroups: [childGroupRow],
  })

  const { snapshot, groupMap } = await buildCutlistSnapshot(PARENT_ID, ORG, {}, client)

  assert.ok(snapshot, 'children-only parent must produce a snapshot')
  assert.equal(snapshot!.length, 1)
  assert.equal(snapshot![0].source_sub_product_id, CHILD_ID)
  assert.equal(snapshot![0].parts[0].quantity, 4) // 2 × scale 2
  assert.equal(groupMap.size, 0)
})

test('buildCutlistSnapshot stays null when parent and children have no groups', async () => {
  const client = clientFor({ parentGroups: [], links: [] })
  const { snapshot } = await buildCutlistSnapshot(PARENT_ID, ORG, {}, client)
  assert.equal(snapshot, null)
})

// ---------------------------------------------------------------------------
// 5. Quantity chain sanity: 2 × scale 3 = 6 at snapshot; × lineQty 5 = 30
// ---------------------------------------------------------------------------

test('quantity chain: snapshot bakes scale once, aggregate multiplies by lineQty once', async () => {
  const client = clientFor({
    parentGroups: [],
    links: [{ sub_product_id: CHILD_ID, scale: 3 }],
    childProducts: [{ product_id: CHILD_ID, name: 'Normal Drawer Box' }],
    childGroups: [childGroupRow],
  })

  const { snapshot } = await buildCutlistSnapshot(PARENT_ID, ORG, {}, client)
  assert.ok(snapshot)
  assert.equal(snapshot![0].parts[0].quantity, 6) // 2 × 3

  const detail: AggregateDetail = {
    order_detail_id: 1,
    quantity: 5,
    product_name: 'Pedestal',
    cutlist_material_snapshot: snapshot as AggregateDetail['cutlist_material_snapshot'],
  }
  const result = resolveAggregatedGroups([detail], null)
  assert.ok(result.ok)
  if (result.ok) {
    assert.equal(result.material_groups.length, 1)
    assert.equal(result.material_groups[0].parts[0].quantity, 30) // 6 × lineQty 5
  }
})

// ---------------------------------------------------------------------------
// Review hardening
// ---------------------------------------------------------------------------

test('legacy string quantity is coerced to a number through the scale path', async () => {
  const stringQtyChildGroup = {
    ...childGroupRow,
    parts: [{ ...childGroupRow.parts[0], quantity: '2' as unknown as number }],
  }
  const client = clientFor({
    parentGroups: [],
    links: [{ sub_product_id: CHILD_ID, scale: 3 }],
    childProducts: [{ product_id: CHILD_ID, name: 'Normal Drawer Box' }],
    childGroups: [stringQtyChildGroup],
  })

  const { snapshot } = await buildCutlistSnapshot(PARENT_ID, ORG, {}, client)

  assert.ok(snapshot)
  assert.equal(snapshot![0].parts[0].quantity, 6) // "2" × 3 → 6
  assert.equal(typeof snapshot![0].parts[0].quantity, 'number')
})

test('buildCutlistSnapshot rejects when the links query errors (deliberate throw, not degrade)', async () => {
  // The API route degrades to linkedGroups: [] for the read-only view; the
  // snapshot builder must NOT — silently dropping children would freeze an
  // incomplete money snapshot onto the order line.
  const client = clientFor({
    parentGroups: [parentGroupRow],
    linksError: new Error('links query failed'),
  })

  await assert.rejects(
    () => buildCutlistSnapshot(PARENT_ID, ORG, {}, client),
    /links query failed/
  )
})

test('linked child with zero cutlist groups: parent-only snapshot, BOM rows kept by loader filter', async () => {
  const client = clientFor({
    parentGroups: [parentGroupRow],
    links: [{ sub_product_id: CHILD_ID, scale: 3 }],
    childProducts: [{ product_id: CHILD_ID, name: 'Normal Drawer Box' }],
    childGroups: [], // child has no cutlist groups of its own
  })

  const { snapshot } = await buildCutlistSnapshot(PARENT_ID, ORG, {}, client)
  assert.ok(snapshot, 'snapshot stays non-null from the parent groups')
  assert.equal(snapshot!.length, 1)
  assert.equal(snapshot![0].source_group_id, 100)
  assert.equal(snapshot![0].source_sub_product_id, undefined)

  // Loader-side: only children whose groups WERE exploded lose their
  // link-sourced BOM rows; a groupless child keeps contributing via BOM.
  const bomItems: EffectiveBomItem[] = [
    { component_id: 1, quantity_required: 1, _source: 'direct' },
    { component_id: 2, quantity_required: 1, _source: 'link', _sub_product_id: CHILD_ID },
    { component_id: 3, quantity_required: 1, _source: 'link', _sub_product_id: 99 },
  ]

  // No linked groups returned → nothing excluded.
  assert.deepEqual(
    excludeBomRowsCoveredByLinkedGroups(bomItems, []).map((i) => i.component_id),
    [1, 2, 3]
  )

  // Child 20's groups exploded → only child 20's link rows excluded;
  // groupless child 99 keeps its BOM-derived rows.
  const linkedForChild20 = [
    { ...childGroupRow, source_sub_product_id: CHILD_ID, source_sub_product_name: 'Normal Drawer Box', link_scale: 3 },
  ] as unknown as LinkedCutlistGroup[]
  assert.deepEqual(
    excludeBomRowsCoveredByLinkedGroups(bomItems, linkedForChild20).map((i) => i.component_id),
    [1, 3]
  )
})
