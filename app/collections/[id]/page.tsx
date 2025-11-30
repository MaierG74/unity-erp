'use client'

import { useParams } from 'next/navigation'
import CollectionEditor from '@/components/features/collections/CollectionEditor'

export default function CollectionEditPage() {
  const params = useParams<{ id: string }>()
  const raw = params?.id
  const id = raw === 'new' ? undefined : Number(raw)
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{id ? 'Edit Collection' : 'New Collection'}</h1>
      <CollectionEditor id={id} />
    </div>
  )
}

