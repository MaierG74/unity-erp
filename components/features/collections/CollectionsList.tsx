'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

type CollectionRow = {
  collection_id: number
  code: string
  name: string
  status: string
  version: number
  updated_at: string
}

export default function CollectionsList() {
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(false)
  const [rows, setRows] = useState<CollectionRow[]>([])

  const load = async (search?: string) => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (search) params.set('q', search)
      const res = await fetch(`/api/collections?${params.toString()}`, { cache: 'no-store' })
      const json = await res.json()
      setRows(json.collections || [])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex gap-2 items-center">
          <Input
            placeholder="Search collections..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="w-64"
          />
          <Button variant="outline" onClick={() => load(q)} disabled={loading}>
            Search
          </Button>
        </div>
        <Link href="/collections/new">
          <Button>New Collection</Button>
        </Link>
      </div>

      <div className="rounded-md border">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left">
              <th className="p-3">Code</th>
              <th className="p-3">Name</th>
              <th className="p-3">Status</th>
              <th className="p-3">Version</th>
              <th className="p-3">Updated</th>
              <th className="p-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td className="p-4 text-muted-foreground" colSpan={6}>
                  {loading ? 'Loading…' : 'No collections found'}
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.collection_id} className="border-t">
                  <td className="p-3 font-mono">{r.code}</td>
                  <td className="p-3">{r.name}</td>
                  <td className="p-3">{r.status}</td>
                  <td className="p-3">{r.version}</td>
                  <td className="p-3">{new Date(r.updated_at).toLocaleString()}</td>
                  <td className="p-3">
                    <Link href={`/collections/${r.collection_id}`} className="underline">
                      Edit
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

