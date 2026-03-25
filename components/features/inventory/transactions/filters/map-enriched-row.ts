import type { EnrichedTransaction } from '@/types/transaction-views';

/** Shape of a row from the inventory_transactions_enriched view */
export type FlatTransactionRow = {
  transaction_id: number;
  component_id: number;
  quantity: number;
  transaction_date: string;
  order_id: number | null;
  purchase_order_id: number | null;
  user_id: string | null;
  reason: string | null;
  org_id: string;
  transaction_type_id: number | null;
  component_code: string | null;
  component_description: string | null;
  category_id: number | null;
  category_name: string | null;
  transaction_type_name: string | null;
  po_number: string | null;
  supplier_id: number | null;
  supplier_name: string | null;
  order_number: string | null;
};

/** Convert a flat view row into the nested EnrichedTransaction shape */
export function mapFlatToEnriched(row: FlatTransactionRow): EnrichedTransaction {
  return {
    transaction_id: row.transaction_id,
    component_id: row.component_id,
    quantity: row.quantity,
    transaction_date: row.transaction_date,
    order_id: row.order_id,
    purchase_order_id: row.purchase_order_id,
    user_id: row.user_id,
    reason: row.reason,
    component: {
      component_id: row.component_id,
      internal_code: row.component_code ?? '',
      description: row.component_description ?? null,
      category: row.category_id != null
        ? { cat_id: row.category_id, categoryname: row.category_name ?? '' }
        : null,
    },
    transaction_type: row.transaction_type_id != null
      ? { transaction_type_id: row.transaction_type_id, type_name: row.transaction_type_name ?? '' }
      : null,
    purchase_order: row.purchase_order_id != null
      ? {
          purchase_order_id: row.purchase_order_id,
          q_number: row.po_number ?? '',
          supplier: row.supplier_id != null
            ? { supplier_id: row.supplier_id, name: row.supplier_name ?? '' }
            : null,
        }
      : null,
    order: row.order_id != null
      ? { order_id: row.order_id, order_number: row.order_number ?? '' }
      : null,
  };
}
