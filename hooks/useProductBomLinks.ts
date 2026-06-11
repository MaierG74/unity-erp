'use client'

import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

/** Linked subcomponent row (product_bom_links + resolved product). */
export interface ProductLink {
  sub_product_id: number
  scale: number
  mode: string
  product?: { product_id: number; internal_code: string; name: string }
}

const featureAttach =
  typeof process !== 'undefined' && process.env.NEXT_PUBLIC_FEATURE_ATTACH_BOM === 'true'

/**
 * Subcomponent links for a parent product. Shared by the BOM and BOL tabs —
 * both read the same ['productBOMLinks', productId] cache entry, so the row
 * shape must stay consistent. Gated on the attach feature flag.
 */
export function useProductBomLinks(productId: number) {
  return useQuery({
    enabled: featureAttach,
    queryKey: ['productBOMLinks', productId],
    queryFn: async (): Promise<ProductLink[]> => {
      try {
        const { data: links, error: linkErr } = await supabase
          .from('product_bom_links')
          .select('sub_product_id, scale, mode')
          .eq('product_id', productId)
        if (linkErr) throw linkErr

        const ids = (links || []).map((l: any) => Number(l.sub_product_id))
        const productById: Record<number, ProductLink['product']> = {}
        if (ids.length > 0) {
          const { data: prods, error: prodErr } = await supabase
            .from('products')
            .select('product_id, internal_code, name')
            .in('product_id', ids)
          if (prodErr) throw prodErr
          for (const p of (prods || []) as any[]) productById[Number(p.product_id)] = p
        }

        return (links || []).map((l: any) => ({
          sub_product_id: Number(l.sub_product_id),
          scale: Number(l.scale ?? 1),
          mode: String(l.mode || 'phantom'),
          product: productById[Number(l.sub_product_id)],
        }))
      } catch (e) {
        console.error('Failed to load product links', e)
        throw e
      }
    },
  })
}
