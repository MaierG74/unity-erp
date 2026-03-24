export type ViewConfig = {
  dateRange: {
    from: string | null;
    to: string | null;
    preset: string | null;
  };
  groupBy: 'none' | 'component' | 'supplier' | 'supplier_component' | 'period_week' | 'period_month';
  filters: {
    search: string;
    transactionTypeId: string;
    supplierId: string;
    categoryId: string;
    productId: string;
    componentIds: string[];
  };
};

export type SavedView = {
  view_id: string;
  org_id: string;
  user_id: string;
  table_key: string;
  name: string;
  config: ViewConfig;
  is_shared: boolean;
  is_default: boolean;
  created_at: string;
  updated_at: string;
};

export type EnrichedTransaction = {
  transaction_id: number;
  component_id: number;
  quantity: number;
  transaction_date: string;
  order_id: number | null;
  purchase_order_id: number | null;
  user_id: string | null;
  reason: string | null;
  component: {
    component_id: number;
    internal_code: string;
    description: string | null;
    category: {
      cat_id: number;
      categoryname: string;
    } | null;
  };
  transaction_type: {
    transaction_type_id: number;
    type_name: string;
  } | null;
  purchase_order: {
    purchase_order_id: number;
    q_number: string;
    supplier: {
      supplier_id: number;
      name: string;
    } | null;
  } | null;
  order: {
    order_id: number;
    order_number: string;
  } | null;
};

export type ComponentStockSummary = {
  component_id: number;
  quantityOnHand: number;
  reserved: number;
  onOrder: number;
};

export type TransactionGroup = {
  key: string;
  label: string;
  sumIn: number;
  sumOut: number;
  count: number;
  stockSummary?: ComponentStockSummary;
};

export const DEFAULT_VIEW_CONFIG: ViewConfig = {
  dateRange: { from: null, to: null, preset: 'last30' },
  groupBy: 'none',
  filters: {
    search: '',
    transactionTypeId: 'all',
    supplierId: 'all',
    categoryId: 'all',
    productId: 'all',
    componentIds: [],
  },
};

export const DATE_PRESETS = [
  { label: 'This Week', value: 'thisWeek', days: 7 },
  { label: 'This Month', value: 'thisMonth', days: 30 },
  { label: 'Last 30 Days', value: 'last30', days: 30 },
  { label: 'This Quarter', value: 'thisQuarter', days: 90 },
  { label: 'Year to Date', value: 'ytd', days: 365 },
] as const;
