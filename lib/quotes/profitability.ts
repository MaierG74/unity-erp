import type { QuoteItem } from '../db/quotes'

export interface ItemProfitability {
  id: string
  description: string
  revenue: number
  cost: number
  profit: number
  marginPercent: number  // NaN when revenue is 0
  hasCosting: boolean
  position: number
}

export interface QuoteProfitability {
  totalRevenue: number
  totalCost: number
  totalProfit: number
  marginPercent: number  // NaN when no costed revenue
  items: ItemProfitability[]
  hasAnyCosting: boolean
}

export function computeQuoteProfitability(items: QuoteItem[]): QuoteProfitability {
  const pricedItems = items.filter(item => item.item_type === 'priced')

  const itemResults: ItemProfitability[] = pricedItems.map(item => {
    const revenue = item.qty * item.unit_price
    let cost = 0
    let hasAnyCostLine = false

    for (const cluster of item.quote_item_clusters ?? []) {
      for (const line of cluster.quote_cluster_lines ?? []) {
        if (line.unit_cost != null) {
          hasAnyCostLine = true
          cost += line.qty * line.unit_cost
        }
      }
    }

    const profit = revenue - cost
    const marginPercent = revenue !== 0 ? (profit / revenue) * 100 : NaN

    return {
      id: item.id,
      description: item.description,
      revenue,
      cost,
      profit,
      marginPercent,
      hasCosting: hasAnyCostLine,
      position: item.position,
    }
  })

  const costedItems = itemResults.filter(i => i.hasCosting)
  const totalRevenue = costedItems.reduce((sum, i) => sum + i.revenue, 0)
  const totalCost = costedItems.reduce((sum, i) => sum + i.cost, 0)
  const totalProfit = totalRevenue - totalCost
  const marginPercent = totalRevenue !== 0 ? (totalProfit / totalRevenue) * 100 : NaN

  return {
    totalRevenue,
    totalCost,
    totalProfit,
    marginPercent,
    items: itemResults,
    hasAnyCosting: costedItems.length > 0,
  }
}
