import { SupplierComponent } from "./suppliers";

// Define Component type based on what's in the InventoryItem
export type Component = {
  component_id: number;
  internal_code: string;
  description: string | null;
  unit_id: number | null;
  category_id: number | null;
  image_url: string | null;
};

export type SupplierOrderStatus = {
  status_id: number;
  status_name: string;
};

export type TransactionType = {
  transaction_type_id: number;
  type_name: string;
};

export type SupplierOrder = {
  order_id: number;
  supplier_component_id: number;
  order_quantity: number;
  order_date: string;
  status_id: number;
  total_received: number;
};

export type SupplierOrderReceipt = {
  receipt_id: number;
  order_id: number;
  transaction_id: number;
  quantity_received: number;
  receipt_date: string;
};

export type InventoryTransaction = {
  transaction_id: number;
  component_id: number;
  quantity: number;
  transaction_type_id: number;
  transaction_date: string;
  order_id: number | null;
};

// Extended types with joined data
export type SupplierOrderWithDetails = SupplierOrder & {
  status: SupplierOrderStatus;
  supplierComponent: SupplierComponent & {
    component: Component;
    supplier: {
      supplier_id: number;
      name: string;
    };
  };
  receipts?: SupplierOrderReceipt[];
};

// Form schema types for Zod validation
export type NewSupplierOrderFormValues = {
  supplier_component_id: number;
  order_quantity: number;
  order_date?: string;
};

export type ReceiveItemsFormValues = {
  quantity_received: number;
  receipt_date?: string;
}; 