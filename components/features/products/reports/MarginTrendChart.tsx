// components/features/products/reports/MarginTrendChart.tsx
'use client'

import type { OrderProfitability } from '@/hooks/useProductReports'

interface MarginTrendChartProps {
  orders: OrderProfitability[]
}

interface TrendPoint {
  orderId: number
  date: string
  margin: number
}

function aggregateByOrder(orders: OrderProfitability[]): TrendPoint[] {
  const byOrder = new Map<number, { date: string; totalRevenue: number; totalCost: number }>()
  for (const o of orders) {
    const existing = byOrder.get(o.orderId)
    if (existing) {
      existing.totalRevenue += o.revenue
      existing.totalCost += o.cost
    } else {
      byOrder.set(o.orderId, { date: o.date ?? '', totalRevenue: o.revenue, totalCost: o.cost })
    }
  }
  return Array.from(byOrder.entries())
    .map(([orderId, d]) => ({
      orderId,
      date: d.date,
      margin: d.totalRevenue > 0 ? ((d.totalRevenue - d.totalCost) / d.totalRevenue) * 100 : 0,
    }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

const SHORT_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function formatShortDate(dateStr: string) {
  if (!dateStr) return ''
  const [, m, d] = dateStr.split('-')
  return `${parseInt(d)} ${SHORT_MONTHS[parseInt(m) - 1]}`
}

export default function MarginTrendChart({ orders }: MarginTrendChartProps) {
  const points = aggregateByOrder(orders)

  if (points.length === 0) {
    return (
      <div className="rounded-lg border border-border/50 bg-muted/30 p-4 flex flex-col gap-3">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Margin Trend</h3>
        <p className="text-xs text-muted-foreground">No orders in this period.</p>
      </div>
    )
  }

  const W = 500
  const H = 160
  const padLeft = 36
  const padRight = 16
  const padTop = 16
  const padBottom = 32
  const chartW = W - padLeft - padRight
  const chartH = H - padTop - padBottom

  const margins = points.map(p => p.margin)
  const minM = Math.min(0, ...margins)
  const maxM = Math.max(50, ...margins)
  const range = maxM - minM || 1

  const toX = (i: number) =>
    padLeft + (points.length === 1 ? chartW / 2 : (i / (points.length - 1)) * chartW)
  const toY = (m: number) =>
    padTop + chartH - ((m - minM) / range) * chartH

  const linePoints = points.map((p, i) => `${toX(i)},${toY(p.margin)}`).join(' ')

  // Area path: down to baseline, back along x-axis
  const baseY = toY(Math.max(0, minM))
  const areaD =
    `M ${toX(0)},${toY(points[0].margin)} ` +
    points.slice(1).map((p, i) => `L ${toX(i + 1)},${toY(p.margin)}`).join(' ') +
    ` L ${toX(points.length - 1)},${baseY} L ${toX(0)},${baseY} Z`

  const gridLines = [20, 30, 40]

  return (
    <div className="rounded-lg border border-border/50 bg-muted/30 p-4 flex flex-col gap-3">
      <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Margin Trend</h3>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 180 }}>
        <defs>
          <linearGradient id="marginAreaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#4ade80" stopOpacity="0.25" />
            <stop offset="100%" stopColor="#4ade80" stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {/* Grid lines */}
        {gridLines.map(g => {
          const y = toY(g)
          if (y < padTop || y > padTop + chartH) return null
          return (
            <g key={g}>
              <line x1={padLeft} y1={y} x2={W - padRight} y2={y} stroke="#334155" strokeWidth="1" strokeDasharray="3,3" />
              <text x={padLeft - 4} y={y + 4} textAnchor="end" fontSize="9" fill="#6b7280">{g}%</text>
            </g>
          )
        })}

        {/* Area fill */}
        {points.length > 1 && <path d={areaD} fill="url(#marginAreaGrad)" />}

        {/* Line */}
        {points.length > 1 && (
          <polyline points={linePoints} fill="none" stroke="#4ade80" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
        )}

        {/* Data points */}
        {points.map((p, i) => (
          <g key={p.orderId}>
            <circle cx={toX(i)} cy={toY(p.margin)} r="3" fill="#4ade80" />
            <text x={toX(i)} y={toY(p.margin) - 7} textAnchor="middle" fontSize="9" fill="#4ade80">
              {p.margin.toFixed(1)}%
            </text>
          </g>
        ))}

        {/* X-axis date labels */}
        {points.map((p, i) => (
          <text key={`date-${p.orderId}`} x={toX(i)} y={H - 4} textAnchor="middle" fontSize="9" fill="#6b7280">
            {formatShortDate(p.date)}
          </text>
        ))}
      </svg>
    </div>
  )
}
