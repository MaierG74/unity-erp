'use client'

import { useState } from 'react'
import { TableRow, TableCell } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { ChevronRight, ChevronDown } from 'lucide-react'

interface SubProductGroupHeaderProps {
  productId: number
  productName: string
  productCode: string
  itemCount: number
  totalCost: number
  scaleQty: number
  /** Number of columns the label section should span (everything before the cost cell) */
  labelColSpan: number
  /** Number of trailing columns after the cost cell (e.g. Actions) to render as empty */
  trailingCols?: number
  defaultExpanded?: boolean
  children: React.ReactNode
}

export function SubProductGroupHeader({
  productId,
  productName,
  productCode,
  itemCount,
  totalCost,
  scaleQty,
  labelColSpan,
  trailingCols = 1,
  defaultExpanded = false,
  children,
}: SubProductGroupHeaderProps) {
  const [expanded, setExpanded] = useState(defaultExpanded)

  return (
    <>
      {/* Header row */}
      <TableRow
        className="cursor-pointer bg-teal-500/8 hover:bg-teal-500/12 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <TableCell colSpan={labelColSpan}>
          <div className="flex items-center gap-2">
            {expanded ? (
              <ChevronDown className="h-3.5 w-3.5 text-teal-400 shrink-0" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-teal-400 shrink-0" />
            )}
            <Badge
              variant="outline"
              className="border-teal-500/30 bg-teal-500/15 text-teal-400 text-[10px] font-semibold px-2 py-0"
            >
              SUBCOMPONENT
            </Badge>
            <span className="font-medium text-sm text-foreground">
              {productName || productCode} <span className="text-muted-foreground font-normal">×{scaleQty}</span>
            </span>
            <span className="text-xs text-muted-foreground">
              · {itemCount} {itemCount === 1 ? 'item' : 'items'}
            </span>
            <a
              href={`/products/${productId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-2 text-xs text-muted-foreground hover:text-foreground hover:underline transition-colors"
              onClick={(e) => e.stopPropagation()}
            >
              Edit subcomponent
            </a>
          </div>
        </TableCell>
        <TableCell className="text-right text-sm font-semibold text-teal-400">
          R{totalCost.toFixed(2)}
        </TableCell>
        {trailingCols > 0 && (
          <TableCell colSpan={trailingCols} />
        )}
      </TableRow>

      {/* Child rows */}
      {expanded && children}
    </>
  )
}
