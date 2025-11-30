'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Plus, Search } from 'lucide-react'

type CollectionRow = {
  collection_id: number
  code: string
  name: string
  status: 'draft' | 'published' | 'archived'
  version: number
  updated_at: string
}

export default function CollectionsList() {
  const router = useRouter()
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

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'published': return 'default' // primary
      case 'draft': return 'secondary'
      case 'archived': return 'outline'
      default: return 'secondary'
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="relative w-72">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search collections..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && load(q)}
            className="pl-8"
          />
        </div>
        <Link href="/collections/new">
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            New Collection
          </Button>
        </Link>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg font-medium">All Collections</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr className="text-left">
                  <th className="p-3 font-medium text-muted-foreground">Code</th>
                  <th className="p-3 font-medium text-muted-foreground">Name</th>
                  <th className="p-3 font-medium text-muted-foreground">Status</th>
                  <th className="p-3 font-medium text-muted-foreground">Version</th>
                  <th className="p-3 font-medium text-muted-foreground">Updated</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td className="p-8 text-center text-muted-foreground" colSpan={5}>
                      {loading ? 'Loading collections…' : 'No collections found'}
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => (
                    <tr
                      key={r.collection_id}
                      className="border-t hover:bg-muted/50 transition-colors cursor-pointer"
                      onClick={() => router.push(`/collections/${r.collection_id}`)}
                    >
                      <td className="p-3 font-mono font-medium">{r.code}</td>
                      <td className="p-3">{r.name}</td>
                      <td className="p-3">
                        <Badge variant={getStatusColor(r.status) as any}>
                          {r.status}
                        </Badge>
                      </td>
                      <td className="p-3 text-muted-foreground">v{r.version}</td>
                      <td className="p-3 text-muted-foreground">{new Date(r.updated_at).toLocaleDateString()}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

