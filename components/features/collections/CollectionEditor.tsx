'use client'

import { useEffect, useState } from 'react'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { ArrowLeft, Save, Upload, Plus, Trash2, Search, AlertCircle } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'

type ComponentRow = { component_id: number; internal_code: string; description: string | null }
type Item = { component_id: number; quantity_required: number; supplier_component_id?: number | null; component?: ComponentRow }
type SupplierOption = { supplier_component_id: number; supplier_id: number; supplier_name: string; price: number | null }

export default function CollectionEditor({ id }: { id?: number }) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)

  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [description, setDescription] = useState<string | null>('')
  const [isPhantom, setIsPhantom] = useState(true)
  const [status, setStatus] = useState<'draft' | 'published' | 'archived'>('draft')
  const [version, setVersion] = useState(1)
  const [items, setItems] = useState<Item[]>([])

  // component search
  const [compQuery, setCompQuery] = useState('')
  const [compResults, setCompResults] = useState<ComponentRow[]>([])
  const [compQty, setCompQty] = useState<number>(1)
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
          setStatus(json.collection.status)
          setVersion(json.collection.version)
        }
        // Map API response (which has 'components' joined) to our internal 'component' shape
        const its = (json?.items || []).map((i: any) => ({
          ...i,
          component: i.components || i.component // Handle both cases if API changes
        })) as Item[]
        setItems(its)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [id])

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
    const timeout = setTimeout(run, 300) // debounce
    return () => { active = false; clearTimeout(timeout) }
  }, [compQuery])

  const addItemFrom = (c: ComponentRow) => {
    setItems((prev) => [
      ...prev,
      { component_id: c.component_id, quantity_required: compQty, component: c },
    ])
    // optimistically fetch suppliers for this component for quick selection
    void ensureSuppliers(c.component_id)
    setCompQuery('')
    setCompQty(1)
    setCompResults([])
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
      if (!id && cid) {
        router.push(`/collections/${cid}`)
      } else {
        // refresh local state
        if (json.collection) {
          setVersion(json.collection.version)
          setStatus(json.collection.status)
        }
      }
    } catch (e) {
      console.error(e)
      alert('Failed to save collection')
    } finally {
      setSaving(false)
    }
  }

  const publish = async () => {
    if (!confirm('Are you sure you want to publish this collection? This will bump the version and lock the current state.')) return
    setPublishing(true)
    try {
      // Save first to ensure latest changes are captured
      await save()

      const res = await fetch(`/api/collections/${id}/publish`, { method: 'POST' })
      if (!res.ok) throw new Error('Publish failed')
      const json = await res.json()
      if (json.collection) {
        setStatus(json.collection.status)
        setVersion(json.collection.version)
      }
    } catch (e) {
      console.error(e)
      alert('Failed to publish collection')
    } finally {
      setPublishing(false)
    }
  }

  const canSave = code.trim().length > 0 && name.trim().length > 0
  const isPublished = status === 'published'

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
    <div className="space-y-6 max-w-7xl mx-auto pb-10 px-4 sm:px-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => router.push('/collections')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              {id ? 'Edit Collection' : 'New Collection'}
              {id && <Badge variant="outline">v{version}</Badge>}
              {id && <Badge variant={status === 'published' ? 'default' : 'secondary'}>{status}</Badge>}
            </h1>
            <p className="text-sm text-muted-foreground">
              {id ? `Manage collection details and items` : 'Create a new collection of components'}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => router.push('/collections')}>Cancel</Button>
          {id && status === 'draft' && (
            <Button variant="secondary" onClick={publish} disabled={publishing || saving}>
              <Upload className="mr-2 h-4 w-4" />
              Publish
            </Button>
          )}
          <Button onClick={save} disabled={!canSave || saving}>
            <Save className="mr-2 h-4 w-4" />
            {id ? 'Save Draft' : 'Create'}
          </Button>
        </div>
      </div>

      {isPublished && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Published Version</AlertTitle>
          <AlertDescription>
            This collection is published. Edits will be saved to the current draft, but won't affect the published version until you publish again.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Details */}
        <div className="lg:col-span-4 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Code</label>
                <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="BASE-CHAIR" />
                <p className="text-xs text-muted-foreground">Unique identifier for this collection.</p>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Name</label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Base Chair Pack" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Description</label>
                <Textarea value={description ?? ''} onChange={(e) => setDescription(e.target.value)} rows={4} />
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <label className="text-sm font-medium">Phantom</label>
                  <p className="text-xs text-muted-foreground">Always explode in BOM</p>
                </div>
                <Switch checked={isPhantom} onCheckedChange={setIsPhantom} />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right Column: Items */}
        <div className="lg:col-span-8 space-y-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Items</CardTitle>
                <CardDescription>Components included in this collection</CardDescription>
              </div>
              <Badge variant="secondary">{items.length} items</Badge>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Add Item Bar */}
              <div className="flex gap-2 items-start relative">
                <div className="relative flex-1">
                  <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search components to add..."
                    value={compQuery}
                    onChange={(e) => setCompQuery(e.target.value)}
                    className="pl-8"
                  />
                  {compResults.length > 0 && (
                    <div className="absolute top-full left-0 right-0 mt-1 bg-popover border rounded-md shadow-md z-10 max-h-60 overflow-auto">
                      {compResults.map((c) => (
                        <button
                          key={c.component_id}
                          className="w-full text-left px-3 py-2 hover:bg-accent text-sm flex flex-col"
                          onClick={() => addItemFrom(c)}
                        >
                          <span className="font-medium">{c.internal_code}</span>
                          <span className="text-muted-foreground text-xs">{c.description}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="w-24">
                  <Input
                    type="number"
                    value={compQty}
                    onChange={(e) => setCompQty(Math.max(0.0001, Number(e.target.value)))}
                    step="1"
                    min="0.0001"
                    placeholder="Qty"
                  />
                </div>
                <Button disabled={!compQuery} variant="secondary">
                  <Plus className="h-4 w-4" />
                </Button>
              </div>

              {/* Items List */}
              <div className="rounded-md border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr className="text-left">
                      <th className="p-3 font-medium text-muted-foreground">Component</th>
                      <th className="p-3 font-medium text-muted-foreground w-24">Qty</th>
                      <th className="p-3 font-medium text-muted-foreground">Supplier Preference</th>
                      <th className="p-3 w-10"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.length === 0 ? (
                      <tr><td className="p-8 text-center text-muted-foreground" colSpan={4}>No items added yet. Search above to add components.</td></tr>
                    ) : (
                      items.map((it, idx) => (
                        <tr key={idx} className="border-t group">
                          <td className="p-3">
                            <div className="font-medium">{it.component?.internal_code || `ID: ${it.component_id}`}</div>
                            <div className="text-xs text-muted-foreground truncate max-w-[300px]">{it.component?.description}</div>
                          </td>
                          <td className="p-3">
                            <Input
                              type="number"
                              value={it.quantity_required}
                              onChange={(e) => {
                                const v = Math.max(0.0001, Number(e.target.value))
                                setItems((prev) => prev.map((p, i) => (i === idx ? { ...p, quantity_required: v } : p)))
                              }}
                              className="h-8 w-20"
                              step="0.01"
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
                              <SelectTrigger className="h-8 w-full min-w-[200px]">
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
                          <td className="p-3 text-right">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                              onClick={() => setItems((prev) => prev.filter((_, i) => i !== idx))}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
