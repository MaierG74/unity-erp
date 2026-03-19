// components/features/products/reports/BomCostCard.tsx
'use client'

import { formatCurrency } from '@/lib/format-utils'
import type { BomCost } from '@/hooks/useProductReports'

interface BomCostCardProps {
  bomCost: BomCost
}

const COLORS = {
  materials: '#60a5fa',
  labor: '#c084fc',
  overhead: '#fbbf24',
} as const

function CompositionDonut({ materials, labor, overhead, total }: Omit<BomCost, 'missingPrices'>) {
  const r = 52
  const circumference = 2 * Math.PI * r
  const mArc = total > 0 ? (materials / total) * circumference : 0
  const lArc = total > 0 ? (labor / total) * circumference : 0
  const oArc = total > 0 ? (overhead / total) * circumference : 0

  return (
    <div className="relative w-[120px] h-[120px] flex-shrink-0">
      <svg viewBox="0 0 120 120" className="w-[120px] h-[120px]" style={{ transform: 'rotate(-90deg)' }}>
        <circle cx="60" cy="60" r={r} fill="none" stroke="currentColor" className="text-border" strokeWidth="3" />
        {mArc > 0 && (
          <circle cx="60" cy="60" r={r} fill="none" stroke={COLORS.materials} strokeWidth="3"
            strokeDasharray={`${mArc} ${circumference}`} strokeDashoffset="0" />
        )}
        {lArc > 0 && (
          <circle cx="60" cy="60" r={r} fill="none" stroke={COLORS.labor} strokeWidth="3"
            strokeDasharray={`${lArc} ${circumference}`} strokeDashoffset={`${-mArc}`} />
        )}
        {oArc > 0 && (
          <circle cx="60" cy="60" r={r} fill="none" stroke={COLORS.overhead} strokeWidth="3"
            strokeDasharray={`${oArc} ${circumference}`} strokeDashoffset={`${-(mArc + lArc)}`} />
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-sm font-bold text-white leading-none">{formatCurrency(total)}</span>
        <span className="text-[10px] text-muted-foreground mt-0.5">/unit</span>
      </div>
    </div>
  )
}

function HorizBar({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
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

export default function BomCostCard({ bomCost }: BomCostCardProps) {
  const { materials, labor, overhead, total, missingPrices } = bomCost

  if (total === 0) {
    return (
      <div className="rounded-lg border border-border/50 bg-muted/30 p-4 flex flex-col gap-3">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">BOM Cost Composition</h3>
        <p className="text-xs text-muted-foreground">No BOM cost data configured for this product.</p>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-border/50 bg-muted/30 p-4 flex flex-col gap-4">
      <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">BOM Cost Composition</h3>

      <div className="flex items-center gap-4">
        <CompositionDonut materials={materials} labor={labor} overhead={overhead} total={total} />
        <div className="flex-1 space-y-3">
          <HorizBar label="Materials" value={materials} total={total} color={COLORS.materials} />
          <HorizBar label="Labor" value={labor} total={total} color={COLORS.labor} />
          <HorizBar label="Overhead" value={overhead} total={total} color={COLORS.overhead} />
        </div>
      </div>

      {missingPrices > 0 && (
        <p className="text-[10px] text-amber-400 border-t border-border/40 pt-2">
          ⚠ {missingPrices} BOM item{missingPrices > 1 ? 's' : ''} missing supplier price — cost may be understated.
        </p>
      )}
    </div>
  )
}
