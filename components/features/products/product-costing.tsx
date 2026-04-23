'use client'

import { useState, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { authorizedFetch } from '@/lib/client/auth-fetch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Plus, Trash2, Package, Clock, Settings2, AlertTriangle, TrendingUp, ArrowRight } from 'lucide-react'
import { AddOverheadDialog } from './AddOverheadDialog'
import { ProductBOM } from './product-bom'
import { ProductBOL } from './product-bol'
import { useToast } from '@/components/ui/use-toast'
import { ProductPricingSection } from './ProductPricingSection'
import type { CutlistCostingSnapshot } from '@/lib/cutlist/costingSnapshot'
import { computePartsHash } from '@/lib/cutlist/costingSnapshot'
import { flattenGroupsToCompactParts } from '@/lib/configurator/cutlistGroupConversion'

type BomRow = {
  bom_id: number
  component_id: number
  quantity_required: number
  components: { internal_code: string; description: string | null } | null
  supplierComponent?: { supplier_component_id: number; price: number | null } | null
}

type BolRow = {
  bol_id: number
  pay_type?: 'hourly' | 'piece'
  time_required: number
  time_unit: 'hours' | 'minutes' | 'seconds'
  quantity: number
  jobs: {
    name: string
    job_categories: { name: string }
  }
  job_category_rates?: { hourly_rate: number } | null
  job_hourly_rates?: { hourly_rate: number } | null
  piece_work_rates?: { rate: number } | null
}

type OverheadElement = {
  element_id: number
  code: string
  name: string
  cost_type: 'fixed' | 'percentage'
  default_value: number
  percentage_basis: 'materials' | 'labor' | 'total' | null
}

type ProductOverheadItem = {
  id: number
  element_id: number
  quantity: number
  override_value: number | null
  element: OverheadElement
}
type EffectiveBolItem = {
  job_id: number
  job_name: string
  category_name: string
  pay_type: 'hourly' | 'piece'
  time_required: number | null
  time_unit: 'hours' | 'minutes' | 'seconds'
  quantity: number
  hourly_rate: number | null
  piece_rate: number | null
  _source: 'direct' | 'link'
  _sub_product_id?: number | null
}

// Effective BOM item from API /api/products/:id/effective-bom
type EffectiveItem = {
  component_id: number
  quantity_required: number
  supplier_component_id: number | null
  suppliercomponents?: { price?: number | null } | null
  is_cutlist_item?: boolean | null
  _source?: 'direct' | 'link'
  _sub_product_id?: number
}

function toHours(value: number, unit: 'hours' | 'minutes' | 'seconds'): number {
  if (unit === 'hours') return value
  if (unit === 'minutes') return value / 60
  return value / 3600
}

function fmtMoney(v: number | null | undefined) {
  if (v == null) return '—'
  return `R${v.toFixed(2)}`
}

interface CutlistMaterialCostLine {
  label: string
  unit: string
  actual: number
  padded: number
  unitPrice: number | null
  actualCost: number | null
  paddedCost: number | null
}

function deriveCutlistCostLines(snap: CutlistCostingSnapshot): CutlistMaterialCostLine[] {
  const lines: CutlistMaterialCostLine[] = []

  // Board lines — aggregate per material from per-sheet data
  const materialSheets = new Map<string, { actual: number; padded: number; name: string }>()
  for (const sheet of snap.sheets) {
    const matId = sheet.material_id || 'unknown'
    const current = materialSheets.get(matId) ?? { actual: 0, padded: 0, name: sheet.material_name }
    const sheetArea = sheet.sheet_length_mm * sheet.sheet_width_mm
    const usedFrac = sheetArea > 0 ? sheet.used_area_mm2 / sheetArea : 0
    current.actual += usedFrac

    let billedFrac = usedFrac
    if (snap.global_full_board) {
      billedFrac = 1
    } else if (sheet.billing_override) {
      if (sheet.billing_override.mode === 'full') billedFrac = 1
      if (sheet.billing_override.mode === 'manual') billedFrac = sheet.billing_override.manualPct / 100
    }
    current.padded += billedFrac
    materialSheets.set(matId, current)
  }

  for (const [matId, { actual, padded, name }] of materialSheets) {
    const price = snap.board_prices.find(b => b.material_id === matId)?.unit_price_per_sheet ?? null
    lines.push({
      label: name || matId,
      unit: 'sheets',
      actual,
      padded,
      unitPrice: price,
      actualCost: price !== null ? actual * price : null,
      paddedCost: price !== null ? padded * price : null,
    })
  }

  // Edging lines
  for (const e of snap.edging) {
    let paddedMeters = e.meters_actual
    if (e.meters_override !== null) {
      paddedMeters = e.meters_override
    } else if (e.pct_override !== null) {
      paddedMeters = e.meters_actual * (1 + e.pct_override / 100)
    }
    lines.push({
      label: `${e.material_name} (${e.thickness_mm}mm edging)`,
      unit: 'm',
      actual: e.meters_actual,
      padded: paddedMeters,
      unitPrice: e.unit_price_per_meter,
      actualCost: e.unit_price_per_meter !== null ? e.meters_actual * e.unit_price_per_meter : null,
      paddedCost: e.unit_price_per_meter !== null ? paddedMeters * e.unit_price_per_meter : null,
    })
  }

  // Backer lines
  if (snap.backer_sheets && snap.backer_sheets.length > 0) {
    let backerActual = 0
    let backerPadded = 0
    for (const s of snap.backer_sheets) {
      const area = s.sheet_length_mm * s.sheet_width_mm
      const frac = area > 0 ? s.used_area_mm2 / area : 0
      backerActual += frac
      let billed = frac
      if (snap.backer_global_full_board) {
        billed = 1
      } else if (s.billing_override) {
        if (s.billing_override.mode === 'full') billed = 1
        if (s.billing_override.mode === 'manual') billed = s.billing_override.manualPct / 100
      }
      backerPadded += billed
    }
    const backerPrice = snap.backer_price_per_sheet
    lines.push({
      label: 'Backer board',
      unit: 'sheets',
      actual: backerActual,
      padded: backerPadded,
      unitPrice: backerPrice,
      actualCost: backerPrice !== null ? backerActual * backerPrice : null,
      paddedCost: backerPrice !== null ? backerPadded * backerPrice : null,
    })
  }

  return lines
}

type CostingSection = 'summary' | 'materials' | 'labor' | 'overhead'

export function ProductCosting({ productId }: { productId: number }) {
  const [addOverheadOpen, setAddOverheadOpen] = useState(false)
  const [activeSection, setActiveSection] = useState<CostingSection>('summary')
  const queryClient = useQueryClient()
  const { toast } = useToast()

  // Feature flag: include linked sub-products in Effective BOM
  const featureAttach = typeof process !== 'undefined' && process.env.NEXT_PUBLIC_FEATURE_ATTACH_BOM === 'true'

  // Fetch costing snapshot
  const { data: snapshotResponse } = useQuery({
    queryKey: ['cutlist-costing-snapshot', productId],
    queryFn: async () => {
      const res = await authorizedFetch(`/api/products/${productId}/cutlist-costing-snapshot`)
      if (!res.ok) return { snapshot: null }
      return (await res.json()) as { snapshot: { snapshot_data: CutlistCostingSnapshot; parts_hash: string } | null }
    },
  })

  // Fetch cutlist groups for staleness check
  const { data: cutlistGroups } = useQuery({
    queryKey: ['cutlist-groups-costing', productId],
    queryFn: async () => {
      const res = await authorizedFetch(`/api/products/${productId}/cutlist-groups`)
      if (!res.ok) return { groups: [] }
      return (await res.json()) as { groups: unknown[] }
    },
  })

  const snapshot = snapshotResponse?.snapshot?.snapshot_data ?? null
  const storedHash = snapshotResponse?.snapshot?.parts_hash ?? null
  const hasCutlistGroups = (cutlistGroups?.groups?.length ?? 0) > 0

  const currentPartsHash = useMemo(() => {
    if (!cutlistGroups?.groups?.length) return null
    const parts = flattenGroupsToCompactParts(cutlistGroups.groups as never[])
    return computePartsHash(parts)
  }, [cutlistGroups])

  const isStale = storedHash !== null && currentPartsHash !== null && storedHash !== currentPartsHash

  const cutlistCostLines = useMemo(() => snapshot ? deriveCutlistCostLines(snapshot) : [], [snapshot])
  const cutlistPaddedTotal = useMemo(() => cutlistCostLines.reduce((s, l) => s + (l.paddedCost ?? 0), 0), [cutlistCostLines])
  const cutlistActualTotal = useMemo(() => cutlistCostLines.reduce((s, l) => s + (l.actualCost ?? 0), 0), [cutlistCostLines])

  // Effective BOM (explicit + linked) via API
  const { data: effective = { items: [] as EffectiveItem[] }, isLoading: effLoading } = useQuery({
    enabled: featureAttach,
    queryKey: ['effective-bom', productId],
    queryFn: async () => {
      try {
        const res = await authorizedFetch(`/api/products/${productId}/effective-bom`)
        if (!res.ok) return { items: [] as EffectiveItem[] }
        return (await res.json()) as { items: EffectiveItem[] }
      } catch {
        return { items: [] as EffectiveItem[] }
      }
    },
  })

  // Fallback: explicit BOM rows only
  const { data: bom = [], isLoading: bomLoading } = useQuery({
    queryKey: ['costing-bom', productId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('billofmaterials')
        .select(`
          bom_id,
          component_id,
          quantity_required,
          components(component_id, internal_code, description),
          supplierComponent:suppliercomponents(supplier_component_id, price)
        `)
        .eq('product_id', productId)
      if (error) throw error
      return (data || []) as unknown as BomRow[]
    },
  })

  // Component metadata for codes/descriptions when using Effective BOM
  const effectiveIds = Array.from(new Set((effective?.items || []).map((it) => Number(it.component_id))))
  const { data: componentMeta = [], isLoading: compsLoading } = useQuery({
    enabled: featureAttach && effectiveIds.length > 0,
    queryKey: ['costing-components-meta', effectiveIds.sort().join(',')],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('components')
        .select('component_id, internal_code, description')
        .in('component_id', effectiveIds)
      if (error) throw error
      return (data || []) as { component_id: number; internal_code: string; description: string | null }[]
    },
  })

  const usingEffective = featureAttach && (effective?.items?.length || 0) > 0
  const compsMap = new Map(componentMeta.map((c) => [Number(c.component_id), c]))

  const effectiveItems = useMemo(
    () => snapshot ? (effective.items || []).filter(it => !it.is_cutlist_item) : (effective.items || []),
    [snapshot, effective.items]
  )

  const materials = usingEffective
    ? effectiveItems.map((it) => {
        const meta = compsMap.get(Number(it.component_id))
        const unit = it.suppliercomponents?.price ?? null
        const line = unit != null ? Number(unit) * Number(it.quantity_required) : null
        return {
          code: meta?.internal_code ?? String(it.component_id),
          description: meta?.description ?? '',
          qty: Number(it.quantity_required),
          unitPrice: unit,
          lineTotal: line,
        }
      })
    : bom.map((r) => {
        const unit = r.supplierComponent?.price ?? null
        const line = unit != null ? Number(unit) * Number(r.quantity_required) : null
        return {
          code: r.components?.internal_code ?? String(r.component_id),
          description: r.components?.description ?? '',
          qty: Number(r.quantity_required),
          unitPrice: unit,
          lineTotal: line,
        }
      })

  const materialsLoading = usingEffective ? (effLoading || compsLoading) : bomLoading
  const missingPrices = materials.filter((m) => m.unitPrice == null).length
  const materialsCost = materials.reduce((sum, m) => sum + (m.lineTotal || 0), 0)
  const totalMaterialsCost = materialsCost + cutlistPaddedTotal

  // Labor (BOL)
  const { data: bol = [], isLoading: bolLoading } = useQuery({
    queryKey: ['costing-bol', productId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('billoflabour')
        .select(`
          bol_id,
          pay_type,
          time_required,
          time_unit,
          quantity,
          jobs(
            name,
            job_categories(name)
          ),
          job_category_rates(hourly_rate),
          job_hourly_rates(hourly_rate),
          piece_work_rates(rate)
        `)
        .eq('product_id', productId)
      if (error) throw error
      return (data || []) as unknown as BolRow[]
    },
  })

  // Effective BOL (explicit + linked) via API when feature enabled
  const { data: effBol = { items: [] as EffectiveBolItem[] }, isLoading: effBolLoading } = useQuery({
    enabled: featureAttach,
    queryKey: ['effective-bol', productId],
    queryFn: async () => {
      try {
        const res = await authorizedFetch(`/api/products/${productId}/effective-bol`)
        if (!res.ok) return { items: [] as EffectiveBolItem[] }
        return (await res.json()) as { items: EffectiveBolItem[] }
      } catch {
        return { items: [] as EffectiveBolItem[] }
      }
    },
  })

  const effectiveBolItems = Array.isArray(effBol?.items) ? effBol.items : []
  const usingEffectiveBol = featureAttach && effectiveBolItems.length > 0
  const labourRows = usingEffectiveBol ? effectiveBolItems : bol

  const labour = labourRows.map((r: any) => {
    const qty = Number(r.quantity || 1)
    if ((r.pay_type || 'hourly') === 'piece') {
      const rate = usingEffectiveBol ? Number(r.piece_rate || 0) : Number(r.piece_work_rates?.rate || 0)
      return {
        category: usingEffectiveBol ? (r.category_name || '') : (r.jobs?.job_categories?.name || ''),
        job: usingEffectiveBol ? (r.job_name || '') : (r.jobs?.name || ''),
        hours: 0,
        qty,
        hourlyRate: rate, // displayed generically as Rate
        lineTotal: rate * qty,
      }
    } else {
      const hours = toHours(Number(r.time_required), r.time_unit)
      const rate = usingEffectiveBol
        ? Number(r.hourly_rate ?? 0)
        : Number(r.job_hourly_rates?.hourly_rate ?? r.job_category_rates?.hourly_rate ?? 0)
      const line = hours * qty * rate
      return {
        category: usingEffectiveBol ? (r.category_name || '') : (r.jobs?.job_categories?.name || ''),
        job: usingEffectiveBol ? (r.job_name || '') : (r.jobs?.name || ''),
        hours,
        qty,
        hourlyRate: rate,
        lineTotal: line,
      }
    }
  })
  const labourCost = labour.reduce((sum, l) => sum + l.lineTotal, 0)

  // Overhead Costs
  const { data: overheadData = [], isLoading: overheadLoading } = useQuery({
    queryKey: ['product-overhead', productId],
    queryFn: async () => {
      const res = await authorizedFetch(`/api/products/${productId}/overhead`)
      if (!res.ok) return []
      const json = await res.json()
      // API returns { items: [...] }, extract the items array
      const items = json?.items ?? json
      return Array.isArray(items) ? items : []
    },
  })
  // Safety: ensure overheadItems is always an array
  const overheadItems: ProductOverheadItem[] = Array.isArray(overheadData) ? overheadData : []

  function calculateOverheadLine(item: ProductOverheadItem): number {
    const value = item.override_value ?? item.element.default_value
    const qty = item.quantity

    if (item.element.cost_type === 'fixed') {
      return value * qty
    }

    // Percentage type
    const basis =
      item.element.percentage_basis === 'materials'
        ? totalMaterialsCost
        : item.element.percentage_basis === 'labor'
        ? labourCost
        : totalMaterialsCost + labourCost // 'total'

    return (basis * value / 100) * qty
  }

  const overhead = overheadItems.map((item) => ({
    element_id: item.element_id,
    code: item.element.code,
    name: item.element.name,
    type: item.element.cost_type,
    value: item.override_value ?? item.element.default_value,
    quantity: item.quantity,
    lineTotal: calculateOverheadLine(item),
  }))
  const overheadCost = overhead.reduce((sum, o) => sum + o.lineTotal, 0)

  const unitCost = totalMaterialsCost + labourCost + overheadCost

  async function handleRemoveOverhead(elementId: number) {
    try {
      const res = await authorizedFetch(`/api/products/${productId}/overhead?element_id=${elementId}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        throw new Error('Failed to remove overhead')
      }
      queryClient.invalidateQueries({ queryKey: ['product-overhead', productId] })
      toast({ title: 'Overhead removed', description: 'The overhead cost has been removed from this product.' })
    } catch (error) {
      console.error('Failed to remove overhead:', error)
      toast({ title: 'Error', description: 'Failed to remove overhead cost.', variant: 'destructive' })
    }
  }

  function handleOverheadAdded() {
    queryClient.invalidateQueries({ queryKey: ['product-overhead', productId] })
    setAddOverheadOpen(false)
  }

  const sections: { key: CostingSection; label: string; count?: number; cost?: number }[] = [
    { key: 'summary', label: 'Summary' },
    { key: 'materials', label: 'Materials', count: materials.length + cutlistCostLines.length, cost: totalMaterialsCost },
    { key: 'labor', label: 'Labor', count: labour.length, cost: labourCost },
    { key: 'overhead', label: 'Overhead', count: overhead.length, cost: overheadCost },
  ]

  // Build cost driver rows for summary: top items across all categories
  const costDrivers: { name: string; category: 'Materials' | 'Labor' | 'Overhead'; amount: number }[] = []
  materials.forEach((m) => {
    if (m.lineTotal && m.lineTotal > 0) {
      costDrivers.push({ name: m.code + (m.description ? ` – ${m.description}` : ''), category: 'Materials', amount: m.lineTotal })
    }
  })
  cutlistCostLines.forEach((cl) => {
    if (cl.paddedCost && cl.paddedCost > 0) {
      costDrivers.push({ name: cl.label, category: 'Materials', amount: cl.paddedCost })
    }
  })
  labour.forEach((l) => {
    if (l.lineTotal > 0) {
      costDrivers.push({ name: l.job || l.category, category: 'Labor', amount: l.lineTotal })
    }
  })
  overhead.forEach((o) => {
    if (o.lineTotal > 0) {
      costDrivers.push({ name: o.name || o.code, category: 'Overhead', amount: o.lineTotal })
    }
  })
  costDrivers.sort((a, b) => b.amount - a.amount)
  const topDrivers = costDrivers.slice(0, 8)

  const pctOf = (v: number) => (unitCost > 0 ? ((v / unitCost) * 100).toFixed(1) : '0.0')

  const categoryMeta: Record<string, { color: string; bg: string; icon: React.ReactNode }> = {
    Materials: { color: 'text-blue-400', bg: 'bg-blue-500', icon: <Package className="h-4 w-4" /> },
    Labor:     { color: 'text-emerald-400', bg: 'bg-emerald-500', icon: <Clock className="h-4 w-4" /> },
    Overhead:  { color: 'text-amber-400', bg: 'bg-amber-500', icon: <Settings2 className="h-4 w-4" /> },
  }

  const isAnyLoading = materialsLoading || (usingEffectiveBol ? effBolLoading : bolLoading) || overheadLoading

  return (
    <div className="space-y-0">
      {/* Compact cost summary + section tabs in one bar */}
      <div className="flex items-center justify-between border-b pb-0 mb-0">
        {/* Section tabs */}
        <div className="flex">
          {sections.map((s) => (
            <button
              key={s.key}
              onClick={() => setActiveSection(s.key)}
              className={`
                relative px-4 py-3 text-sm font-medium transition-colors
                ${activeSection === s.key
                  ? 'text-foreground after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-primary'
                  : 'text-muted-foreground hover:text-foreground'
                }
              `}
            >
              <span>{s.label}</span>
              {s.count != null && (
                <>
                  <span className="ml-2 text-xs text-muted-foreground">({s.count})</span>
                  <span className="ml-2 text-xs font-semibold">{fmtMoney(s.cost ?? 0)}</span>
                </>
              )}
            </button>
          ))}
        </div>

        {/* Unit cost badge */}
        <div className="flex items-center gap-2 pr-2">
          {missingPrices > 0 && (
            <span className="text-xs text-amber-500">{missingPrices} missing price{missingPrices !== 1 ? 's' : ''}</span>
          )}
          <div className="text-sm text-muted-foreground">Unit Cost</div>
          <div className="text-lg font-bold">{fmtMoney(unitCost)}</div>
        </div>
      </div>

      {/* Section content */}
      <div className="pt-4">
        {activeSection === 'summary' && (
          <div className="space-y-5">
            {isAnyLoading ? (
              <div className="py-8 text-center text-muted-foreground">Loading cost data...</div>
            ) : (
              <>
                {/* Hero unit cost + composition bar */}
                <div className="rounded-lg border bg-card p-5">
                  <div className="flex items-baseline justify-between mb-4">
                    <div>
                      <div className="text-sm font-medium text-muted-foreground mb-1">Total Unit Cost</div>
                      <div className="text-3xl font-bold tracking-tight">{fmtMoney(unitCost)}</div>
                    </div>
                    {missingPrices > 0 && (
                      <div className="flex items-center gap-1.5 text-amber-500 text-sm">
                        <AlertTriangle className="h-4 w-4" />
                        <span>{missingPrices} item{missingPrices !== 1 ? 's' : ''} missing prices</span>
                      </div>
                    )}
                  </div>

                  {/* Composition bar */}
                  {unitCost > 0 ? (
                    <div className="space-y-2">
                      <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted/50">
                        {totalMaterialsCost > 0 && (
                          <div
                            className="bg-blue-500 transition-all duration-500"
                            style={{ width: `${pctOf(totalMaterialsCost)}%` }}
                          />
                        )}
                        {labourCost > 0 && (
                          <div
                            className="bg-emerald-500 transition-all duration-500"
                            style={{ width: `${pctOf(labourCost)}%` }}
                          />
                        )}
                        {overheadCost > 0 && (
                          <div
                            className="bg-amber-500 transition-all duration-500"
                            style={{ width: `${pctOf(overheadCost)}%` }}
                          />
                        )}
                      </div>
                      <div className="flex items-center gap-4 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1.5">
                          <span className="inline-block h-2.5 w-2.5 rounded-full bg-blue-500" />
                          Materials {pctOf(totalMaterialsCost)}%
                        </span>
                        <span className="flex items-center gap-1.5">
                          <span className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-500" />
                          Labor {pctOf(labourCost)}%
                        </span>
                        <span className="flex items-center gap-1.5">
                          <span className="inline-block h-2.5 w-2.5 rounded-full bg-amber-500" />
                          Overhead {pctOf(overheadCost)}%
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="text-sm text-muted-foreground">No costs recorded yet.</div>
                  )}
                </div>

                {/* Standard Pricing */}
                <ProductPricingSection productId={productId} unitCost={unitCost} />

                {/* Category cards */}
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { label: 'Materials', cost: totalMaterialsCost, count: materials.length + cutlistCostLines.length, section: 'materials' as CostingSection },
                    { label: 'Labor', cost: labourCost, count: labour.length, section: 'labor' as CostingSection },
                    { label: 'Overhead', cost: overheadCost, count: overhead.length, section: 'overhead' as CostingSection },
                  ].map((cat) => {
                    const meta = categoryMeta[cat.label]
                    return (
                      <button
                        key={cat.label}
                        onClick={() => setActiveSection(cat.section)}
                        className="group rounded-lg border bg-card p-4 text-left transition-colors hover:bg-accent/50"
                      >
                        <div className="flex items-center justify-between mb-2">
                          <div className={`flex items-center gap-2 text-sm font-medium ${meta.color}`}>
                            {meta.icon}
                            {cat.label}
                          </div>
                          <ArrowRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                        </div>
                        <div className="text-xl font-bold">{fmtMoney(cat.cost)}</div>
                        <div className="text-xs text-muted-foreground mt-1">
                          {cat.count} {cat.count === 1 ? 'item' : 'items'}
                          {unitCost > 0 && (
                            <span className="ml-1.5">· {pctOf(cat.cost)}% of total</span>
                          )}
                        </div>
                      </button>
                    )
                  })}
                </div>

                {/* Top cost drivers */}
                {topDrivers.length > 0 && (
                  <div className="rounded-lg border bg-card">
                    <div className="flex items-center gap-2 px-4 py-3 border-b">
                      <TrendingUp className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm font-medium">Cost Drivers</span>
                      <span className="text-xs text-muted-foreground ml-auto">Largest line items across all categories</span>
                    </div>
                    <div className="divide-y">
                      {topDrivers.map((d, i) => {
                        const meta = categoryMeta[d.category]
                        const barWidth = costDrivers[0]?.amount ? (d.amount / costDrivers[0].amount) * 100 : 0
                        return (
                          <div key={i} className="flex items-center gap-3 px-4 py-2.5">
                            <span className="text-xs text-muted-foreground w-5 text-right tabular-nums">{i + 1}</span>
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium truncate">{d.name}</div>
                              <div className="flex items-center gap-1.5 mt-0.5">
                                <span className={`inline-block h-2 w-2 rounded-full ${meta.bg}`} />
                                <span className="text-xs text-muted-foreground">{d.category}</span>
                              </div>
                            </div>
                            <div className="w-28 hidden sm:block">
                              <div className="h-1.5 w-full rounded-full bg-muted/50 overflow-hidden">
                                <div
                                  className={`h-full rounded-full ${meta.bg} opacity-60 transition-all duration-500`}
                                  style={{ width: `${barWidth}%` }}
                                />
                              </div>
                            </div>
                            <div className="text-sm font-semibold tabular-nums w-20 text-right">{fmtMoney(d.amount)}</div>
                            <div className="text-xs text-muted-foreground tabular-nums w-12 text-right">{pctOf(d.amount)}%</div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* Empty state */}
                {unitCost === 0 && costDrivers.length === 0 && (
                  <div className="rounded-lg border border-dashed p-8 text-center">
                    <Package className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
                    <div className="text-sm font-medium mb-1">No costs defined yet</div>
                    <div className="text-xs text-muted-foreground mb-4">
                      Add materials, labor, or overhead items to see the cost summary.
                    </div>
                    <div className="flex justify-center gap-2">
                      <Button variant="outline" size="sm" onClick={() => setActiveSection('materials')}>
                        <Package className="h-3.5 w-3.5 mr-1.5" />
                        Add Materials
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => setActiveSection('labor')}>
                        <Clock className="h-3.5 w-3.5 mr-1.5" />
                        Add Labor
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {activeSection === 'materials' && (
          <div className="space-y-0">
            {isStale && (
              <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-sm px-3 py-2 mb-3 flex items-center gap-2 text-xs text-yellow-200">
                <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
                <span>Cutlist parts have been modified since the last layout calculation. Costs may be outdated.</span>
                <a href={`/products/${productId}/cutlist-builder`} className="text-primary underline ml-auto whitespace-nowrap">
                  Open Cutlist Builder &rarr;
                </a>
              </div>
            )}
            {!snapshot && hasCutlistGroups && (
              <div className="bg-muted/50 border border-border rounded-sm px-3 py-2 mb-3 flex items-center gap-2 text-xs text-muted-foreground">
                <Package className="h-3.5 w-3.5 flex-shrink-0" />
                <span>This product has cutlist parts but no layout has been calculated yet.</span>
                <a href={`/products/${productId}/cutlist-builder`} className="text-primary underline ml-auto whitespace-nowrap">
                  Open Cutlist Builder &rarr;
                </a>
              </div>
            )}

            <ProductBOM productId={productId} />

            {snapshot && cutlistCostLines.length > 0 && (
              <div className="mt-4">
                <h4 className="text-xs font-medium text-muted-foreground uppercase mb-2">Cutlist Materials</h4>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Material</TableHead>
                      <TableHead className="text-right">Actual</TableHead>
                      <TableHead className="text-right">Padded</TableHead>
                      <TableHead className="text-right">Unit Price</TableHead>
                      <TableHead className="text-right">Actual Cost</TableHead>
                      <TableHead className="text-right">Padded Cost</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {cutlistCostLines.map((line, i) => (
                      <TableRow key={i}>
                        <TableCell className="text-sm">{line.label}</TableCell>
                        <TableCell className="text-right tabular-nums text-sm">
                          {line.actual.toFixed(3)} {line.unit}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-sm font-medium">
                          {line.padded.toFixed(3)} {line.unit}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-sm">
                          {line.unitPrice !== null ? fmtMoney(line.unitPrice) : '—'}
                          {line.unit === 'm' ? '/m' : ''}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-sm text-muted-foreground">
                          {fmtMoney(line.actualCost)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-sm font-medium">
                          {fmtMoney(line.paddedCost)}
                        </TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="border-t-2">
                      <TableCell className="font-medium text-sm">Cutlist Subtotal</TableCell>
                      <TableCell />
                      <TableCell />
                      <TableCell />
                      <TableCell className="text-right tabular-nums text-sm text-muted-foreground">
                        {fmtMoney(cutlistActualTotal)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-sm font-medium">
                        {fmtMoney(cutlistPaddedTotal)}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        )}

        {activeSection === 'labor' && (
          <ProductBOL productId={productId} />
        )}

        {activeSection === 'overhead' && (
          <div className="space-y-4">
            <div className="flex justify-end">
              <Button size="sm" onClick={() => setAddOverheadOpen(true)}>
                <Plus className="h-4 w-4 mr-1" />
                Add Overhead
              </Button>
            </div>
            {overheadLoading ? (
              <div className="py-4 text-muted-foreground">Loading overhead...</div>
            ) : overhead.length === 0 ? (
              <div className="py-4 text-muted-foreground">No overhead costs assigned. Click &quot;Add Overhead&quot; to assign overhead elements to this product.</div>
            ) : (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Code</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead className="text-right">Value</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead className="text-right">Line Total</TableHead>
                      <TableHead className="w-10"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {overhead.map((o, idx) => (
                      <TableRow key={idx}>
                        <TableCell className="font-mono text-sm">{o.code}</TableCell>
                        <TableCell>{o.name}</TableCell>
                        <TableCell className="capitalize">{o.type === 'fixed' ? 'Fixed' : 'Percentage'}</TableCell>
                        <TableCell className="text-right">
                          {o.type === 'fixed' ? fmtMoney(o.value) : `${o.value}%`}
                        </TableCell>
                        <TableCell className="text-right">{o.quantity}</TableCell>
                        <TableCell className="text-right font-medium">{fmtMoney(o.lineTotal)}</TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive hover:text-destructive"
                            onClick={() => handleRemoveOverhead(o.element_id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Add Overhead Dialog */}
      <AddOverheadDialog
        open={addOverheadOpen}
        onOpenChange={setAddOverheadOpen}
        productId={productId}
        existingElementIds={overheadItems.map(item => item.element_id)}
        onSuccess={handleOverheadAdded}
      />
    </div>
  )
}

export default ProductCosting
