// components/features/products/reports/ProductMarginCard.tsx
'use client'

import { formatCurrency } from '@/lib/format-utils'
import type { BomCost, ProductReportStats } from '@/hooks/useProductReports'

interface ProductMarginCardProps {
  stats: ProductReportStats
  bomCost: BomCost
}

function DonutChart({ costPercent, marginPercent }: { costPercent: number; marginPercent: number }) {
  const r = 52
  const circumference = 2 * Math.PI * r
  const clampedCost = Math.max(0, Math.min(100, costPercent))
  const clampedMargin = Math.max(0, 100 - clampedCost)
  const costArc = (clampedCost / 100) * circumference
  const marginArc = (clampedMargin / 100) * circumference
  const displayMargin = Number.isNaN(marginPercent) ? 0 : marginPercent
  const isNegative = displayMargin < 0

  return (
    <div className="relative w-[120px] h-[120px] flex-shrink-0">
      <svg viewBox="0 0 120 120" className="w-[120px] h-[120px]" style={{ transform: 'rotate(-90deg)' }}>
        <circle cx="60" cy="60" r={r} fill="none" stroke="currentColor" className="text-border" strokeWidth="3" />
        <circle
          cx="60" cy="60" r={r} fill="none"
          stroke="#f87171" strokeWidth="3"
          strokeDasharray={`${costArc} ${circumference}`}
          strokeDashoffset="0"
        />
        {clampedMargin > 0 && (
          <circle
            cx="60" cy="60" r={r} fill="none"
            stroke="#4ade80" strokeWidth="3"
            strokeDasharray={`${marginArc} ${circumference}`}
            strokeDashoffset={`${-costArc}`}
          />
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`text-base font-bold leading-none ${isNegative ? 'text-red-400' : 'text-green-400'}`}>
          {Number.isNaN(marginPercent) ? 'N/A' : `${displayMargin.toFixed(1)}%`}
        </span>
        <span className="text-[10px] text-muted-foreground mt-0.5">margin</span>
      </div>
    </div>
  )
}

export default function ProductMarginCard({ stats, bomCost }: ProductMarginCardProps) {
  const { totalRevenue, totalCost, totalProfit, avgMargin, totalUnitsSold } = stats

  if (totalRevenue === 0) {
    return (
      <div className="rounded-lg border border-border/50 bg-muted/30 p-4 flex flex-col gap-3">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Margin Overview</h3>
        <p className="text-xs text-muted-foreground">No revenue data for this period.</p>
      </div>
    )
  }

  const costPercent = (totalCost / totalRevenue) * 100
  const clampedCost = Math.max(0, Math.min(100, costPercent))
  const isNegative = totalProfit < 0

  return (
    <div className="rounded-lg border border-border/50 bg-muted/30 p-4 flex flex-col gap-4">
      <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Margin Overview</h3>

      <div className="flex items-center gap-4">
        <DonutChart costPercent={costPercent} marginPercent={avgMargin} />
        <div className="flex-1 space-y-1.5 text-sm">
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">Revenue</span>
            <span className="font-medium tabular-nums">{formatCurrency(totalRevenue)}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">Cost (BOM)</span>
            <span className="font-medium text-red-400 tabular-nums">{formatCurrency(totalCost)}</span>
          </div>
          <div className="flex justify-between items-center border-t border-border/50 pt-1.5">
            <span className="font-semibold">Gross Profit</span>
            <span className={`font-bold tabular-nums ${isNegative ? 'text-red-400' : 'text-green-400'}`}>
              {formatCurrency(totalProfit)}
            </span>
          </div>
        </div>
      </div>

      <div className="space-y-1.5">
        <div className="h-2 rounded-sm bg-border overflow-hidden flex">
          <div className="bg-red-400 h-full" style={{ width: `${clampedCost}%` }} />
          <div className="bg-green-400 h-full" style={{ width: `${Math.max(0, 100 - clampedCost)}%` }} />
        </div>
        <div className="flex justify-between text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-full bg-red-400" />
            Cost {clampedCost.toFixed(1)}%
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-full bg-green-400" />
            Margin {Math.max(0, 100 - clampedCost).toFixed(1)}%
          </span>
        </div>
      </div>

      <p className="text-[10px] text-muted-foreground border-t border-border/40 pt-2">
        BOM cost: {formatCurrency(bomCost.total)}/unit · {totalUnitsSold} units sold
      </p>
    </div>
  )
}
