'use client'

/**
 * Collections Page
 *
 * REFACTORED: Uses PageToolbar for compact header layout.
 * - Removed separate h1 title (now in PageToolbar)
 * - Search and "New Collection" button moved to toolbar
 * - Reduced vertical spacing for more data visibility
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { PageToolbar } from '@/components/ui/page-toolbar'
import CollectionsList from '@/components/features/collections/CollectionsList'
import { Plus } from 'lucide-react'

export default function CollectionsPage() {
  const router = useRouter()
  // Search state lifted to page level for PageToolbar integration
  const [searchQuery, setSearchQuery] = useState('')

  return (
    // CHANGED: Reduced space-y from 6 to 2 for tighter layout
    <div className="space-y-2">
      {/* NEW: PageToolbar replaces separate h1, search input, and button */}
      <PageToolbar
        title="Collections"
        searchPlaceholder="Search collections..."
        searchValue={searchQuery}
        onSearchChange={setSearchQuery}
        actions={[
          {
            label: 'New Collection',
            onClick: () => router.push('/collections/new'),
            icon: <Plus className="h-4 w-4" />,
          },
        ]}
      />

      {/* CHANGED: CollectionsList now receives search from toolbar */}
      <CollectionsList searchQuery={searchQuery} />
    </div>
  )
}
