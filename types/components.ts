export interface SupplierInfo {
  supplier_id: number;
  name: string;
  contact_person: string;
  emails: string[];
  phone: string;
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

export interface ComponentRequirement {
  component_id: number;
  internal_code: string;
  description: string;
  total_required: number;
  order_breakdown: OrderBreakdown[];
  in_stock: number;
  on_order: number;
  on_order_breakdown: SupplierOrderBreakdown[];
  apparent_shortfall: number;
  real_shortfall: number;
  // Global requirements data across all orders
  total_required_all_orders: number;
  order_count: number;
  global_apparent_shortfall: number;
  global_real_shortfall: number;
  supplier_options: Array<{
    supplier: SupplierInfo;
    price: number;
    supplier_component_id: number;
    unit_cost?: number;
    moq?: number;
    lead_time_days?: number;
    notes?: string;
  }>;
  selected_supplier: {
    supplier: SupplierInfo;
    price: number;
    supplier_component_id: number;
    unit_cost?: number;
    moq?: number;
    lead_time_days?: number;
    notes?: string;
  } | null;
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