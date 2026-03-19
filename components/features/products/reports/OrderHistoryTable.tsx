// components/features/products/reports/OrderHistoryTable.tsx
'use client'

import Link from 'next/link'
import { formatCurrency } from '@/lib/format-utils'
import type { OrderProfitability } from '@/hooks/useProductReports'

interface OrderHistoryTableProps {
  orders: OrderProfitability[]
  bomCostPerUnit: number
}

function MarginBadge({ margin }: { margin: number }) {
  if (Number.isNaN(margin)) {
    return <span className="text-[10px] text-muted-foreground">N/A</span>
  }
  const cls =
    margin >= 30
      ? 'bg-green-500/20 text-green-400'
      : margin >= 15
        ? 'bg-amber-500/20 text-amber-400'
        : 'bg-red-500/20 text-red-400'
  return (
    <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold tabular-nums ${cls}`}>
      {margin.toFixed(1)}%
    </span>
  )
}

function MiniBar({ revenue, cost }: { revenue: number; cost: number }) {
  const costPct = revenue > 0 ? Math.min(100, (cost / revenue) * 100) : 100
  const marginPct = Math.max(0, 100 - costPct)
  return (
    <div className="w-10 h-2 rounded-sm bg-border overflow-hidden flex flex-shrink-0">
      <div className="bg-red-400 h-full" style={{ width: `${costPct}%` }} />
      <div className="bg-green-400 h-full" style={{ width: `${marginPct}%` }} />
    </div>
  )
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' })
}

export default function OrderHistoryTable({ orders }: OrderHistoryTableProps) {
  if (orders.length === 0) {
    return (
      <div className="rounded-lg border border-border/50 bg-muted/30 p-4">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-3">
          Order History & Margin
        </h3>
        <p className="text-xs text-muted-foreground">No orders found in this period.</p>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-border/50 bg-muted/30 p-4 flex flex-col gap-3">
      <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        Order History & Margin
      </h3>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border/50">
              {['Order #', 'Customer', 'Date', 'Qty', 'Unit Price', 'Revenue', 'Cost (BOM)', 'Profit', 'Margin', 'Split'].map(h => (
                <th key={h} className="text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground pb-2 pr-3 last:pr-0 whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {orders.map(row => {
              const label = row.orderNumber ?? `Order #${row.orderId}`
              const isNegProfit = row.profit < 0
              return (
                <tr key={row.orderDetailId} className="border-b border-border/30 last:border-0">
                  <td className="py-2 pr-3">
                    <Link href={`/orders/${row.orderId}`} className="text-blue-400 hover:underline whitespace-nowrap">
                      {label}
                    </Link>
                  </td>
                  <td className="py-2 pr-3 text-muted-foreground truncate max-w-[120px]">{row.customerName ?? '—'}</td>
                  <td className="py-2 pr-3 text-muted-foreground whitespace-nowrap">{formatDate(row.date)}</td>
                  <td className="py-2 pr-3 tabular-nums">{row.quantity}</td>
                  <td className="py-2 pr-3 tabular-nums">{formatCurrency(row.unitPrice)}</td>
                  <td className="py-2 pr-3 tabular-nums">{formatCurrency(row.revenue)}</td>
                  <td className="py-2 pr-3 tabular-nums text-red-400">{formatCurrency(row.cost)}</td>
                  <td className={`py-2 pr-3 tabular-nums font-medium ${isNegProfit ? 'text-red-400' : 'text-green-400'}`}>
                    {formatCurrency(row.profit)}
                  </td>
                  <td className="py-2 pr-3">
                    <MarginBadge margin={row.marginPercent} />
                  </td>
                  <td className="py-2">
                    <MiniBar revenue={row.revenue} cost={row.cost} />
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
