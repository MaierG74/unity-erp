'use client'

import { useState } from 'react'
import { useProductReports, type ReportPeriod } from '@/hooks/useProductReports'
import { formatCurrency } from '@/lib/format-utils'
import ProductHealthBar from './reports/ProductHealthBar'
import ProductMarginCard from './reports/ProductMarginCard'
import BomCostCard from './reports/BomCostCard'
import OrderHistoryTable from './reports/OrderHistoryTable'
import MarginTrendChart from './reports/MarginTrendChart'

const PERIOD_LABELS: Record<ReportPeriod, string> = {
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  '90d': 'Last quarter',
  '365d': 'Last year',
  'all': 'All time',
}

interface ProductReportsTabProps {
  productId: number
}

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-muted/40 ${className}`} />
}

export default function ProductReportsTab({ productId }: ProductReportsTabProps) {
  const [period, setPeriod] = useState<ReportPeriod>('all')
  const { data, isLoading, error, refetch } = useProductReports(productId, period)

  return (
    <div className="space-y-4">
      {/* Period selector + info banner */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Period</label>
          <select
            value={period}
            onChange={e => setPeriod(e.target.value as ReportPeriod)}
            className="text-sm rounded-sm border border-border/50 bg-[#12141c] text-foreground px-2 py-1 focus:outline-none focus:ring-1 focus:ring-ring"
          >
            {(Object.keys(PERIOD_LABELS) as ReportPeriod[]).map(p => (
              <option key={p} value={p}>{PERIOD_LABELS[p]}</option>
            ))}
          </select>
        </div>

        {data && !data.bomCostAvailable && (
          <div className="text-xs px-3 py-2 rounded-sm border border-red-500/40 bg-red-500/10 text-red-400">
            BOM cost could not be loaded — profitability data unavailable.
          </div>
        )}
        {data && data.bomCostAvailable && (
          <div className={`text-xs px-3 py-2 rounded-sm border ${
            data.bomCost.missingPrices > 0
              ? 'border-amber-500/40 bg-amber-500/10 text-amber-400'
              : 'border-border/40 bg-muted/20 text-muted-foreground'
          }`}>
            {data.bomCost.missingPrices > 0
              ? `⚠ ${data.bomCost.missingPrices} BOM item${data.bomCost.missingPrices > 1 ? 's' : ''} missing supplier prices — cost may be understated.`
              : `Costs based on current BOM pricing (${formatCurrency(data.bomCost.total)}/unit). Per-order actual costing coming soon.`
            }
          </div>
        )}
      </div>

      {/* Loading skeleton */}
      {isLoading && (
        <div className="space-y-4">
          <div className="flex gap-3">
            {[1,2,3,4,5].map(i => <Skeleton key={i} className="flex-1 h-16" />)}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Skeleton className="h-48" />
            <Skeleton className="h-48" />
          </div>
          <Skeleton className="h-56" />
          <Skeleton className="h-48" />
        </div>
      )}

      {/* Error state */}
      {error && !isLoading && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 flex items-center justify-between">
          <p className="text-sm text-red-400">Failed to load report data: {(error as Error).message}</p>
          <button
            onClick={() => refetch()}
            className="text-xs text-red-400 border border-red-500/40 rounded px-2 py-1 hover:bg-red-500/10"
          >
            Retry
          </button>
        </div>
      )}

      {/* Report sections */}
      {data && !isLoading && (
        <div className="space-y-4">
          {/* Section 1: Health bar */}
          <ProductHealthBar stats={data.stats} />

          {/* Section 2 + 3: Two-column cards — suppressed when BOM cost unavailable */}
          {data.bomCostAvailable ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <ProductMarginCard stats={data.stats} bomCost={data.bomCost} />
              <BomCostCard bomCost={data.bomCost} />
            </div>
          ) : (
            <div className="rounded-sm border border-border/40 bg-muted/10 px-4 py-3 text-sm text-muted-foreground">
              Margin and BOM cost breakdown unavailable — N/A
            </div>
          )}

          {/* Section 4: Order history table */}
          <OrderHistoryTable orders={data.orders} bomCostPerUnit={data.bomCostAvailable ? data.bomCost.total : NaN} />

          {/* Section 5: Margin trend — suppressed when BOM cost unavailable */}
          {data.bomCostAvailable && <MarginTrendChart orders={data.orders} />}
        </div>
      )}
    </div>
  )
}
