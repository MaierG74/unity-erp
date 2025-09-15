'use client'

import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

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
    job_categories: { name: string; current_hourly_rate: number }
  }
  job_hourly_rates?: { hourly_rate: number } | null
  piece_work_rates?: { rate: number } | null
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

export function ProductCosting({ productId }: { productId: number }) {
  // Feature flag: include linked sub-products in Effective BOM
  const featureAttach = typeof process !== 'undefined' && process.env.NEXT_PUBLIC_FEATURE_ATTACH_BOM === 'true'

  // Effective BOM (explicit + linked) via API
  const { data: effective = { items: [] as EffectiveItem[] }, isLoading: effLoading } = useQuery({
    enabled: featureAttach,
    queryKey: ['effective-bom', productId],
    queryFn: async () => {
      try {
        const res = await fetch(`/api/products/${productId}/effective-bom`)
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

  const materials = usingEffective
    ? (effective.items || []).map((it) => {
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
            job_categories(name, current_hourly_rate)
          ),
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
        const res = await fetch(`/api/products/${productId}/effective-bol`)
        if (!res.ok) return { items: [] as EffectiveBolItem[] }
        return (await res.json()) as { items: EffectiveBolItem[] }
      } catch {
        return { items: [] as EffectiveBolItem[] }
      }
    },
  })

  const labour = (featureAttach ? effBol.items : bol).map((r: any) => {
    const qty = Number(r.quantity || 1)
    if ((r.pay_type || 'hourly') === 'piece') {
      const rate = featureAttach ? Number(r.piece_rate || 0) : Number(r.piece_work_rates?.rate || 0)
      return {
        category: featureAttach ? (r.category_name || '') : (r.jobs?.job_categories?.name || ''),
        job: featureAttach ? (r.job_name || '') : (r.jobs?.name || ''),
        hours: 0,
        qty,
        hourlyRate: rate, // displayed generically as Rate
        lineTotal: rate * qty,
      }
    } else {
      const hours = toHours(Number(r.time_required), r.time_unit)
      const rate = featureAttach
        ? Number(r.hourly_rate ?? 0)
        : Number(r.job_hourly_rates?.hourly_rate ?? r.jobs?.job_categories?.current_hourly_rate ?? 0)
      const line = hours * qty * rate
      return {
        category: featureAttach ? (r.category_name || '') : (r.jobs?.job_categories?.name || ''),
        job: featureAttach ? (r.job_name || '') : (r.jobs?.name || ''),
        hours,
        qty,
        hourlyRate: rate,
        lineTotal: line,
      }
    }
  })
  const labourCost = labour.reduce((sum, l) => sum + l.lineTotal, 0)

  const unitCost = materialsCost + labourCost

  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader><CardTitle>Materials Cost</CardTitle></CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{fmtMoney(materialsCost)}</div>
            {missingPrices > 0 && (
              <CardDescription>{missingPrices} item(s) missing prices</CardDescription>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Labor Cost</CardTitle></CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{fmtMoney(labourCost)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Unit Cost</CardTitle></CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{fmtMoney(unitCost)}</div>
          </CardContent>
        </Card>
      </div>

      {/* Materials Breakdown */}
      <Card>
        <CardHeader>
          <CardTitle>Materials Breakdown</CardTitle>
          <CardDescription>{usingEffective ? 'From Effective BOM (explicit + linked)' : 'From Bill of Materials'}</CardDescription>
        </CardHeader>
        <CardContent>
          {materialsLoading ? (
            <div className="py-4">Loading materials…</div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Component</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Unit Price</TableHead>
                    <TableHead className="text-right">Line Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {materials.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="py-4 text-center text-muted-foreground">No components</TableCell>
                    </TableRow>
                  ) : (
                    materials.map((m, idx) => (
                      <TableRow key={idx}>
                        <TableCell className="font-mono">{m.code}</TableCell>
                        <TableCell>{m.description}</TableCell>
                        <TableCell className="text-right">{m.qty}</TableCell>
                        <TableCell className="text-right">{fmtMoney(m.unitPrice)}</TableCell>
                        <TableCell className="text-right">{fmtMoney(m.lineTotal)}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Labor Breakdown */}
      <Card>
        <CardHeader>
          <CardTitle>Labor Breakdown</CardTitle>
          <CardDescription>From Bill of Labor</CardDescription>
        </CardHeader>
        <CardContent>
          {bolLoading ? (
            <div className="py-4">Loading labor…</div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Category</TableHead>
                    <TableHead>Job</TableHead>
                    <TableHead className="text-right">Hours</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Rate</TableHead>
                    <TableHead className="text-right">Line Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {labour.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="py-4 text-center text-muted-foreground">No labor</TableCell>
                    </TableRow>
                  ) : (
                    labour.map((l, idx) => (
                      <TableRow key={idx}>
                        <TableCell>{l.category}</TableCell>
                        <TableCell>{l.job}</TableCell>
                        <TableCell className="text-right">{l.hours.toFixed(2)}</TableCell>
                        <TableCell className="text-right">{l.qty}</TableCell>
                        <TableCell className="text-right">{fmtMoney(l.hourlyRate)}</TableCell>
                        <TableCell className="text-right">{fmtMoney(l.lineTotal)}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Placeholder for future markups */}
      <Card>
        <CardHeader>
          <CardTitle>Markups (Planned)</CardTitle>
          <CardDescription>
            We will add configurable overhead and margin here to project price and profit.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  )
}

export default ProductCosting
