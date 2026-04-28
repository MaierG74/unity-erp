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

function roundCurrency(v: number) {
  return Math.round(v * 100) / 100
}

interface ProductPricingSectionProps {
  productId: number
  unitCost: number
}

export function ProductPricingSection({ productId, unitCost }: ProductPricingSectionProps) {
  const { price, isLoading, isSaving, savePrice } = useProductPricing(productId)

  const [markupType, setMarkupType] = useState<MarkupType>('percentage')
  const [markupValue, setMarkupValue] = useState<number>(0)
  const [sellingPriceValue, setSellingPriceValue] = useState('')
  const [sellingPriceEdited, setSellingPriceEdited] = useState(false)
  const [dirty, setDirty] = useState(false)

  // Sync from saved price when loaded
  useEffect(() => {
    if (price) {
      setMarkupType(price.markup_type)
      setMarkupValue(price.markup_value)
      setSellingPriceValue(price.selling_price.toFixed(2))
      setSellingPriceEdited(false)
      setDirty(false)
    }
  }, [price])

  // Calculate what the price WOULD be at current cost + markup
  const expectedMarkupAmount =
    markupType === 'percentage' ? unitCost * (markupValue / 100) : markupValue
  const expectedSellingPrice = unitCost + expectedMarkupAmount
  const typedSellingPrice = Number.parseFloat(sellingPriceValue)
  const manualSellingPrice =
    Number.isFinite(typedSellingPrice) && typedSellingPrice >= 0
      ? typedSellingPrice
      : expectedSellingPrice

  // When editing (dirty) or no saved price, show live calculation
  // When saved and not editing, show the locked saved price
  const hasSavedPrice = !!price && !dirty
  const displaySellingPrice = hasSavedPrice
    ? price.selling_price
    : sellingPriceEdited
      ? manualSellingPrice
      : expectedSellingPrice
  const displayMarkupAmount = displaySellingPrice - unitCost
  const displayMargin = displaySellingPrice > 0
    ? (displayMarkupAmount / displaySellingPrice) * 100
    : 0

  // Detect margin erosion: cost has changed since price was saved
  const currencyTolerance = 0.005
  const marginEroded =
    hasSavedPrice &&
    unitCost > 0 &&
    expectedSellingPrice > price.selling_price + currencyTolerance
  const effectiveMarkupPct = hasSavedPrice && unitCost > 0
    ? ((price.selling_price - unitCost) / unitCost) * 100
    : null
  const savedPercentageTarget = price?.markup_type === 'percentage' ? price.markup_value : null
  const displayMarkupPct = unitCost > 0 ? (displayMarkupAmount / unitCost) * 100 : null
  const typedPriceBelowPercentageTarget =
    sellingPriceEdited &&
    savedPercentageTarget != null &&
    displayMarkupPct != null &&
    displayMarkupPct + 0.05 < savedPercentageTarget
  const showMarkupWarning = marginEroded || typedPriceBelowPercentageTarget

  const handleSave = () => {
    const sellingPrice = sellingPriceEdited ? manualSellingPrice : expectedSellingPrice
    const nextMarkupType: MarkupType = sellingPriceEdited ? 'fixed' : markupType
    const nextMarkupValue = sellingPriceEdited
      ? roundCurrency(Math.max(0, sellingPrice - unitCost))
      : markupValue

    savePrice({
      markupType: nextMarkupType,
      markupValue: nextMarkupValue,
      sellingPrice,
    })
    setMarkupType(nextMarkupType)
    setMarkupValue(nextMarkupValue)
    setSellingPriceValue(sellingPrice.toFixed(2))
    setSellingPriceEdited(false)
    setDirty(false)
  }

  const handleRecalculate = () => {
    // Re-save with the same markup but at the current cost
    savePrice({
      markupType,
      markupValue,
      sellingPrice: expectedSellingPrice,
    })
    setSellingPriceValue(expectedSellingPrice.toFixed(2))
    setSellingPriceEdited(false)
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
      {showMarkupWarning && (
        <div className="flex items-center gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 mb-4">
          <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-amber-500">Markup below target</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {typedPriceBelowPercentageTarget
                ? `Typed selling price gives ${displayMarkupPct!.toFixed(1)}% markup, below your ${savedPercentageTarget}% target.`
                : markupType === 'fixed'
                  ? `Costs have changed — profit is ${fmtMoney(displayMarkupAmount)}, below your ${fmtMoney(markupValue)} fixed markup target. Price list still shows ${fmtMoney(price.selling_price)}.`
                : (
                    <>
                      Costs have changed — effective markup is {effectiveMarkupPct!.toFixed(1)}%,
                      below your {markupValue}% target.
                      Price list still shows {fmtMoney(price.selling_price)}.
                    </>
                  )}
            </div>
          </div>
          {marginEroded && (
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
          )}
        </div>
      )}

      {/* Markup controls */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        {/* Markup type toggle */}
        <div>
          <div className="text-xs uppercase text-muted-foreground tracking-wide mb-1.5">
            Markup Type
          </div>
          <div className="flex h-10 rounded-md border bg-muted/30 p-0.5">
            <button
              type="button"
              onClick={() => {
                setMarkupType('percentage')
                setSellingPriceEdited(false)
                setDirty(true)
              }}
              className={`flex-1 rounded-sm px-3 text-xs font-medium transition-colors ${
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
                setSellingPriceEdited(false)
                setDirty(true)
              }}
              className={`flex-1 rounded-sm px-3 text-xs font-medium transition-colors ${
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
                setSellingPriceEdited(false)
                setDirty(true)
              }}
              className="h-10 pr-8"
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
          showMarkupWarning
            ? 'border-amber-500/30 bg-amber-500/5'
            : 'border-emerald-500/30 bg-emerald-500/5'
        }`}>
          <div className={`text-[11px] uppercase tracking-wide mb-1 ${
            showMarkupWarning ? 'text-amber-400' : 'text-emerald-400'
          }`}>
            Selling Price
          </div>
          <div className="relative">
            <Input
              type="number"
              min="0"
              step="0.01"
              value={
                hasSavedPrice && !sellingPriceEdited
                  ? price.selling_price.toFixed(2)
                  : sellingPriceEdited
                    ? sellingPriceValue
                    : expectedSellingPrice.toFixed(2)
              }
              onChange={(e) => {
                const nextValue = e.target.value
                const nextSellingPrice = Number.parseFloat(nextValue)
                setSellingPriceValue(nextValue)
                setMarkupType('fixed')
                if (Number.isFinite(nextSellingPrice) && nextSellingPrice >= 0) {
                  setMarkupValue(roundCurrency(Math.max(0, nextSellingPrice - unitCost)))
                }
                setSellingPriceEdited(true)
                setDirty(true)
              }}
              onBlur={(e) => {
                if (e.target.value === '') {
                  setSellingPriceValue(displaySellingPrice.toFixed(2))
                  setSellingPriceEdited(false)
                }
              }}
              className={`h-8 border-0 bg-transparent p-0 text-center text-lg font-bold tabular-nums shadow-none focus-visible:ring-0 ${
                showMarkupWarning ? 'text-amber-500' : 'text-emerald-500'
              }`}
            />
          </div>
        </div>
      </div>

      {/* Footer: margin + save */}
      <div className="flex items-center justify-between mt-3">
        <div className="flex gap-3 text-[11px] text-muted-foreground">
          <span>Margin: {displayMargin.toFixed(1)}%</span>
          <span>Markup: {displayMarkupPct != null ? `${displayMarkupPct.toFixed(1)}%` : '—'}</span>
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
