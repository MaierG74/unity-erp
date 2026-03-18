'use client'

import type { ItemReportData } from '@/lib/quotes/report-data'
import { formatCurrency } from '@/lib/format-utils'

interface MarkupAnalysisCardProps {
  items: ItemReportData[]
}

function MarkupBadge({ markupPercent }: { markupPercent: number }) {
  if (Number.isNaN(markupPercent)) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-sm text-[10px] font-semibold bg-muted text-muted-foreground">
        N/A
      </span>
    )
  }
  const [bg] =
    markupPercent >= 40
      ? ['bg-green-500/20 text-green-400']
      : markupPercent >= 20
        ? ['bg-amber-500/20 text-amber-400']
        : ['bg-red-500/20 text-red-400']

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-sm text-[10px] font-semibold ${bg}`}>
      {markupPercent.toFixed(1)}%
    </span>
  )
}

function WaterfallChart({ item }: { item: ItemReportData }) {
  const rawCost = item.perUnitCost
  const markup = item.markupAmount
  const sellPrice = item.sellPrice

  const maxVal = Math.max(rawCost, markup, sellPrice, 1)
  const rawH = Math.round((rawCost / maxVal) * 160)
  const markupH = Math.round((Math.max(0, markup) / maxVal) * 160)
  const sellH = Math.round((sellPrice / maxVal) * 160)

  return (
    <div className="flex flex-col h-full">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-3">
        Price Build-up · <span className="normal-case font-normal truncate max-w-[180px] inline-block align-bottom">{item.description}</span>
      </p>
      <div className="flex items-end gap-6 flex-1 pb-2" style={{ minHeight: '200px' }}>
        {/* Raw Cost bar */}
        <div className="flex flex-col items-center gap-1 flex-1">
          <span className="text-[10px] text-muted-foreground tabular-nums">{formatCurrency(rawCost)}</span>
          <div
            className="w-full rounded-t-sm"
            style={{
              height: `${rawH}px`,
              background: 'linear-gradient(to top, #dc2626, #f87171)',
              minHeight: '8px',
            }}
          />
          <span className="text-[10px] text-muted-foreground mt-1">Raw Cost</span>
        </div>

        <div className="self-center text-muted-foreground text-sm pb-6">→</div>

        {/* Markup bar */}
        <div className="flex flex-col items-center gap-1 flex-1">
          <span className="text-[10px] text-muted-foreground tabular-nums">{formatCurrency(Math.max(0, markup))}</span>
          <div
            className="w-full rounded-t-sm"
            style={{
              height: `${markupH}px`,
              background: 'linear-gradient(to top, #d97706, #fbbf24)',
              minHeight: '8px',
            }}
          />
          <span className="text-[10px] text-muted-foreground mt-1">Markup</span>
        </div>

        <div className="self-center text-muted-foreground text-sm pb-6">=</div>

        {/* Sell Price bar */}
        <div className="flex flex-col items-center gap-1 flex-1">
          <span className="text-[10px] text-muted-foreground tabular-nums">{formatCurrency(sellPrice)}</span>
          <div
            className="w-full rounded-t-sm"
            style={{
              height: `${sellH}px`,
              background: 'linear-gradient(to top, #16a34a, #4ade80)',
              minHeight: '8px',
            }}
          />
          <span className="text-[10px] text-muted-foreground mt-1">Sell Price</span>
        </div>
      </div>
    </div>
  )
}

export default function MarkupAnalysisCard({ items }: MarkupAnalysisCardProps) {
  const costedItems = items.filter(i => i.hasCosting)

  if (costedItems.length === 0) {
    return (
      <div className="rounded-lg border border-border/50 bg-muted/30 p-4 space-y-3">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Markup Analysis
        </h3>
        <p className="text-xs text-muted-foreground">No costed items to analyse.</p>
      </div>
    )
  }

  const highestValueItem = costedItems.reduce((max, i) => i.sellPrice > max.sellPrice ? i : max)

  return (
    <div className="rounded-lg border border-border/50 bg-muted/30 p-4 space-y-3">
      <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        Markup Analysis
      </h3>

      <div className="grid grid-cols-2 gap-6">
        {/* Left: Markup table */}
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[10px] text-muted-foreground border-b border-border/50">
                <th className="text-left font-semibold uppercase tracking-wider pb-2 pr-3">Item</th>
                <th className="text-right font-semibold uppercase tracking-wider pb-2 px-2">Raw Cost</th>
                <th className="text-right font-semibold uppercase tracking-wider pb-2 px-2">Markup</th>
                <th className="text-right font-semibold uppercase tracking-wider pb-2 px-2">Sell Price</th>
                <th className="text-right font-semibold uppercase tracking-wider pb-2 pl-2">Markup %</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/30">
              {items.map(item => (
                <tr key={item.id} className={item.hasCosting ? '' : 'opacity-40'}>
                  <td className="py-2 pr-3 max-w-[120px]">
                    <span className="truncate block">{item.description}</span>
                  </td>
                  <td className="py-2 px-2 text-right tabular-nums">
                    {item.hasCosting ? formatCurrency(item.perUnitCost) : '—'}
                  </td>
                  <td className="py-2 px-2 text-right tabular-nums">
                    {item.hasCosting ? formatCurrency(item.markupAmount) : '—'}
                  </td>
                  <td className="py-2 px-2 text-right tabular-nums">
                    {formatCurrency(item.sellPrice)}
                  </td>
                  <td className="py-2 pl-2 text-right">
                    {item.hasCosting ? (
                      <MarkupBadge markupPercent={item.markupPercent} />
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Right: Waterfall chart */}
        <WaterfallChart item={highestValueItem} />
      </div>
    </div>
  )
}
