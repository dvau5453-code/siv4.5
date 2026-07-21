export type UserRole =
  | 'super_admin'
  | 'manager'
  | 'sales_executive'
  | 'inventory_manager'
  | 'accountant'
  | 'delivery_staff'
  | 'customer_portal'
  | 'store_customer';

export interface Profile {
  id: string;
  tenant_id: string;
  full_name: string;
  email: string;
  role: UserRole;
  avatar_url?: string;
  phone?: string;
  department?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Category {
  id: string;
  name: string;
  slug: string;
  description?: string;
  parent_id?: string;
  image_url?: string;
  sort_order: number;
  is_active: boolean;
  created_at: string;
}

export interface Brand {
  id: string;
  name: string;
  slug: string;
  logo_url?: string;
  description?: string;
  country_of_origin?: string;
  is_active: boolean;
  created_at: string;
}

export interface Product {
  id: string;
  sku: string;
  barcode?: string;
  name: string;
  description?: string;
  category_id?: string;
  brand_id?: string;
  unit: string;
  base_unit?: string;
  enable_multi_unit?: boolean;
  enable_colors?: boolean;
  enable_sizes?: boolean;
  cost_price: number;
  sale_price: number;
  mrp?: number;
  tax_rate: number;
  min_stock_level: number;
  max_stock_level?: number;
  image_url?: string;
  images?: string[];
  is_active: boolean;
  is_online: boolean;
  warranty_months: number;
  created_at: string;
  updated_at: string;
  category?: Category;
  brand?: Brand;
  inventory_items?: InventoryItem[];
  colors?: ProductColor[];
  sizes?: ProductSize[];
  units?: ProductUnit[];
}

export interface ProductColor {
  id: string;
  product_id: string;
  name: string;
  hex_code?: string;
  image_url?: string;
  is_default: boolean;
  sort_order: number;
  created_at: string;
}

export interface ProductSize {
  id: string;
  product_id: string;
  name: string;
  dimensions?: string;
  is_default: boolean;
  sort_order: number;
  created_at: string;
}

export interface ProductUnit {
  id: string;
  product_id: string;
  unit_name: string;
  unit_short?: string;
  conversion_factor: number;
  is_base_unit: boolean;
  is_sale_unit: boolean;
  price: number;
  cost_price: number;
  barcode?: string;
  sort_order: number;
  is_active: boolean;
  created_at: string;
}

export interface Warehouse {
  id: string;
  name: string;
  code: string;
  address?: string;
  city?: string;
  is_default: boolean;
  is_active: boolean;
  created_at: string;
}

export interface InventoryItem {
  id: string;
  product_id: string;
  warehouse_id: string;
  quantity_on_hand: number;
  quantity_reserved: number;
  quantity_incoming: number;
  created_at: string;
  updated_at: string;
  product?: Product;
  warehouse?: Warehouse;
}

export interface Supplier {
  id: string;
  code: string;
  name: string;
  company_name?: string;
  email?: string;
  phone?: string;
  mobile?: string;
  address?: string;
  city?: string;
  country: string;
  credit_limit: number;
  credit_days: number;
  outstanding_balance: number;
  total_purchases: number;
  rating?: number;
  notes?: string;
  is_active: boolean;
  created_at: string;
}

export type CustomerType =
  | 'retail'
  | 'contractor'
  | 'builder'
  | 'architect'
  | 'interior_designer'
  | 'corporate'
  | 'government';

export interface Customer {
  id: string;
  code: string;
  name: string;
  type: CustomerType;
  company_name?: string;
  email?: string;
  phone?: string;
  mobile?: string;
  address?: string;
  city?: string;
  country: string;
  credit_limit: number;
  credit_days: number;
  outstanding_balance: number;
  total_purchases: number;
  loyalty_points: number;
  discount_percent: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export type QuotationStatus =
  | 'draft'
  | 'sent'
  | 'viewed'
  | 'accepted'
  | 'rejected'
  | 'expired'
  | 'converted';

export interface Quotation {
  id: string;
  quote_number: string;
  customer_id: string;
  status: QuotationStatus;
  issue_date: string;
  expiry_date?: string;
  subtotal: number;
  discount_amount: number;
  tax_amount: number;
  total_amount: number;
  notes?: string;
  reference?: string;
  created_at: string;
  updated_at: string;
  customer?: Customer;
}

export type InvoiceStatus =
  | 'draft'
  | 'sent'
  | 'partially_paid'
  | 'paid'
  | 'overdue'
  | 'cancelled'
  | 'refunded'
  | 'refundable';

export interface Invoice {
  id: string;
  invoice_number: string;
  customer_id: string;
  quotation_id?: string;
  status: InvoiceStatus;
  invoice_date: string;
  due_date?: string;
  subtotal: number;
  discount_amount: number;
  tax_amount: number;
  total_amount: number;
  amount_paid: number;
  balance_due: number;
  is_pos: boolean;
  edit_count?: number;
  reference?: string;
  created_at: string;
  updated_at: string;
  customer?: Customer;
}

export interface InvoiceEditHistory {
  id: string;
  invoice_id: string;
  invoice_number: string;
  edited_by?: string;
  edited_by_name?: string;
  edited_at: string;
  change_type: string;
  field_changed?: string;
  old_value?: Record<string, unknown>;
  new_value?: Record<string, unknown>;
  reason?: string;
  snapshot_before?: Record<string, unknown>;
  snapshot_after?: Record<string, unknown>;
  created_at: string;
}

export interface InvoiceItem {
  id: string;
  invoice_id: string;
  product_id: string;
  quantity: number;
  unit_price: number;
  discount_percent: number;
  tax_rate: number;
  subtotal: number;
  unit_name?: string;
  unit_conversion_factor?: number;
  base_quantity?: number;
  product?: Product;
}

export type PurchaseOrderStatus =
  | 'draft'
  | 'pending_approval'
  | 'approved'
  | 'partially_received'
  | 'received'
  | 'cancelled';

export interface PurchaseOrder {
  id: string;
  po_number: string;
  supplier_id: string;
  status: PurchaseOrderStatus;
  order_date: string;
  expected_date?: string;
  subtotal: number;
  discount_amount: number;
  tax_amount: number;
  shipping_cost: number;
  total_amount: number;
  amount_paid: number;
  created_at: string;
  updated_at: string;
  supplier?: Supplier;
}

export type ProjectStatus =
  | 'planning'
  | 'active'
  | 'on_hold'
  | 'completed'
  | 'cancelled';

export interface Project {
  id: string;
  project_number: string;
  name: string;
  customer_id?: string;
  status: ProjectStatus;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  start_date?: string;
  end_date?: string;
  estimated_budget?: number;
  actual_cost: number;
  revenue: number;
  progress_percent: number;
  description?: string;
  location?: string;
  image_url?: string;
  created_at: string;
  updated_at: string;
  customer?: Customer;
}

export type DeliveryStatus =
  | 'pending'
  | 'assigned'
  | 'in_transit'
  | 'delivered'
  | 'failed'
  | 'returned';

export interface Delivery {
  id: string;
  delivery_number: string;
  invoice_id?: string;
  customer_id: string;
  status: DeliveryStatus;
  delivery_date?: string;
  delivered_at?: string;
  delivery_address?: string;
  delivery_city?: string;
  vehicle_number?: string;
  created_at: string;
  updated_at: string;
  customer?: Customer;
}

export interface Account {
  id: string;
  code: string;
  name: string;
  account_type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
  parent_id?: string;
  is_cash: boolean;
  is_bank: boolean;
  bank_name?: string;
  account_number?: string;
  balance: number;
  is_active: boolean;
  created_at: string;
}

export interface Employee {
  id: string;
  employee_id: string;
  full_name: string;
  email?: string;
  phone?: string;
  designation: string;
  department: string;
  join_date: string;
  salary: number;
  status: 'active' | 'on_leave' | 'resigned' | 'terminated';
  created_at: string;
}

export interface OnlineOrder {
  id: string;
  order_number: string;
  customer_name: string;
  customer_email?: string;
  customer_phone: string;
  customer_address: string;
  customer_city?: string;
  status: 'pending' | 'confirmed' | 'processing' | 'shipped' | 'delivered' | 'cancelled' | 'refunded';
  payment_method: string;
  payment_status: 'pending' | 'paid' | 'failed' | 'refunded';
  subtotal: number;
  shipping_cost: number;
  discount_amount: number;
  total_amount: number;
  created_at: string;
}

export interface ActivityLog {
  id: string;
  user_id?: string;
  action: string;
  entity_type: string;
  entity_id?: string;
  entity_label?: string;
  metadata?: Record<string, unknown>;
  created_at: string;
}

export type PaymentMethod = 'cash' | 'bank_transfer' | 'bkash' | 'nagad' | 'rocket' | 'sslcommerz' | 'cheque' | 'card';

export interface Payment {
  id: string;
  payment_number: string;
  payment_type: 'received' | 'made';
  reference_type: 'invoice' | 'purchase_order' | 'advance' | 'refund';
  reference_id: string;
  customer_id?: string;
  supplier_id?: string;
  amount: number;
  payment_method: PaymentMethod;
  payment_date: string;
  reference_number?: string;
  bank_account?: string;
  notes?: string;
  created_at: string;
}
