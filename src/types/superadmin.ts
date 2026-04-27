export interface Tenant {
  id: string;
  name: string;
  aitan_codes: string[];
  trial_ends_at: string | null;
  is_demo: boolean;
  created_at: string;
  updated_at: string;
}

export interface TenantMembership {
  id: string;
  tenant_id: string;
  user_id: string;
  role: 'owner' | 'member' | 'admin';
  created_at: string;
}

export interface Profile {
  id: string;
  email: string;
  full_name: string;
  default_dashboard: string;
  signup_status: 'pending' | 'approved' | 'rejected' | null;
  signup_requested_at: string | null;
  signup_reviewed_at: string | null;
  signup_reviewed_by: string | null;
  signup_rejection_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserRole {
  id: string;
  user_id: string;
  role: 'user' | 'admin' | 'superadmin';
  created_at: string;
}

export interface Order {
  id: string;
  tenant_id: string;
  user_id: string;
  order_number: string;
  name: string;
  charge_amount: number;
  payment_status: string;
  paid: boolean;
  cost_allocated: boolean;
  customer_id: string;
  created_at: string;
}

export interface UnifiedTicket {
  id: string;
  tenant_id: string;
  user_id: string;
  order_id: string;
  ticket_number: string;
  passenger_name: string;
  amount: number;
  cost: number;
  status: string;
  source_type?: string;
  created_at: string;
}

export interface Invoice {
  id: string;
  tenant_id: string;
  order_id: string;
  total: number;
  amount_paid?: number;
  balance_due?: number;
  status: string;
  due_date: string;
}

export interface Todo {
  id: string;
  tenant_id: string;
  user_id: string;
  order_id: string;
  title: string;
  completed: boolean;
  due_date: string;
}

export interface ParsedAirfile {
  id: string;
  tenant_id: string;
  user_id: string;
  pnr: string;
  raw_text: string;
  parsed_result: unknown;
  success: boolean;
  status: 'pending_linking' | 'linked' | 'ignore';
  read: boolean;
  import_item_id: string;
  created_at: string;
}

export interface PortalUser {
  id: string;
  tenant_id: string;
  customer_id: string;
  email: string;
  is_active: boolean;
  last_login_at: string;
}

export interface OrderHistory {
  id: string;
  tenant_id: string;
  user_id: string;
  order_id: string;
  action_type: string;
  description: string;
  created_at: string;
}
