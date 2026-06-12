export type OverheadCostType = 'fixed' | 'percentage'
export type OverheadPercentageBasis = 'materials' | 'labor' | 'total'

export type DirectOverheadRow = {
  id: number | null
  element_id: number
  code: string
  name: string
  cost_type: OverheadCostType
  percentage_basis: OverheadPercentageBasis | null
  quantity: number
  default_value: number
  override_value: number | null
}

export type EffectiveOverheadLine = {
  id: number | null
  element_id: number
  code: string
  name: string
  cost_type: OverheadCostType
  percentage_basis: OverheadPercentageBasis | null
  quantity: number
  value: number
  resolved_unit_amount: number
  _source: 'direct' | 'link'
  _sub_product_id?: number
  _sub_product_name?: string
  _link_scale?: number
  _editable: boolean
}

type ProductLink = {
  sub_product_id: number
  sub_product_name: string
  scale: number
  mode: string
}

type CostBasis = {
  materialsCost: number
  labourCost: number
}

function numeric(value: unknown, fallback = 0): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

export function overheadValue(row: DirectOverheadRow): number {
  return row.override_value == null ? numeric(row.default_value) : numeric(row.override_value)
}

export function resolveOverheadAmount(row: DirectOverheadRow, basis: CostBasis): number {
  const value = overheadValue(row)
  const quantity = numeric(row.quantity, 1)

  if (row.cost_type === 'fixed') {
    return value * quantity
  }

  const basisAmount = row.percentage_basis === 'materials'
    ? basis.materialsCost
    : row.percentage_basis === 'labor'
      ? basis.labourCost
      : basis.materialsCost + basis.labourCost

  return (basisAmount * value / 100) * quantity
}

export function computeEffectiveOverheadLines(input: {
  direct: DirectOverheadRow[]
  links: ProductLink[]
  childOverheadBySubId: Map<number, DirectOverheadRow[]>
  childBasisBySubId: Map<number, CostBasis>
}): EffectiveOverheadLine[] {
  const lines: EffectiveOverheadLine[] = []

  for (const row of input.direct) {
    lines.push({
      id: row.id,
      element_id: row.element_id,
      code: row.code,
      name: row.name,
      cost_type: row.cost_type,
      percentage_basis: row.percentage_basis,
      quantity: numeric(row.quantity, 1),
      value: overheadValue(row),
      resolved_unit_amount: row.cost_type === 'fixed' ? resolveOverheadAmount(row, { materialsCost: 0, labourCost: 0 }) : 0,
      _source: 'direct',
      _editable: true,
    })
  }

  for (const link of input.links) {
    if (link.mode !== 'phantom') continue

    const subProductId = numeric(link.sub_product_id)
    if (!Number.isFinite(subProductId) || subProductId <= 0) continue

    const scale = numeric(link.scale, 1)
    const basis = input.childBasisBySubId.get(subProductId) ?? { materialsCost: 0, labourCost: 0 }
    const childRows = input.childOverheadBySubId.get(subProductId) ?? []

    for (const row of childRows) {
      lines.push({
        id: row.id,
        element_id: row.element_id,
        code: row.code,
        name: row.name,
        cost_type: row.cost_type,
        percentage_basis: row.percentage_basis,
        quantity: numeric(row.quantity, 1),
        value: overheadValue(row),
        resolved_unit_amount: resolveOverheadAmount(row, basis) * scale,
          _source: 'link',
          _sub_product_id: subProductId,
          _sub_product_name: link.sub_product_name,
          _link_scale: scale,
          _editable: false,
        })
    }
  }

  return lines
}
