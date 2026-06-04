export type QuoteProductPricingMarkup = {
  markup_type?: 'percentage' | 'fixed' | null;
  markup_value?: number | string | null;
};

const EPSILON = 0.005;

function asNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundPercent(value: number): number {
  return Math.round(value * 100) / 100;
}

export function calculateQuoteMarkupPercentFromPrice(costUnitTotal: number, unitPrice: number): number {
  if (!Number.isFinite(costUnitTotal) || Math.abs(costUnitTotal) <= EPSILON) return 0;
  if (!Number.isFinite(unitPrice)) return 0;
  return roundPercent(((unitPrice - costUnitTotal) / costUnitTotal) * 100);
}

export function calculateMarkupAmountPerUnit(costUnitTotal: number, markupPercent: number): number {
  if (!Number.isFinite(costUnitTotal) || !Number.isFinite(markupPercent)) return 0;
  return roundMoney(costUnitTotal * markupPercent / 100);
}

export function calculateUnitPriceFromMarkupPercent(costUnitTotal: number, markupPercent: number): number {
  return roundMoney(costUnitTotal + calculateMarkupAmountPerUnit(costUnitTotal, markupPercent));
}

export function calculateMarkupPercentFromFixedAmount(costUnitTotal: number, markupAmountPerUnit: number): number | null {
  if (!Number.isFinite(costUnitTotal) || Math.abs(costUnitTotal) <= EPSILON) return null;
  if (!Number.isFinite(markupAmountPerUnit)) return null;
  return roundPercent((markupAmountPerUnit / costUnitTotal) * 100);
}

export function calculateMarkupPercentFromTargetPrice(costUnitTotal: number, targetUnitPrice: number): number | null {
  if (!Number.isFinite(costUnitTotal) || Math.abs(costUnitTotal) <= EPSILON) return null;
  if (!Number.isFinite(targetUnitPrice)) return null;
  return roundPercent(((targetUnitPrice - costUnitTotal) / costUnitTotal) * 100);
}

export function calculateMarkupPercentFromProductPricing(
  pricing: QuoteProductPricingMarkup | null | undefined,
  costUnitTotal: number,
  fallbackUnitPrice?: number | string | null
): number {
  const markupValue = asNumber(pricing?.markup_value) ?? 0;

  if (pricing?.markup_type === 'percentage') {
    return roundPercent(markupValue);
  }

  if (pricing?.markup_type === 'fixed' && Number.isFinite(costUnitTotal) && Math.abs(costUnitTotal) > EPSILON) {
    return roundPercent((markupValue / costUnitTotal) * 100);
  }

  const fallback = asNumber(fallbackUnitPrice);
  if (fallback !== null) {
    return calculateQuoteMarkupPercentFromPrice(costUnitTotal, fallback);
  }

  return 0;
}
