export type Supplier = {
  supplier_id: number;
  name: string;
  contact_info: string | null;
};

export type SupplierEmail = {
  email_id: number;
  supplier_id: number;
  email: string;
  is_primary: boolean;
};

export type SupplierPricelist = {
  pricelist_id: number;
  supplier_id: number;
  file_name: string;
  display_name: string;
  file_url: string;
  file_type: string;
  uploaded_at: string;
};

export type SupplierComponent = {
  supplier_component_id: number;
  component_id: number;
  supplier_id: number;
  supplier_code: string;
  price: number;
  lead_time: number | null;
  min_order_quantity: number | null;
};

// Extended type that includes related data
export type SupplierWithDetails = Supplier & {
  emails: SupplierEmail[];
  components?: (SupplierComponent & {
    component: {
      internal_code: string;
      description: string;
    };
  })[];
  pricelists: SupplierPricelist[];
};

// Purchase order types for supplier views
export type SupplierPurchaseOrder = {
  purchase_order_id: number;
  q_number: string | null;
  order_date: string;
  created_at: string;
  notes: string | null;
  status: { status_name: string };
  supplier_orders: SupplierOrderLineItem[];
};

export type SupplierOrderLineItem = {
  order_id: number;
  order_quantity: number;
  total_received: number;
  supplier_component: {
    supplier_component_id: number;
    supplier_code: string;
    price: number;
    lead_time: number | null;
    component: {
      component_id: number;
      internal_code: string;
      description: string;
    };
  };
  receipts: Array<{
    receipt_date: string;
    quantity_received: number;
  }>;
};

export type SupplierStatistics = {
  totalOrders: number;
  totalValue: number;
  outstandingOrders: number;
  outstandingValue: number;
  averageLeadTime: number | null;
  onTimeDeliveryRate: number | null;
  uniqueComponents: number;
  ordersByStatus: Record<string, number>;
}; 