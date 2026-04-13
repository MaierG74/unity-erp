'use client'

import { useState, useEffect } from 'react'
import { DollarSign, AlertTriangle, RefreshCw } from 'lucide-react'
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

  // Calculate what the price WOULD be at current cost + markup
  const expectedMarkupAmount =
    markupType === 'percentage' ? unitCost * (markupValue / 100) : markupValue
  const expectedSellingPrice = unitCost + expectedMarkupAmount

  // When editing (dirty) or no saved price, show live calculation
  // When saved and not editing, show the locked saved price
  const hasSavedPrice = !!price && !dirty
  const displaySellingPrice = hasSavedPrice ? price.selling_price : expectedSellingPrice
  const displayMarkupAmount = displaySellingPrice - unitCost
  const displayMargin = displaySellingPrice > 0
    ? (displayMarkupAmount / displaySellingPrice) * 100
    : 0

  // Detect margin erosion: cost has changed since price was saved
  const marginEroded = hasSavedPrice && unitCost > 0 && expectedSellingPrice > price.selling_price
  const effectiveMarkupPct = hasSavedPrice && unitCost > 0
    ? ((price.selling_price - unitCost) / unitCost) * 100
    : null

  const handleSave = () => {
    savePrice({
      markupType,
      markupValue,
      sellingPrice: expectedSellingPrice,
    })
    setDirty(false)
  }

  const handleRecalculate = () => {
    // Re-save with the same markup but at the current cost
    savePrice({
      markupType,
      markupValue,
      sellingPrice: expectedSellingPrice,
    })
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

      {/* Margin erosion warning */}
      {marginEroded && (
        <div className="flex items-center gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 mb-4">
          <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-amber-500">Markup below target</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              Costs have changed — effective markup is {effectiveMarkupPct!.toFixed(1)}%,
              below your {markupType === 'percentage' ? `${markupValue}%` : fmtMoney(markupValue)} target.
              Price list still shows {fmtMoney(price.selling_price)}.
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRecalculate}
            disabled={isSaving}
            className="shrink-0 border-amber-500/30 text-amber-500 hover:bg-amber-500/10"
          >
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
            Recalculate
          </Button>
        </div>
      )}

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
            {fmtMoney(displayMarkupAmount)}
          </div>
        </div>

        <div className="px-2 text-muted-foreground/50 text-lg font-light">=</div>

        {/* Selling Price */}
        <div className={`rounded-lg border p-3 text-center ${
          marginEroded
            ? 'border-amber-500/30 bg-amber-500/5'
            : 'border-emerald-500/30 bg-emerald-500/5'
        }`}>
          <div className={`text-[11px] uppercase tracking-wide mb-1 ${
            marginEroded ? 'text-amber-400' : 'text-emerald-400'
          }`}>
            Selling Price
          </div>
          <div className={`text-lg font-bold tabular-nums ${
            marginEroded ? 'text-amber-500' : 'text-emerald-500'
          }`}>
            {fmtMoney(displaySellingPrice)}
          </div>
        </div>
      </div>

      {/* Footer: margin + save */}
      <div className="flex items-center justify-between mt-3">
        <div className="flex gap-3 text-[11px] text-muted-foreground">
          <span>Margin: {displayMargin.toFixed(1)}%</span>
          <span>Profit: {fmtMoney(displayMarkupAmount)} per unit</span>
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
