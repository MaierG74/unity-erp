'use client'

import type { QuoteReportData } from '@/lib/quotes/report-data'
import { formatCurrency } from '@/lib/format-utils'

interface CostCompositionCardProps {
  data: QuoteReportData
}

const COLORS = {
  materials: '#60a5fa',
  labor: '#c084fc',
  overhead: '#fbbf24',
} as const

function CompositionDonut({
  materials,
  labor,
  overhead,
  total,
}: {
  materials: number
  labor: number
  overhead: number
  total: number
}) {
  const r = 52
  const circumference = 2 * Math.PI * r

  const mPct = total > 0 ? materials / total : 0
  const lPct = total > 0 ? labor / total : 0
  const oPct = total > 0 ? overhead / total : 0

  const mArc = mPct * circumference
  const lArc = lPct * circumference
  const oArc = oPct * circumference

  return (
    <div className="relative w-[120px] h-[120px] flex-shrink-0">
      <svg viewBox="0 0 120 120" className="w-[120px] h-[120px]" style={{ transform: 'rotate(-90deg)' }}>
        <circle cx="60" cy="60" r={r} fill="none" stroke="currentColor" className="text-border" strokeWidth="3" />
        {/* Materials segment */}
        {mArc > 0 && (
          <circle
            cx="60" cy="60" r={r} fill="none"
            stroke={COLORS.materials} strokeWidth="3"
            strokeDasharray={`${mArc} ${circumference}`}
            strokeDashoffset="0"
          />
        )}
        {/* Labor segment */}
        {lArc > 0 && (
          <circle
            cx="60" cy="60" r={r} fill="none"
            stroke={COLORS.labor} strokeWidth="3"
            strokeDasharray={`${lArc} ${circumference}`}
            strokeDashoffset={`${-mArc}`}
          />
        )}
        {/* Overhead segment */}
        {oArc > 0 && (
          <circle
            cx="60" cy="60" r={r} fill="none"
            stroke={COLORS.overhead} strokeWidth="3"
            strokeDasharray={`${oArc} ${circumference}`}
            strokeDashoffset={`${-(mArc + lArc)}`}
          />
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-sm font-bold text-white leading-none">{formatCurrency(total)}</span>
        <span className="text-[10px] text-muted-foreground mt-0.5">total cost</span>
      </div>
    </div>
  )
}

interface HorizBarProps {
  label: string
  value: number
  total: number
  color: string
}

function HorizBar({ label, value, total, color }: HorizBarProps) {
  const pct = total > 0 ? (value / total) * 100 : 0
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
          {label}
        </span>
        <span className="tabular-nums text-muted-foreground">
          {pct.toFixed(1)}% · {formatCurrency(value)}
        </span>
      </div>
      <div className="h-2 rounded-sm bg-border overflow-hidden">
        <div className="h-full rounded-sm" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
    </div>
  )
}

export default function CostCompositionCard({ data }: CostCompositionCardProps) {
  if (!data.hasAnyCosting) {
    return (
      <div className="rounded-lg border border-border/50 bg-muted/30 p-4 flex flex-col gap-3">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Cost Composition
        </h3>
        <p className="text-xs text-muted-foreground">No cost data available.</p>
      </div>
    )
  }

  const { materials, labor, overhead, total } = data.costBreakdown

  return (
    <div className="rounded-lg border border-border/50 bg-muted/30 p-4 flex flex-col gap-4">
      <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        Cost Composition
      </h3>

      <div className="flex items-center gap-4">
        <CompositionDonut materials={materials} labor={labor} overhead={overhead} total={total} />
        <div className="flex-1 space-y-3">
          <HorizBar label="Materials" value={materials} total={total} color={COLORS.materials} />
          <HorizBar label="Labor" value={labor} total={total} color={COLORS.labor} />
          <HorizBar label="Overhead" value={overhead} total={total} color={COLORS.overhead} />
        </div>
      </div>
    </div>
  )
}
