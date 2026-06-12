'use client'

import Link from 'next/link'
import { ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useProductWhereUsed } from '@/hooks/useProductWhereUsed'

/**
 * Quiet inline notice for BOM/BOL/cutlist surfaces: editing a subcomponent
 * that parents use only affects future quotes/orders. Renders nothing while
 * loading, on error, or when the product is not used anywhere.
 */
export function WhereUsedNotice({ productId }: { productId: number }) {
  const { data } = useProductWhereUsed(productId)
  const count = data?.count ?? 0
  if (count === 0) return null

  return (
    <p className="rounded-sm border border-amber-500/20 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-700 dark:text-amber-400">
      Used in {count} product{count === 1 ? '' : 's'} — changes apply to future quotes and orders
      only. Existing quotes and orders keep their snapshots.
    </p>
  )
}

/**
 * One-line banner for the product page header area: shows how many parent
 * products use this subcomponent, with a popover listing them. Renders
 * nothing when the product is not used anywhere.
 */
export function WhereUsedBanner({ productId }: { productId: number }) {
  const { data } = useProductWhereUsed(productId)
  const count = data?.count ?? 0
  if (count === 0) return null

  return (
    <div className="flex items-center gap-2 rounded-sm border bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
      <span>
        Used in {count} product{count === 1 ? '' : 's'}
      </span>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="sm" className="h-6 px-2 text-xs">
            View
            <ChevronDown className="ml-1 h-3 w-3" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80 p-2">
          <ul className="space-y-0.5">
            {(data?.parents ?? []).map((parent) => (
              <li key={parent.product_id}>
                <Link
                  href={`/products/${parent.product_id}`}
                  className="flex items-center justify-between gap-2 rounded-sm px-2 py-1 text-sm hover:bg-muted"
                >
                  <span className="truncate">
                    {parent.internal_code ?? '—'} — {parent.name ?? 'Unavailable'}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">×{parent.scale}</span>
                </Link>
              </li>
            ))}
          </ul>
        </PopoverContent>
      </Popover>
    </div>
  )
}
