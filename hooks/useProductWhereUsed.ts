'use client'

import { useQuery } from '@tanstack/react-query'
import { authorizedFetch } from '@/lib/client/auth-fetch'

export interface WhereUsedParent {
  product_id: number
  internal_code: string | null
  name: string | null
  scale: number
}

export interface WhereUsedResult {
  count: number
  parents: WhereUsedParent[]
}

/**
 * Parent products that use this product as a subcomponent.
 * Consumed by the product-page banner and the BOM/BOL/cutlist edit notices.
 */
export function useProductWhereUsed(productId: number) {
  return useQuery({
    queryKey: ['productWhereUsed', productId],
    enabled: Number.isFinite(productId) && productId > 0,
    queryFn: async (): Promise<WhereUsedResult> => {
      const res = await authorizedFetch(`/api/products/${productId}/where-used`, {
        cache: 'no-store',
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body?.error ?? `Failed to load where-used (${res.status})`)
      }
      return (await res.json()) as WhereUsedResult
    },
  })
}
