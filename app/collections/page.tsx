'use client'

import CollectionsList from '@/components/features/collections/CollectionsList'

export default function CollectionsPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Collections</h1>
      <CollectionsList />
    </div>
  )
}

