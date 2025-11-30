'use client'

import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export default function AddFromCollectionDialog({ productId, onApplied }: { productId: number; onApplied?: () => void }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(false)
  const [rows, setRows] = useState<any[]>([])
  const [selected, setSelected] = useState<number | null>(null)
  const [scale, setScale] = useState<number>(1)
  const [itemsPreview, setItemsPreview] = useState<any[] | null>(null)

  const load = async (query?: string) => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (query) params.set('q', query)
      const res = await fetch(`/api/collections?${params.toString()}`, { cache: 'no-store' })
      const json = await res.json()
      setRows(json.collections || [])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { if (open) load() }, [open])

  const openPreview = async (id: number) => {
    setSelected(id)
    const res = await fetch(`/api/collections/${id}`, { cache: 'no-store' })
    const json = await res.json()
    setItemsPreview(json.items || [])
  }

  const apply = async () => {
    if (!selected) return
    setLoading(true)
    try {
      const res = await fetch(`/api/products/${productId}/bom/apply-collection`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ collection_id: selected, scale }),
      })
      if (!res.ok) throw new Error('Apply failed')
      setOpen(false)
      setSelected(null)
      setItemsPreview(null)
      onApplied?.()
    } catch (e) {
      console.error(e)
      alert('Failed to apply collection')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>Add From Collection</Button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div className="relative bg-background border rounded-md shadow-xl w-[800px] max-h-[80vh] overflow-auto p-4 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Add From Collection</h2>
              <Button variant="ghost" onClick={() => setOpen(false)}>Close</Button>
            </div>
            <div className="flex items-center gap-2">
              <Input placeholder="Search collections..." value={q} onChange={(e) => setQ(e.target.value)} className="w-64" />
              <Button variant="outline" onClick={() => load(q)} disabled={loading}>Search</Button>
              <div className="ml-auto flex items-center gap-2">
                <span className="text-sm">Scale</span>
                <Input type="number" className="w-28" step="0.01" min="0.0001" value={scale} onChange={(e) => setScale(Math.max(0.0001, Number(e.target.value)))} />
                <Button onClick={apply} disabled={!selected || loading}>Apply</Button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="rounded-md border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left">
                      <th className="p-3">Code</th>
                      <th className="p-3">Name</th>
                      <th className="p-3">v</th>
                      <th className="p-3">Status</th>
                      <th className="p-3">Select</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length === 0 ? (
                      <tr><td className="p-4 text-muted-foreground" colSpan={5}>{loading ? 'Loading…' : 'No results'}</td></tr>
                    ) : rows.map((r) => (
                      <tr key={r.collection_id} className={`border-t ${selected === r.collection_id ? 'bg-accent' : ''}`}>
                        <td className="p-3 font-mono">{r.code}</td>
                        <td className="p-3">{r.name}</td>
                        <td className="p-3">{r.version}</td>
                        <td className="p-3">{r.status}</td>
                        <td className="p-3"><Button size="sm" variant="outline" onClick={() => openPreview(r.collection_id)}>Preview</Button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="rounded-md border p-3">
                <div className="font-medium mb-2">Preview</div>
                {!itemsPreview ? (
                  <div className="text-sm text-muted-foreground">Select a collection to preview.</div>
                ) : itemsPreview.length === 0 ? (
                  <div className="text-sm text-muted-foreground">This collection has no items.</div>
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
                          <td className="p-2">
                            {it.components?.internal_code || it.component_id}
                          </td>
                          <td className="p-2 text-muted-foreground">
                            {it.components?.description || ''}
                          </td>
                          <td className="p-2">
                            {(Number(it.quantity_required) * Number(scale || 1)).toString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
