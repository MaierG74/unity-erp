'use client'

import { useEffect, useMemo, useState } from 'react'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

type ComponentRow = { component_id: number; internal_code: string; description: string | null }
type Item = { component_id: number; quantity_required: number; supplier_component_id?: number | null; component?: ComponentRow }
type SupplierOption = { supplier_component_id: number; supplier_id: number; supplier_name: string; price: number | null }

export default function CollectionEditor({ id }: { id?: number }) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [description, setDescription] = useState<string | null>('')
  const [isPhantom, setIsPhantom] = useState(true)
  const [items, setItems] = useState<Item[]>([])

  // component search
  const [compQuery, setCompQuery] = useState('')
  const [compResults, setCompResults] = useState<ComponentRow[]>([])
  const [compQty, setCompQty] = useState<number>(1)
  const [compSelected, setCompSelected] = useState<ComponentRow | null>(null)
  const [supplierMap, setSupplierMap] = useState<Record<number, SupplierOption[]>>({}) // by component_id
  const [supplierLoading, setSupplierLoading] = useState<Record<number, boolean>>({})

  useEffect(() => {
    const load = async () => {
      if (!id) return
      setLoading(true)
      try {
        const res = await fetch(`/api/collections/${id}`, { cache: 'no-store' })
        const json = await res.json()
        if (json?.collection) {
          setCode(json.collection.code)
          setName(json.collection.name)
          setDescription(json.collection.description)
          setIsPhantom(json.collection.is_phantom)
        }
        const its = (json?.items || []) as Item[]
        setItems(its)
        // hydrate component info for display
        if (its.length > 0) {
          const ids = Array.from(new Set(its.map((i) => i.component_id)))
          const compRes = await fetch(`/api/debug?components=${ids.join(',')}`).catch(() => null)
          // Fallback: ignore if no debug route
        }
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [id])

  // (removed unused effect)

  // Minimal direct search using Supabase JS on client
  useEffect(() => {
    let active = true
    const run = async () => {
      if (!compQuery || compQuery.length < 2) { setCompResults([]); return }
      try {
        const { data, error } = await supabase
          .from('components')
          .select('component_id, internal_code, description')
          .or(`internal_code.ilike.%${compQuery}%,description.ilike.%${compQuery}%`)
          .limit(10)
        if (error) throw error
        if (active) setCompResults((data as any) || [])
      } catch {
        // ignore
      }
    }
    run()
    return () => { active = false }
  }, [compQuery])

  const addItemFrom = (c: ComponentRow) => {
    setItems((prev) => [
      ...prev,
      { component_id: c.component_id, quantity_required: compQty, component: c },
    ])
    // optimistically fetch suppliers for this component for quick selection
    void ensureSuppliers(c.component_id)
    setCompSelected(null)
    setCompQuery('')
    setCompQty(1)
    setCompResults([])
  }

  const addItem = () => {
    if (!compSelected) return
    addItemFrom(compSelected)
  }

  const save = async () => {
    setSaving(true)
    try {
      const payload = {
        collection_id: id,
        code,
        name,
        description,
        is_phantom: isPhantom,
        items: items.map((i) => ({ component_id: i.component_id, quantity_required: i.quantity_required, supplier_component_id: i.supplier_component_id ?? null })),
      }
      const res = await fetch('/api/collections', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      if (!res.ok) throw new Error('Save failed')
      const json = await res.json()
      const cid = json.collection?.collection_id || id
      router.push(`/collections/${cid}`)
    } catch (e) {
      console.error(e)
      alert('Failed to save collection')
    } finally {
      setSaving(false)
    }
  }

  const canSave = code.trim().length > 0 && name.trim().length > 0

  async function ensureSuppliers(componentId: number) {
    if (supplierMap[componentId] || supplierLoading[componentId]) return
    setSupplierLoading((m) => ({ ...m, [componentId]: true }))
    try {
      const { data, error } = await supabase
        .from('suppliercomponents')
        .select('supplier_component_id, component_id, supplier_id, price, suppliers(supplier_id, name)')
        .eq('component_id', componentId)
      if (error) throw error
      const opts: SupplierOption[] = (data || []).map((r: any) => ({
        supplier_component_id: r.supplier_component_id,
        supplier_id: r.supplier_id,
        supplier_name: r.suppliers?.name || `Supplier ${r.supplier_id}`,
        price: r.price ?? null,
      }))
      setSupplierMap((m) => ({ ...m, [componentId]: opts }))
    } catch (e) {
      // leave empty on error
    } finally {
      setSupplierLoading((m) => ({ ...m, [componentId]: false }))
    }
  }

  // When items change, lazily ensure supplier lists for new components
  useEffect(() => {
    const unique = Array.from(new Set(items.map((i) => i.component_id)))
    unique.forEach((cid) => { void ensureSuppliers(cid) })
  }, [items])

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">Code</label>
          <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="BASE-CHAIR" />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">Name</label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Base Chair Pack" />
        </div>
        <div className="space-y-2 md:col-span-2">
          <label className="text-sm font-medium">Description</label>
          <Textarea value={description ?? ''} onChange={(e) => setDescription(e.target.value)} rows={3} />
        </div>
        <div className="flex items-center gap-3">
          <Switch checked={isPhantom} onCheckedChange={setIsPhantom} />
          <span className="text-sm">Phantom (always explode)</span>
        </div>
      </div>

      <div className="space-y-3">
        <div className="font-medium">Items</div>
        <div className="flex gap-2 items-center">
          <Input
            placeholder="Search components (min 2 chars)"
            value={compQuery}
            onChange={(e) => setCompQuery(e.target.value)}
            className="w-80"
          />
          <Input
            type="number"
            value={compQty}
            onChange={(e) => setCompQty(Math.max(0.0001, Number(e.target.value)))}
            className="w-24"
            step="0.01"
            min="0.0001"
          />
          <Button onClick={addItem} disabled={!compSelected}>Add</Button>
        </div>
        {compResults.length > 0 && !compSelected && (
          <div className="border rounded-md max-h-56 overflow-auto">
            {compResults.map((c) => (
              <button
                key={c.component_id}
                className="w-full text-left px-3 py-2 hover:bg-accent"
                onClick={() => addItemFrom(c)}
              >
                <span className="font-mono mr-2">{c.internal_code}</span>
                <span className="text-muted-foreground">{c.description}</span>
              </button>
            ))}
          </div>
        )}

        <div className="rounded-md border">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left">
                <th className="p-3">Component</th>
                <th className="p-3">Description</th>
                <th className="p-3">Quantity</th>
                <th className="p-3">Supplier (optional)</th>
                <th className="p-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr><td className="p-4 text-muted-foreground" colSpan={5}>No items yet</td></tr>
              ) : (
                items.map((it, idx) => (
                  <tr key={idx} className="border-t">
                    <td className="p-3 font-mono">{it.component?.internal_code || it.component_id}</td>
                    <td className="p-3">{it.component?.description || ''}</td>
                    <td className="p-3">
                      <Input
                        type="number"
                        value={it.quantity_required}
                        onChange={(e) => {
                          const v = Math.max(0.0001, Number(e.target.value))
                          setItems((prev) => prev.map((p, i) => (i === idx ? { ...p, quantity_required: v } : p)))
                        }}
                        className="w-24"
                        step="0.01"
                        min="0.0001"
                      />
                    </td>
                    <td className="p-3">
                      <Select
                        value={it.supplier_component_id ? String(it.supplier_component_id) : 'none'}
                        onValueChange={(val) => {
                          setItems((prev) => prev.map((p, i) => (
                            i === idx ? { ...p, supplier_component_id: val === 'none' ? null : Number(val) } : p
                          )))
                        }}
                      >
                        <SelectTrigger className="w-72">
                          <SelectValue placeholder={supplierLoading[it.component_id] ? 'Loading…' : 'Unspecified'} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Unspecified</SelectItem>
                          {(supplierMap[it.component_id] || []).map((s) => (
                            <SelectItem key={s.supplier_component_id} value={String(s.supplier_component_id)}>
                              {s.supplier_name}{s.price != null ? ` — R${Number(s.price).toFixed(2)}` : ''}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="p-3">
                      <Button variant="destructive" onClick={() => setItems((prev) => prev.filter((_, i) => i !== idx))}>Remove</Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex gap-2 justify-end">
        <Button variant="outline" onClick={() => router.push('/collections')}>Cancel</Button>
        <Button onClick={save} disabled={!canSave || saving}>{id ? 'Save' : 'Create'}</Button>
      </div>

      <p className="text-xs text-muted-foreground">
        Tip: type 2+ letters to search components by internal code or description. Click a result to add it immediately.
      </p>
    </div>
  )
}
