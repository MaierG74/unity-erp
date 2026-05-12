'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { authorizedFetch } from '@/lib/client/auth-fetch'
import { useToast } from '@/components/ui/use-toast'

export type MarkupType = 'percentage' | 'fixed'

export interface ProductPrice {
  id: string
  product_id: number
  price_list_id: string
  markup_type: MarkupType
  markup_value: number
  selling_price: number
}

export const productPricingKey = (productId: number) =>
  ['product-price', productId] as const

export function useProductPricing(productId: number) {
  const queryClient = useQueryClient()
  const { toast } = useToast()

  const {
    data: price,
    isLoading,
  } = useQuery({
    queryKey: productPricingKey(productId),
    enabled: Number.isFinite(productId) && productId > 0,
    staleTime: 0,
    refetchOnMount: 'always',
    queryFn: async () => {
      const res = await authorizedFetch(`/api/products/${productId}/pricing`, {
        cache: 'no-store',
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body?.error ?? `Failed to load pricing (${res.status})`)
      }
      const data = (await res.json()) as { price: ProductPrice | null }
      return data.price
    },
  })

  // Upsert price
  const saveMutation = useMutation({
    mutationFn: async (input: {
      markupType: MarkupType
      markupValue: number
      sellingPrice: number
    }) => {
      const res = await authorizedFetch(`/api/products/${productId}/pricing`, {
        method: 'PUT',
        body: JSON.stringify(input),
      })

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body?.error ?? `Failed to save pricing (${res.status})`)
      }

      const data = (await res.json()) as { price: ProductPrice }
      return data.price
    },
    onSuccess: (savedPrice) => {
      queryClient.setQueryData(productPricingKey(productId), savedPrice)
      queryClient.invalidateQueries({ queryKey: productPricingKey(productId) })
      toast({
        title: 'Price saved',
        description: 'Standard pricing has been updated.',
      })
    },
    onError: (error) => {
      console.error('Failed to save price:', error)
      toast({
        title: 'Save failed',
        description: 'Could not save pricing. Please try again.',
        variant: 'destructive',
      })
    },
  })

  return {
    price,
    isLoading,
    isSaving: saveMutation.isPending,
    savePrice: saveMutation.mutate,
  }
}
