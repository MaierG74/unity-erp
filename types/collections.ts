export type BomCollection = {
  collection_id: number
  code: string
  name: string
  description?: string | null
  is_phantom: boolean
  version: number
  status: 'draft' | 'published' | 'archived'
  created_at: string
  updated_at: string
}

export type BomCollectionItemInput = {
  component_id: number
  quantity_required: number
  supplier_component_id?: number | null
}

