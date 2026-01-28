export interface CustomerContact {
  id: number;
  customer_id: number;
  name: string;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  job_title: string | null;
  is_primary: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateCustomerContactData {
  customer_id: number;
  name: string;
  email?: string | null;
  phone?: string | null;
  mobile?: string | null;
  job_title?: string | null;
  is_primary?: boolean;
}

export interface UpdateCustomerContactData {
  name?: string;
  email?: string | null;
  phone?: string | null;
  mobile?: string | null;
  job_title?: string | null;
  is_primary?: boolean;
}
