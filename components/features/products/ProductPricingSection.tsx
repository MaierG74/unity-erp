'use client'

import { useState, useEffect } from 'react'
import { DollarSign } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useProductPricing, type MarkupType } from '@/hooks/useProductPricing'

function fmtMoney(v: number | null | undefined) {
  if (v == null) return '—'
  return `R${v.toFixed(2)}`
}

interface ProductPricingSectionProps {
  productId: number
  unitCost: number
}

export function ProductPricingSection({ productId, unitCost }: ProductPricingSectionProps) {
  const { price, isLoading, isSaving, savePrice } = useProductPricing(productId)

  const [markupType, setMarkupType] = useState<MarkupType>('percentage')
  const [markupValue, setMarkupValue] = useState<number>(0)
  const [dirty, setDirty] = useState(false)

  // Sync from saved price when loaded
  useEffect(() => {
    if (price) {
      setMarkupType(price.markup_type)
      setMarkupValue(price.markup_value)
      setDirty(false)
    }
  }, [price])

  // Calculate derived values
  const markupAmount =
    markupType === 'percentage' ? unitCost * (markupValue / 100) : markupValue
  const sellingPrice = unitCost + markupAmount
  const margin = sellingPrice > 0 ? (markupAmount / sellingPrice) * 100 : 0

  const handleSave = () => {
    savePrice({
      markupType,
      markupValue,
      sellingPrice,
    })
    setDirty(false)
  }

  if (isLoading) {
    return (
      <div className="rounded-lg border bg-card p-5">
        <div className="flex items-center gap-2 mb-4">
          <DollarSign className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-semibold">Standard Pricing</span>
        </div>
        <div className="py-4 text-center text-sm text-muted-foreground">Loading pricing...</div>
      </div>
    )
  }

  return (
    <div className="rounded-lg border bg-card p-5">
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <DollarSign className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-semibold">Standard Pricing</span>
      </div>

      {/* Markup controls */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        {/* Markup type toggle */}
        <div>
          <div className="text-xs uppercase text-muted-foreground tracking-wide mb-1.5">
            Markup Type
          </div>
          <div className="flex rounded-md border bg-muted/30 p-0.5">
            <button
              type="button"
              onClick={() => {
                setMarkupType('percentage')
                setDirty(true)
              }}
              className={`flex-1 rounded-sm px-3 py-1.5 text-xs font-medium transition-colors ${
                markupType === 'percentage'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              % Percentage
            </button>
            <button
              type="button"
              onClick={() => {
                setMarkupType('fixed')
                setDirty(true)
              }}
              className={`flex-1 rounded-sm px-3 py-1.5 text-xs font-medium transition-colors ${
                markupType === 'fixed'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              R Fixed
            </button>
          </div>
        </div>

        {/* Markup value input */}
        <div>
          <div className="text-xs uppercase text-muted-foreground tracking-wide mb-1.5">
            Markup
          </div>
          <div className="relative">
            <Input
              type="number"
              value={markupValue || ''}
              placeholder="0"
              onBlur={(e) => {
                if (e.target.value === '') setMarkupValue(0)
              }}
              onChange={(e) => {
                setMarkupValue(parseFloat(e.target.value) || 0)
                setDirty(true)
              }}
              className="pr-8"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
              {markupType === 'percentage' ? '%' : 'R'}
            </span>
          </div>
        </div>
      </div>

      {/* Price flow: Cost + Markup = Selling Price */}
      <div className="grid grid-cols-[1fr_auto_1fr_auto_1fr] items-center gap-0">
        {/* Unit Cost */}
        <div className="rounded-lg border bg-muted/30 p-3 text-center">
          <div className="text-[11px] uppercase text-muted-foreground tracking-wide mb-1">
            Unit Cost
          </div>
          <div className="text-lg font-bold tabular-nums">{fmtMoney(unitCost)}</div>
        </div>

        <div className="px-2 text-muted-foreground/50 text-lg font-light">+</div>

        {/* Markup Amount */}
        <div className="rounded-lg border bg-muted/30 p-3 text-center">
          <div className="text-[11px] uppercase text-muted-foreground tracking-wide mb-1">
            Markup{markupType === 'percentage' ? ` (${markupValue}%)` : ''}
          </div>
          <div className="text-lg font-bold tabular-nums text-amber-500">
            {fmtMoney(markupAmount)}
          </div>
        </div>

        <div className="px-2 text-muted-foreground/50 text-lg font-light">=</div>

        {/* Selling Price */}
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-center">
          <div className="text-[11px] uppercase text-emerald-400 tracking-wide mb-1">
            Selling Price
          </div>
          <div className="text-lg font-bold tabular-nums text-emerald-500">
            {fmtMoney(sellingPrice)}
          </div>
        </div>
      </div>

      {/* Footer: margin + save */}
      <div className="flex items-center justify-between mt-3">
        <div className="flex gap-3 text-[11px] text-muted-foreground">
          <span>Margin: {margin.toFixed(1)}%</span>
          <span>Profit: {fmtMoney(markupAmount)} per unit</span>
        </div>
        <Button
          size="sm"
          onClick={handleSave}
          disabled={!dirty || unitCost === 0 || isSaving}
        >
          {isSaving ? 'Saving...' : 'Save Price'}
        </Button>
      </div>
    </div>
  )
}
