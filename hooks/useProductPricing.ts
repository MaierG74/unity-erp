'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/components/common/auth-provider'
import { getOrgId } from '@/lib/utils'
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

export function useProductPricing(productId: number) {
  const { user } = useAuth()
  const orgId = getOrgId(user)
  const queryClient = useQueryClient()
  const { toast } = useToast()

  // Fetch the default price list ID for this org
  const { data: defaultListId } = useQuery({
    queryKey: ['default-price-list', orgId],
    enabled: !!orgId,
    staleTime: Infinity,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('product_price_lists')
        .select('id')
        .eq('org_id', orgId!)
        .eq('is_default', true)
        .single()
      if (error) throw error
      return data.id as string
    },
  })

  // Fetch existing price for this product + default list
  const {
    data: price,
    isLoading,
  } = useQuery({
    queryKey: ['product-price', productId, defaultListId],
    enabled: !!defaultListId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('product_prices')
        .select('id, product_id, price_list_id, markup_type, markup_value, selling_price')
        .eq('product_id', productId)
        .eq('price_list_id', defaultListId!)
        .maybeSingle()
      if (error) throw error
      return data as ProductPrice | null
    },
  })

  // Upsert price
  const saveMutation = useMutation({
    mutationFn: async (input: {
      markupType: MarkupType
      markupValue: number
      sellingPrice: number
    }) => {
      if (!orgId || !defaultListId) throw new Error('Missing org or price list')

      const payload = {
        org_id: orgId,
        product_id: productId,
        price_list_id: defaultListId,
        markup_type: input.markupType,
        markup_value: input.markupValue,
        selling_price: input.sellingPrice,
        updated_at: new Date().toISOString(),
      }

      if (price?.id) {
        // Update existing
        const { data, error } = await supabase
          .from('product_prices')
          .update(payload)
          .eq('id', price.id)
          .select()
          .single()
        if (error) throw error
        return data
      } else {
        // Insert new
        const { data, error } = await supabase
          .from('product_prices')
          .insert(payload)
          .select()
          .single()
        if (error) throw error
        return data
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['product-price', productId, defaultListId] })
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
