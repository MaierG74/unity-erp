import type { QuoteItem } from '../db/quotes'

export interface CostBreakdown {
  materials: number  // sum of component + manual lines × qty
  labor: number      // sum of labor lines × qty
  overhead: number   // sum of overhead lines × qty
  total: number      // materials + labor + overhead
}

export interface ItemReportData {
  id: string
  description: string
  qty: number
  revenue: number           // qty × unit_price
  costBreakdown: CostBreakdown  // total costs (per-unit × item qty)
  perUnitCost: number       // raw cluster subtotal before item-qty multiplication
  markupAmount: number      // unit_price - perUnitCost (per-unit)
  markupPercent: number     // (markupAmount / perUnitCost) * 100; NaN if perUnitCost is 0
  sellPrice: number         // unit_price
  marginPercent: number     // (revenue - total cost) / revenue × 100; NaN if revenue is 0
  hasCosting: boolean
  position: number
}

export interface QuoteReportData {
  // Overall profitability (only over costed items)
  totalRevenue: number
  totalCost: number
  totalProfit: number
  marginPercent: number    // NaN when no costed revenue

  // Aggregated cost composition (only over costed items)
  costBreakdown: CostBreakdown

  // Per-item detail (all priced items, costed or not)
  items: ItemReportData[]

  hasAnyCosting: boolean

  // Health stats
  totalItems: number
  costedItems: number
  uncostedItems: number
  avgMargin: number                                                     // equals marginPercent (revenue-weighted)
  lowestMarginItem: { description: string; marginPercent: number } | null  // among costed items with revenue > 0
  highestValueItem: { description: string; sellPrice: number } | null  // among costed items
}

export function computeQuoteReportData(items: QuoteItem[]): QuoteReportData {
  const pricedItems = items.filter(item => item.item_type === 'priced')

  const itemResults: ItemReportData[] = pricedItems.map(item => {
    const revenue = item.qty * item.unit_price
    let hasAnyCostLine = false

    // Per-unit cost broken down by line_type
    let perUnitMaterials = 0
    let perUnitLabor = 0
    let perUnitOverhead = 0

    for (const cluster of item.quote_item_clusters ?? []) {
      for (const line of cluster.quote_cluster_lines ?? []) {
        if (line.unit_cost != null) {
          hasAnyCostLine = true
          const lineTotal = line.qty * line.unit_cost
          if (line.line_type === 'component' || line.line_type === 'manual') {
            perUnitMaterials += lineTotal
          } else if (line.line_type === 'labor') {
            perUnitLabor += lineTotal
          } else if (line.line_type === 'overhead') {
            perUnitOverhead += lineTotal
          }
        }
      }
    }

    const perUnitCost = perUnitMaterials + perUnitLabor + perUnitOverhead

    const costBreakdown: CostBreakdown = {
      materials: perUnitMaterials * item.qty,
      labor: perUnitLabor * item.qty,
      overhead: perUnitOverhead * item.qty,
      total: perUnitCost * item.qty,
    }

    const markupAmount = item.unit_price - perUnitCost
    const markupPercent = perUnitCost !== 0 ? (markupAmount / perUnitCost) * 100 : NaN
    const marginPercent = revenue !== 0 ? ((revenue - costBreakdown.total) / revenue) * 100 : NaN

    return {
      id: item.id,
      description: item.description,
      qty: item.qty,
      revenue,
      costBreakdown,
      perUnitCost,
      markupAmount,
      markupPercent,
      sellPrice: item.unit_price,
      marginPercent,
      hasCosting: hasAnyCostLine,
      position: item.position,
    }
  })

  const costedItemResults = itemResults.filter(i => i.hasCosting)

  const totalRevenue = costedItemResults.reduce((sum, i) => sum + i.revenue, 0)
  const totalCost = costedItemResults.reduce((sum, i) => sum + i.costBreakdown.total, 0)
  const totalProfit = totalRevenue - totalCost
  const marginPercent = totalRevenue !== 0 ? (totalProfit / totalRevenue) * 100 : NaN

  const costBreakdown: CostBreakdown = {
    materials: costedItemResults.reduce((sum, i) => sum + i.costBreakdown.materials, 0),
    labor: costedItemResults.reduce((sum, i) => sum + i.costBreakdown.labor, 0),
    overhead: costedItemResults.reduce((sum, i) => sum + i.costBreakdown.overhead, 0),
    total: totalCost,
  }

  // Health stats
  const costedItems = costedItemResults.length
  const totalItems = itemResults.length
  const uncostedItems = totalItems - costedItems

  // Lowest margin: among costed items with valid (non-NaN) margin
  const costedWithMargin = costedItemResults.filter(i => !Number.isNaN(i.marginPercent))
  const lowestMarginItem = costedWithMargin.length > 0
    ? costedWithMargin.reduce((min, i) => i.marginPercent < min.marginPercent ? i : min)
    : null

  // Highest value: among costed items, by sell price
  const highestValueItem = costedItemResults.length > 0
    ? costedItemResults.reduce((max, i) => i.sellPrice > max.sellPrice ? i : max)
    : null

  return {
    totalRevenue,
    totalCost,
    totalProfit,
    marginPercent,
    costBreakdown,
    items: itemResults,
    hasAnyCosting: costedItems > 0,
    totalItems,
    costedItems,
    uncostedItems,
    avgMargin: marginPercent,
    lowestMarginItem: lowestMarginItem
      ? { description: lowestMarginItem.description, marginPercent: lowestMarginItem.marginPercent }
      : null,
    highestValueItem: highestValueItem
      ? { description: highestValueItem.description, sellPrice: highestValueItem.sellPrice }
      : null,
  }
}
