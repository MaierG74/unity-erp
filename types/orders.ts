export interface OrderStatus {
  status_id: number;
  status_name: string;
}

export interface Customer {
  id: number;
  name: string;
  contact: string;
  email: string;
  telephone: string;
  // Optional fields used in some UI surfaces
  contact_person?: string | null;
  phone?: string | null;
  // Address fields
  address_line_1?: string | null;
  address_line_2?: string | null;
  city?: string | null;
  state_province?: string | null;
  postal_code?: string | null;
  country?: string | null;
  // Additional fields
  notes?: string | null;
  payment_terms?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface Product {
  product_id: number;
  internal_code: string;
  name: string;
  description: string | null;
}

import type { BomSnapshotEntry, CutlistSnapshotGroup } from '@/lib/orders/snapshot-types';

export interface OrderDetail {
  order_detail_id: number;
  order_id: number;
  product_id: number;
  quantity: number;
  unit_price: number;
  product?: Product;
  bom_snapshot?: BomSnapshotEntry[] | null;
  cutlist_material_snapshot?: CutlistSnapshotGroup[] | null;
  cutlist_primary_material_id?: number | null;
  cutlist_primary_backer_material_id?: number | null;
  cutlist_primary_edging_id?: number | null;
  cutlist_part_overrides?: unknown[] | null;
  cutlist_surcharge_kind?: 'fixed' | 'percentage';
  cutlist_surcharge_value?: number | null;
  cutlist_surcharge_label?: string | null;
  readonly cutlist_surcharge_resolved?: number | null;
  readonly surcharge_total?: number | null;
}

export type OrderDocumentType = string;

export interface OrderDocumentCategory {
  id: number;
  key: string;
  label: string;
  icon: string;
  description: string;
  sort_order: number;
  is_system: boolean;
}

export interface OrderAttachment {
  id: number;
  order_id: number;
  file_url: string;
  file_name: string;
  mime_type: string;
  uploaded_at: string;
  document_type: OrderDocumentType;
}

export interface FinishedGoodReservation {
  order_id: number;
  product_id: number;
  reserved_quantity: number;
  product_name?: string;
  product_internal_code?: string;
  available_quantity?: number | null;
  updated_at?: string | null;
}

export interface Order {
  order_id: number;
  customer_id: number;
  order_date: string;
  total_amount: number | null;
  status_id: number;
  order_number: string | null;
  created_at: string;
  updated_at: string;
  delivery_date: string | null;
  status?: OrderStatus;
  customer?: Customer;
  details?: OrderDetail[];
  attachments?: OrderAttachment[];
  /** Linked quote */
  quote?: { id: string; quote_number: string; };
  /** Optional customer-provided reference string */
  customer_reference?: string | null;
}
