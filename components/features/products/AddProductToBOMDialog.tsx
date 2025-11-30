'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { supabase } from '@/lib/supabase'

type ProductRow = { product_id: number; internal_code: string; name: string }
type BomPreviewRow = { component_id: number; quantity_required: number; components?: { internal_code: string; description: string | null } }

export default function AddProductToBOMDialog({ productId, onApplied }: { productId: number; onApplied?: () => void }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(false)
  const [products, setProducts] = useState<ProductRow[]>([])
  const [selected, setSelected] = useState<ProductRow | null>(null)
  const [itemsPreview, setItemsPreview] = useState<BomPreviewRow[] | null>(null)
  const [quantity, setQuantity] = useState<number>(1)
  const featureAttach = typeof process !== 'undefined' && process.env.NEXT_PUBLIC_FEATURE_ATTACH_BOM === 'true'
  const [mode, setMode] = useState<'apply' | 'attach'>(featureAttach ? 'apply' : 'apply')

  useEffect(() => {
    if (!open) return
    void search()
  }, [open])

  async function search() {
    setLoading(true)
    try {
      let query = supabase
        .from('products')
        .select('product_id, internal_code, name')
        .order('name')
        .limit(25)

      if (q && q.trim().length > 0) {
        query = query.or(`name.ilike.%${q}%,internal_code.ilike.%${q}%`)
      }

      const { data, error } = await query
      if (error) throw error
      setProducts((data as ProductRow[]) || [])
    } catch (e) {
      console.error('Search products failed', e)
      setProducts([])
    } finally {
      setLoading(false)
    }
  }

  async function openPreview(prod: ProductRow) {
    setSelected(prod)
    setItemsPreview(null)
    try {
      const { data, error } = await supabase
        .from('billofmaterials')
        .select('component_id, quantity_required, components(component_id, internal_code, description)')
        .eq('product_id', prod.product_id)
      if (error) throw error
      setItemsPreview((data as any[]) || [])
    } catch (e) {
      console.error('Preview BOM failed', e)
      setItemsPreview([])
    }
  }

  async function apply() {
    if (!selected) return
    setLoading(true)
    try {
      const url = mode === 'attach'
        ? `/api/products/${productId}/bom/attach-product`
        : `/api/products/${productId}/bom/apply-product`
      const payload = mode === 'attach'
        ? { sub_product_id: selected.product_id, scale: quantity, mode: 'phantom' }
        : { sub_product_id: selected.product_id, quantity }
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) throw new Error('Apply failed')
      setOpen(false)
      setSelected(null)
      setItemsPreview(null)
      setQuantity(1)
      onApplied?.()
    } catch (e) {
      console.error(e)
      alert(mode === 'attach' ? 'Failed to attach product' : 'Failed to add product BOM')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>Add Product</Button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div className="relative bg-background border rounded-md shadow-xl w-[900px] max-h-[80vh] overflow-auto p-4 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Add Product as Components</h2>
              <Button variant="ghost" onClick={() => setOpen(false)}>Close</Button>
            </div>

            <div className="flex items-center gap-2">
              <Input placeholder="Search products..." value={q} onChange={(e) => setQ(e.target.value)} className="w-64" />
              <Button variant="outline" onClick={() => search()} disabled={loading}>Search</Button>
              <div className="ml-auto flex items-center gap-2">
                {featureAttach && (
                  <>
                    <span className="text-sm">Mode</span>
                    <select
                      className="border rounded px-2 py-1 text-sm"
                      value={mode}
                      onChange={(e) => setMode(e.target.value as 'apply' | 'attach')}
                    >
                      <option value="apply">Apply (copy)</option>
                      <option value="attach">Attach (link)</option>
                    </select>
                  </>
                )}
                <span className="text-sm">Quantity</span>
                <Input type="number" className="w-28" step="0.01" min="0.0001" value={quantity} onChange={(e) => setQuantity(Math.max(0.0001, Number(e.target.value)))} />
                <Button onClick={apply} disabled={!selected || loading}>{mode === 'attach' ? 'Attach' : 'Apply'}</Button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="rounded-md border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left">
                      <th className="p-3">Code</th>
                      <th className="p-3">Name</th>
                      <th className="p-3">Select</th>
                    </tr>
                  </thead>
                  <tbody>
                    {products.length === 0 ? (
                      <tr><td className="p-4 text-muted-foreground" colSpan={3}>{loading ? 'Loading…' : 'No results'}</td></tr>
                    ) : products.map((p) => (
                      <tr key={p.product_id} className={`border-t ${selected?.product_id === p.product_id ? 'bg-accent' : ''}`}>
                        <td className="p-3 font-mono">{p.internal_code}</td>
                        <td className="p-3">{p.name}</td>
                        <td className="p-3"><Button size="sm" variant="outline" onClick={() => openPreview(p)}>Preview</Button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="rounded-md border p-3">
                <div className="font-medium mb-2">Preview</div>
                {!itemsPreview ? (
                  <div className="text-sm text-muted-foreground">Select a product to preview its BOM.</div>
                ) : itemsPreview.length === 0 ? (
                  <div className="text-sm text-muted-foreground">This product has no BOM items.</div>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left">
                        <th className="p-2">Component</th>
                        <th className="p-2">Description</th>
                        <th className="p-2">Qty</th>
                      </tr>
                    </thead>
                    <tbody>
                      {itemsPreview.map((it, idx) => (
                        <tr key={idx} className="border-t">
                          <td className="p-2">{it.components?.internal_code || it.component_id}</td>
                          <td className="p-2 text-muted-foreground">{it.components?.description || ''}</td>
                          <td className="p-2">{(Number(it.quantity_required) * Number(quantity || 1)).toString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                <p className="text-xs text-muted-foreground mt-3">
                  {mode === 'attach'
                    ? 'Attaches the selected product (phantom). Changes to its BOM will flow into this product\'s totals.'
                    : 'Applies the selected product\'s BOM to this product by copying its components (phantom assembly behavior).'}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
