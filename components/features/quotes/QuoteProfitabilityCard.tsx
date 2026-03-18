'use client'

import { useMemo, useState } from 'react'
import { ChevronRight, ChevronDown, TrendingUp, AlertTriangle } from 'lucide-react'
import type { QuoteItem } from '@/lib/db/quotes'
import { computeQuoteProfitability } from '@/lib/quotes/profitability'
import { formatCurrency } from '@/lib/format-utils'

interface QuoteProfitabilityCardProps {
  items: QuoteItem[]
}

function DonutChart({ costPercent, marginPercent }: { costPercent: number; marginPercent: number }) {
  const r = 14
  const circumference = 2 * Math.PI * r
  const clampedCost = Math.max(0, Math.min(100, costPercent))
  const clampedMargin = Math.max(0, 100 - clampedCost)
  const costArc = (clampedCost / 100) * circumference
  const marginArc = (clampedMargin / 100) * circumference

  const displayMargin = Number.isNaN(marginPercent) ? 0 : marginPercent
  const isNegative = displayMargin < 0

  return (
    <div className="relative w-16 h-16 flex-shrink-0">
      <svg viewBox="0 0 36 36" className="w-16 h-16" style={{ transform: 'rotate(-90deg)' }}>
        <circle cx="18" cy="18" r={r} fill="none" stroke="currentColor" className="text-border" strokeWidth="4" />
        <circle
          cx="18" cy="18" r={r} fill="none"
          stroke="#f87171" strokeWidth="4"
          strokeDasharray={`${costArc} ${circumference}`}
          strokeDashoffset="0"
        />
        {clampedMargin > 0 && (
          <circle
            cx="18" cy="18" r={r} fill="none"
            stroke="#4ade80" strokeWidth="4"
            strokeDasharray={`${marginArc} ${circumference}`}
            strokeDashoffset={`${-costArc}`}
          />
        )}
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className={`text-xs font-bold ${isNegative ? 'text-red-400' : 'text-green-400'}`}>
          {displayMargin.toFixed(1)}%
        </span>
      </div>
    </div>
  )
}

function StackedBar({ costPercent }: { costPercent: number }) {
  const clamped = Math.max(0, Math.min(100, costPercent))
  return (
    <div className="h-1.5 rounded-full bg-border overflow-hidden flex">
      <div className="bg-red-400" style={{ width: `${clamped}%` }} />
      <div className="bg-green-400" style={{ width: `${100 - clamped}%` }} />
    </div>
  )
}

export default function QuoteProfitabilityCard({ items }: QuoteProfitabilityCardProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const profitability = useMemo(() => computeQuoteProfitability(items), [items])

  if (profitability.items.length === 0) return null

  const costPercent = profitability.totalRevenue > 0
    ? (profitability.totalCost / profitability.totalRevenue) * 100
    : 100

  const marginDisplay = Number.isNaN(profitability.marginPercent)
    ? 'N/A'
    : `${profitability.marginPercent.toFixed(1)}%`

  const isNegative = profitability.totalProfit < 0
  const marginColor = isNegative ? 'text-red-400' : 'text-green-400'

  return (
    <section className="rounded-lg border border-border/50 bg-muted/30 p-4 space-y-3">
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between gap-2 text-left"
      >
        <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <TrendingUp size={14} />
          Profitability
        </span>
        {profitability.hasAnyCosting ? (
          <span className={`text-xs font-medium ${marginColor}`}>
            Margin: {marginDisplay} · {formatCurrency(profitability.totalProfit)} profit
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">No cost data</span>
        )}
      </button>

      {isExpanded && profitability.hasAnyCosting && (
        <div className="space-y-4 pt-1">
          <div className="flex items-center gap-4">
            <DonutChart costPercent={costPercent} marginPercent={profitability.marginPercent} />
            <div className="flex-1 text-sm space-y-1">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Revenue</span>
                <span className="font-medium">{formatCurrency(profitability.totalRevenue)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Cost</span>
                <span className="font-medium text-red-400">{formatCurrency(profitability.totalCost)}</span>
              </div>
              <div className="flex justify-between border-t border-border/50 pt-1">
                <span className="font-semibold">Profit</span>
                <span className={`font-semibold ${marginColor}`}>{formatCurrency(profitability.totalProfit)}</span>
              </div>
            </div>
          </div>

          <StackedBar costPercent={costPercent} />

          <div className="space-y-2">
            <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Per Item</h4>

            <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 text-[10px] text-muted-foreground px-0.5">
              <span />
              <span className="text-right">Sell</span>
              <span className="text-right">Cost</span>
              <span className="text-right">Margin</span>
            </div>

            {profitability.items.map(item => {
              const itemCostPercent = item.revenue > 0 ? (item.cost / item.revenue) * 100 : 100
              const hasCosting = item.hasCosting
              const rowOpacity = hasCosting ? '' : 'opacity-50'

              return (
                <div key={item.id} className={`space-y-1 ${rowOpacity}`}>
                  <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 text-xs px-0.5">
                    <span className="truncate flex items-center gap-1">
                      {!hasCosting && <AlertTriangle size={10} className="text-yellow-500 flex-shrink-0" />}
                      {item.description}
                    </span>
                    <span className="text-right tabular-nums">{formatCurrency(item.revenue)}</span>
                    <span className="text-right tabular-nums">
                      {hasCosting ? formatCurrency(item.cost) : '—'}
                    </span>
                    <span className={`text-right tabular-nums ${hasCosting ? (item.marginPercent < 0 ? 'text-red-400' : 'text-green-400') : 'text-muted-foreground'}`}>
                      {!hasCosting
                        ? 'No cost'
                        : Number.isNaN(item.marginPercent)
                          ? 'N/A'
                          : `${item.marginPercent.toFixed(1)}%`
                      }
                    </span>
                  </div>
                  {hasCosting && (
                    <div className="h-1 rounded-full bg-border overflow-hidden flex">
                      <div className="bg-red-400" style={{ width: `${Math.max(0, Math.min(100, itemCostPercent))}%` }} />
                      <div className="bg-green-400" style={{ width: `${Math.max(0, 100 - Math.max(0, Math.min(100, itemCostPercent)))}%` }} />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {isExpanded && !profitability.hasAnyCosting && (
        <p className="text-xs text-muted-foreground pt-1">
          No items have costing data. Add clusters with cost lines to see margin analysis.
        </p>
      )}
    </section>
  )
}
