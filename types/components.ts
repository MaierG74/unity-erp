export interface SupplierInfo {
  supplier_id: number;
  name: string;
  contact_person: string;
  emails: string[];
  phone: string;
}

export interface SupplierOption {
  supplier: SupplierInfo;
  price: number;
  supplier_component_id: number;
  unit_cost?: number;
  moq?: number;
  lead_time_days?: number;
  notes?: string;
}

export interface OrderBreakdown {
  order_id: number;
  quantity: number;
  order_date: string;
  status: string;
}

export interface SupplierOrderBreakdown {
  supplier_order_id: number;
  supplier_name: string;
  quantity: number;
  received: number;
  status: string;
  order_date: string;
}

export interface ComponentHistoryEntry {
  component_id: number;
  supplier_order_id: number;
  supplier_name: string;
  order_date: string;
  order_quantity: number;
  quantity_for_order: number;
  quantity_for_stock: number;
  total_received: number;
  status_name: string;
}

export interface ComponentRequirement {
  component_id: number;
  internal_code: string;
  description: string;
  quantity_required: number;
  quantity_in_stock: number;
  quantity_on_order: number;
  apparent_shortfall: number;
  real_shortfall: number;
  order_breakdown: OrderBreakdown[];
  on_order_breakdown: SupplierOrderBreakdown[];
  history: ComponentHistoryEntry[];
  total_required_all_orders: number;
  order_count: number;
  global_apparent_shortfall: number;
  global_real_shortfall: number;
  supplier_options: SupplierOption[];
  selected_supplier: SupplierOption | null;
}

export interface ProductRequirement {
  order_detail_id: number;
  product_id: number;
  product_name: string;
  order_quantity: number;
  components: ComponentRequirement[];
  error?: string;
}

export interface OrderComponentsDialogProps {
  orderId: number;
  onSuccess?: () => void;
}
