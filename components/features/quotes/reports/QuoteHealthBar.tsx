'use client'

import type { QuoteReportData } from '@/lib/quotes/report-data'

interface QuoteHealthBarProps {
  data: QuoteReportData
}

function StatCard({
  label,
  value,
  valueClass = 'text-white',
}: {
  label: string
  value: React.ReactNode
  valueClass?: string
}) {
  return (
    <div className="flex-1 rounded-sm bg-[#12141c] border border-border/40 px-4 py-3 flex flex-col gap-1 min-w-0">
      <span className={`text-xl font-bold tabular-nums truncate ${valueClass}`}>{value}</span>
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
    </div>
  )
}

export default function QuoteHealthBar({ data }: QuoteHealthBarProps) {
  const { totalItems, costedItems, uncostedItems, avgMargin, lowestMarginItem } = data

  // Traffic light for avg margin
  const marginDotColor =
    Number.isNaN(avgMargin) ? '#6b7280'
    : avgMargin >= 30 ? '#4ade80'
    : avgMargin >= 15 ? '#fbbf24'
    : '#f87171'

  const marginDisplay = Number.isNaN(avgMargin) ? 'N/A' : `${avgMargin.toFixed(1)}%`
  const marginValueClass =
    Number.isNaN(avgMargin) ? 'text-muted-foreground'
    : avgMargin >= 30 ? 'text-green-400'
    : avgMargin >= 15 ? 'text-amber-400'
    : 'text-red-400'

  const missingValueClass = uncostedItems === 0 ? 'text-green-400' : 'text-amber-400'

  return (
    <div className="flex gap-3">
      <StatCard
        label="Line Items"
        value={totalItems}
      />
      <StatCard
        label="Costed"
        value={costedItems}
        valueClass="text-green-400"
      />
      <StatCard
        label="Missing Cost"
        value={uncostedItems}
        valueClass={missingValueClass}
      />
      <StatCard
        label="Avg Margin"
        value={
          <span className="flex items-center gap-2">
            <span
              className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0"
              style={{
                backgroundColor: marginDotColor,
                boxShadow: `0 0 6px ${marginDotColor}`,
              }}
            />
            {marginDisplay}
          </span>
        }
        valueClass={marginValueClass}
      />
      <StatCard
        label="Lowest Margin"
        value={
          lowestMarginItem
            ? `${lowestMarginItem.marginPercent.toFixed(1)}%`
            : '—'
        }
      />
    </div>
  )
}
