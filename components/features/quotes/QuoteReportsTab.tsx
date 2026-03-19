'use client'

import { useMemo } from 'react'
import type { QuoteItem } from '@/lib/db/quotes'
import { computeQuoteReportData } from '@/lib/quotes/report-data'
import QuoteHealthBar from './reports/QuoteHealthBar'
import ProfitabilityCard from './reports/ProfitabilityCard'
import CostCompositionCard from './reports/CostCompositionCard'
import PerItemCostTable from './reports/PerItemCostTable'
import MarkupAnalysisCard from './reports/MarkupAnalysisCard'

interface QuoteReportsTabProps {
  items: QuoteItem[]
}

export default function QuoteReportsTab({ items }: QuoteReportsTabProps) {
  const data = useMemo(() => computeQuoteReportData(items), [items])

  return (
    <div className="space-y-4">
      {/* Section 1: Health bar (full width) */}
      <QuoteHealthBar data={data} />

      {/* Sections 2 + 3: 2-col grid */}
      <div className="grid grid-cols-1 gap-4 [&:has([data-col])]:grid-cols-2 md:grid-cols-2">
        <ProfitabilityCard data={data} />
        <CostCompositionCard data={data} />
      </div>

      {/* Section 4: Per-item table (full width) */}
      <PerItemCostTable items={data.items} />

      {/* Section 5: Markup analysis (full width) */}
      <MarkupAnalysisCard items={data.items} />
    </div>
  )
}
