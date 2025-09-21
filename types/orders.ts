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
}

export interface Product {
  product_id: number;
  internal_code: string;
  name: string;
  description: string | null;
}

export interface OrderDetail {
  order_detail_id: number;
  order_id: number;
  product_id: number;
  quantity: number;
  unit_price: number;
  product?: Product;
}

export interface OrderAttachment {
  id: number;
  order_id: number;
  file_url: string;
  file_name: string;
  uploaded_at: string;
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