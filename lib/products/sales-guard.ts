import type { SupabaseClient } from '@supabase/supabase-js'

export const PRODUCT_NOT_SELLABLE_ERROR = 'Internal subcomponents cannot be sold directly'
export const PRODUCT_NOT_SELLABLE_CODE = 'product_not_sellable'

type SalesGuardClient = Pick<SupabaseClient<any, any, any>, 'from'>

type ProductKindRow = {
  product_id: number | string | null
  product_kind: string | null
}

export async function assertProductsSellable(
  client: SalesGuardClient,
  orgId: string,
  productIds: number[],
): Promise<{ ok: true } | { ok: false; offendingIds: number[] }> {
  const uniqueIds = Array.from(
    new Set(productIds.filter((id) => Number.isFinite(id) && id > 0)),
  )

  if (uniqueIds.length === 0) {
    return { ok: true }
  }

  const { data, error } = await client
    .from('products')
    .select('product_id, product_kind')
    .eq('org_id', orgId)
    .in('product_id', uniqueIds)

  if (error) {
    throw error
  }

  const offendingIds = ((data ?? []) as ProductKindRow[])
    .filter((row) => row.product_kind === 'internal_subcomponent')
    .map((row) => Number(row.product_id))
    .filter((id) => Number.isFinite(id))

  return offendingIds.length > 0
    ? { ok: false, offendingIds }
    : { ok: true }
}
