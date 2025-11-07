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