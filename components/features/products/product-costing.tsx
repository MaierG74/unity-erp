'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
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
import { Button } from '@/components/ui/button'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { Plus, Trash2 } from 'lucide-react'
import { AddOverheadDialog } from './AddOverheadDialog'
import { ProductBOM } from './product-bom'
import { ProductBOL } from './product-bol'
import { useToast } from '@/components/ui/use-toast'

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
  const [addOverheadOpen, setAddOverheadOpen] = useState(false)
  const queryClient = useQueryClient()
  const { toast } = useToast()

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

  // Overhead Costs
  const { data: overheadData = [], isLoading: overheadLoading } = useQuery({
    queryKey: ['product-overhead', productId],
    queryFn: async () => {
      const res = await fetch(`/api/products/${productId}/overhead`)
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
        ? materialsCost
        : item.element.percentage_basis === 'labor'
        ? labourCost
        : materialsCost + labourCost // 'total'

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

  const unitCost = materialsCost + labourCost + overheadCost

  async function handleRemoveOverhead(elementId: number) {
    try {
      const res = await fetch(`/api/products/${productId}/overhead?element_id=${elementId}`, {
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

  return (
    <div className="space-y-6">
      {/* Cost Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Materials</CardTitle></CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{fmtMoney(materialsCost)}</div>
            {missingPrices > 0 && (
              <p className="text-xs text-amber-500 mt-1">{missingPrices} item(s) missing prices</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Labor</CardTitle></CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{fmtMoney(labourCost)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Overhead</CardTitle></CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{fmtMoney(overheadCost)}</div>
          </CardContent>
        </Card>
        <Card className="bg-primary/5 border-primary/20">
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Unit Cost</CardTitle></CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{fmtMoney(unitCost)}</div>
          </CardContent>
        </Card>
      </div>

      {/* Accordion Sections */}
      <Accordion type="multiple" defaultValue={['materials']} className="space-y-3">
        {/* Materials (BOM) */}
        <AccordionItem value="materials" className="border rounded-lg px-4">
          <AccordionTrigger className="hover:no-underline">
            <div className="flex items-center gap-3">
              <span className="font-semibold">Bill of Materials</span>
              <span className="text-sm text-muted-foreground">{materials.length} component{materials.length !== 1 ? 's' : ''}</span>
              <span className="text-sm font-medium ml-auto mr-4">{fmtMoney(materialsCost)}</span>
            </div>
          </AccordionTrigger>
          <AccordionContent>
            <ProductBOM productId={productId} />
          </AccordionContent>
        </AccordionItem>

        {/* Labor (BOL) */}
        <AccordionItem value="labor" className="border rounded-lg px-4">
          <AccordionTrigger className="hover:no-underline">
            <div className="flex items-center gap-3">
              <span className="font-semibold">Bill of Labor</span>
              <span className="text-sm text-muted-foreground">{labour.length} operation{labour.length !== 1 ? 's' : ''}</span>
              <span className="text-sm font-medium ml-auto mr-4">{fmtMoney(labourCost)}</span>
            </div>
          </AccordionTrigger>
          <AccordionContent>
            <ProductBOL productId={productId} />
          </AccordionContent>
        </AccordionItem>

        {/* Overhead */}
        <AccordionItem value="overhead" className="border rounded-lg px-4">
          <AccordionTrigger className="hover:no-underline">
            <div className="flex items-center gap-3">
              <span className="font-semibold">Overhead</span>
              <span className="text-sm text-muted-foreground">{overhead.length} element{overhead.length !== 1 ? 's' : ''}</span>
              <span className="text-sm font-medium ml-auto mr-4">{fmtMoney(overheadCost)}</span>
            </div>
          </AccordionTrigger>
          <AccordionContent>
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
          </AccordionContent>
        </AccordionItem>
      </Accordion>

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
