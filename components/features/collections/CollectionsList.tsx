'use client'

/**
 * CollectionsList Component
 *
 * REFACTORED: Removed internal search input and "New Collection" button.
 * These controls are now in PageToolbar at the page level.
 * - Accepts searchQuery prop from parent
 * - Client-side filtering when searchQuery changes
 * - Removed internal space-y-6 wrapper since toolbar handles spacing
 */

import { useEffect, useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

type CollectionRow = {
  collection_id: number
  code: string
  name: string
  status: 'draft' | 'published' | 'archived'
  version: number
  updated_at: string
}

interface CollectionsListProps {
  /** Search query from PageToolbar - filters collections by code/name */
  searchQuery?: string
}

export default function CollectionsList({ searchQuery = '' }: CollectionsListProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [rows, setRows] = useState<CollectionRow[]>([])

  // Fetch all collections on mount
  const load = async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/collections`, { cache: 'no-store' })
      const json = await res.json()
      setRows(json.collections || [])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  // Client-side filtering based on searchQuery prop
  const filteredRows = useMemo(() => {
    if (!searchQuery.trim()) return rows
    const query = searchQuery.toLowerCase()
    return rows.filter(
      (r) =>
        r.code.toLowerCase().includes(query) ||
        r.name.toLowerCase().includes(query)
    )
  }, [rows, searchQuery])

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'published': return 'default' // primary
      case 'draft': return 'secondary'
      case 'archived': return 'outline'
      default: return 'secondary'
    }
  }

  return (
    // CHANGED: Removed outer space-y-6 wrapper and search/button row
    // The PageToolbar now handles the search and action button
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
              {loading ? (
                <tr>
                  <td className="p-8 text-center text-muted-foreground" colSpan={5}>
                    Loading collections…
                  </td>
                </tr>
              ) : filteredRows.length === 0 ? (
                <tr>
                  <td className="p-8 text-center text-muted-foreground" colSpan={5}>
                    {searchQuery ? 'No collections match your search.' : 'No collections found'}
                  </td>
                </tr>
              ) : (
                filteredRows.map((r) => (
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
  )
}
