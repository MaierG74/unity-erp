'use client'

import { useQuery } from '@tanstack/react-query'
import { authorizedFetch } from '@/lib/client/auth-fetch'

export type ReportPeriod = '7d' | '30d' | '90d' | '365d' | 'all'

export interface RawOrderRow {
  orderDetailId: number
  orderId: number
  orderNumber: string | null
  customerName: string | null
  date: string | null
  quantity: number
  unitPrice: number
}

export interface BomCost {
  materials: number
  labor: number
  overhead: number
  total: number
  missingPrices: number
}

export interface OrderProfitability extends RawOrderRow {
  revenue: number
  cost: number
  profit: number
  marginPercent: number  // NaN when revenue === 0
}

export interface ProductReportStats {
  totalOrders: number       // distinct order IDs
  totalUnitsSold: number
  totalRevenue: number
  totalCost: number
  totalProfit: number
  avgMargin: number         // NaN when totalRevenue === 0
}

export interface ProductReportData {
  bomCost: BomCost
  orders: OrderProfitability[]
  stats: ProductReportStats
}

interface ApiResponse {
  bomCost: BomCost
  orders: RawOrderRow[]
}

function computeData(raw: ApiResponse): ProductReportData {
  const bomCostPerUnit = raw.bomCost.total

  const orders: OrderProfitability[] = raw.orders.map(row => {
    const revenue = row.quantity * row.unitPrice
    const cost = row.quantity * bomCostPerUnit
    const profit = revenue - cost
    const marginPercent = revenue > 0 ? (profit / revenue) * 100 : NaN
    return { ...row, revenue, cost, profit, marginPercent }
  })

  const distinctOrders = new Set(orders.map(o => o.orderId)).size
  const totalUnitsSold = orders.reduce((s, o) => s + o.quantity, 0)
  const totalRevenue = orders.reduce((s, o) => s + o.revenue, 0)
  const totalCost = orders.reduce((s, o) => s + o.cost, 0)
  const totalProfit = totalRevenue - totalCost
  const avgMargin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : NaN

  return {
    bomCost: raw.bomCost,
    orders,
    stats: {
      totalOrders: distinctOrders,
      totalUnitsSold,
      totalRevenue,
      totalCost,
      totalProfit,
      avgMargin,
    },
  }
}

export function useProductReports(productId: number, period: ReportPeriod = 'all') {
  return useQuery<ProductReportData>({
    queryKey: ['product-reports', productId, period],
    queryFn: async () => {
      const res = await authorizedFetch(
        `/api/products/${productId}/reports?period=${period}`
      )
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.error ?? `Request failed (${res.status})`)
      }
      const raw: ApiResponse = await res.json()
      return computeData(raw)
    },
    staleTime: 60_000,
  })
}
