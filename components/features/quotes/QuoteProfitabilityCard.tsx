'use client'

import { useMemo } from 'react'
import { ChevronRight, TrendingUp } from 'lucide-react'
import type { QuoteItem } from '@/lib/db/quotes'
import { computeQuoteProfitability } from '@/lib/quotes/profitability'
import { formatCurrency } from '@/lib/format-utils'

interface QuoteProfitabilityCardProps {
  items: QuoteItem[]
  onNavigateToReports: () => void
}

export default function QuoteProfitabilityCard({
  items,
  onNavigateToReports,
}: QuoteProfitabilityCardProps) {
  const profitability = useMemo(() => computeQuoteProfitability(items), [items])

  if (profitability.items.length === 0) return null

  const marginDisplay = Number.isNaN(profitability.marginPercent)
    ? 'N/A'
    : `${profitability.marginPercent.toFixed(1)}%`

  const isNegative = profitability.totalProfit < 0
  const marginColor = isNegative ? 'text-red-400' : 'text-green-400'

  return (
    <section className="rounded-lg border border-border/50 bg-muted/30 p-4">
      <button
        type="button"
        onClick={onNavigateToReports}
        className="w-full flex items-center justify-between gap-2 text-left"
      >
        <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <ChevronRight size={14} />
          <TrendingUp size={14} />
          Profitability
        </span>
        {profitability.hasAnyCosting ? (
          <span className={`text-xs font-medium ${marginColor}`}>
            Margin: {marginDisplay} · {formatCurrency(profitability.totalProfit)} profit
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">No cost data · View Reports</span>
        )}
      </button>
    </section>
  )
}
