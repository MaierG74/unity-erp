'use client'

import { AlertTriangle } from 'lucide-react'
import type { ItemReportData } from '@/lib/quotes/report-data'
import { formatCurrency } from '@/lib/format-utils'

interface PerItemCostTableProps {
  items: ItemReportData[]
}

function MiniCostBar({
  materials,
  labor,
  overhead,
}: {
  materials: number
  labor: number
  overhead: number
}) {
  const total = materials + labor + overhead
  if (total === 0) return <div className="h-1.5 rounded-sm bg-border w-full" />

  const mPct = (materials / total) * 100
  const lPct = (labor / total) * 100
  const oPct = (overhead / total) * 100

  return (
    <div className="h-1.5 rounded-sm overflow-hidden flex w-full">
      <div style={{ width: `${mPct}%`, backgroundColor: '#60a5fa' }} />
      <div style={{ width: `${lPct}%`, backgroundColor: '#c084fc' }} />
      <div style={{ width: `${oPct}%`, backgroundColor: '#fbbf24' }} />
    </div>
  )
}

export default function PerItemCostTable({ items }: PerItemCostTableProps) {
  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-border/50 bg-muted/30 p-4">
        <p className="text-xs text-muted-foreground">No priced items.</p>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-border/50 bg-muted/30 p-4 space-y-3">
      <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        Per-Item Cost Breakdown
      </h3>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-[10px] text-muted-foreground border-b border-border/50">
              <th className="text-left font-semibold uppercase tracking-wider pb-2 pr-3">Item</th>
              <th className="text-right font-semibold uppercase tracking-wider pb-2 px-2">
                <span className="flex items-center justify-end gap-1">
                  <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: '#60a5fa' }} />
                  Materials
                </span>
              </th>
              <th className="text-right font-semibold uppercase tracking-wider pb-2 px-2">
                <span className="flex items-center justify-end gap-1">
                  <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: '#c084fc' }} />
                  Labor
                </span>
              </th>
              <th className="text-right font-semibold uppercase tracking-wider pb-2 px-2">
                <span className="flex items-center justify-end gap-1">
                  <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: '#fbbf24' }} />
                  Overhead
                </span>
              </th>
              <th className="text-right font-semibold uppercase tracking-wider pb-2 px-2">Total Cost</th>
              <th className="text-right font-semibold uppercase tracking-wider pb-2 px-2">Revenue</th>
              <th className="text-right font-semibold uppercase tracking-wider pb-2 px-2">Margin</th>
              <th className="text-right font-semibold uppercase tracking-wider pb-2 pl-2">Cost Split</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/30">
            {items.map(item => {
              const hasCosting = item.hasCosting
              const rowClass = hasCosting ? '' : 'opacity-50'
              const marginDisplay = !hasCosting
                ? 'No cost'
                : Number.isNaN(item.marginPercent)
                  ? 'N/A'
                  : `${item.marginPercent.toFixed(1)}%`
              const marginClass = !hasCosting
                ? 'text-muted-foreground'
                : item.marginPercent < 0
                  ? 'text-red-400'
                  : 'text-green-400'

              return (
                <tr key={item.id} className={rowClass}>
                  <td className="py-2 pr-3 max-w-[180px]">
                    <span className="flex items-center gap-1.5 truncate">
                      {!hasCosting && (
                        <AlertTriangle size={11} className="text-yellow-500 flex-shrink-0" />
                      )}
                      <span className="truncate">{item.description}</span>
                    </span>
                  </td>
                  <td className="py-2 px-2 text-right tabular-nums">
                    {hasCosting ? formatCurrency(item.costBreakdown.materials) : '—'}
                  </td>
                  <td className="py-2 px-2 text-right tabular-nums">
                    {hasCosting ? formatCurrency(item.costBreakdown.labor) : '—'}
                  </td>
                  <td className="py-2 px-2 text-right tabular-nums">
                    {hasCosting ? formatCurrency(item.costBreakdown.overhead) : '—'}
                  </td>
                  <td className="py-2 px-2 text-right tabular-nums font-medium">
                    {hasCosting ? formatCurrency(item.costBreakdown.total) : '—'}
                  </td>
                  <td className="py-2 px-2 text-right tabular-nums">
                    {formatCurrency(item.revenue)}
                  </td>
                  <td className={`py-2 px-2 text-right tabular-nums ${marginClass}`}>
                    {marginDisplay}
                  </td>
                  <td className="py-2 pl-2 w-[80px]">
                    {hasCosting ? (
                      <MiniCostBar
                        materials={item.costBreakdown.materials}
                        labor={item.costBreakdown.labor}
                        overhead={item.costBreakdown.overhead}
                      />
                    ) : (
                      <div className="h-1.5 rounded-sm bg-border w-full" />
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
