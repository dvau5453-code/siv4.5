'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { formatCurrency, formatDate } from '@/lib/format';
import { toast } from '@/hooks/use-toast';
import { ShoppingCart, Plus, Search, Eye, X, Trash2, TrendingUp, Clock, CircleCheck as CheckCircle2, Printer, DollarSign, Send, CreditCard, UserPlus, RotateCcw, Package, Filter, ChevronDown, Wallet, CircleArrowDown as ArrowDownCircle, CircleArrowUp as ArrowUpCircle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import type { Invoice, InvoiceStatus, Customer, Product, Payment, PaymentMethod, ProductUnit } from '@/lib/types';
import { isMultiUnitEnabled, getDefaultSaleUnit, convertToBaseUnit } from '@/lib/unit-utils';
import ProductSearchInput from '@/components/ui/ProductSearchInput';
import ProductFilterDropdown from '@/components/ui/ProductFilterDropdown';
import PrintTemplate from '@/components/PrintTemplate';

const statusConfig: Record<InvoiceStatus, { label: string; color: string; bg: string }> = {
  draft: { label: 'Draft', color: 'text-gray-600', bg: 'bg-gray-100' },
  sent: { label: 'Sent', color: 'text-blue-600', bg: 'bg-blue-100' },
  partially_paid: { label: 'Partial', color: 'text-amber-600', bg: 'bg-amber-100' },
  paid: { label: 'Paid', color: 'text-green-600', bg: 'bg-green-100' },
  overdue: { label: 'Overdue', color: 'text-red-600', bg: 'bg-red-100' },
  cancelled: { label: 'Cancelled', color: 'text-gray-600', bg: 'bg-gray-100' },
  refunded: { label: 'Refunded', color: 'text-purple-600', bg: 'bg-purple-100' },
  refundable: { label: 'Refundable', color: 'text-teal-600', bg: 'bg-teal-100' },
};

interface InvoiceWithCustomer extends Omit<Invoice, 'customer'> {
  customer?: { name: string; code: string; phone?: string; address?: string };
  sales_returns?: { id: string; return_number: string; total_refund_amount: number; items: { quantity_returned: number }[] }[];
  payments?: { id: string; payment_method: string; amount: number; payment_date: string }[];
}

interface InvoiceItem {
  product_id: string;
  product?: Product;
  quantity: number;
  unit_price: number;
  discount_percent: number;
  tax_rate: number;
  subtotal: number;
  selected_unit?: ProductUnit;
  base_quantity: number;
}

export default function SalesPage() {
  const router = useRouter();
  const [invoices, setInvoices] = useState<InvoiceWithCustomer[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterPaymentMethod, setFilterPaymentMethod] = useState('');
  const [filterProduct, setFilterProduct] = useState('');
  const [filterCustomer, setFilterCustomer] = useState('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [productFilteredIds, setProductFilteredIds] = useState<Set<string> | null>(null);
  const [paymentMethods, setPaymentMethods] = useState<{ code: string; name: string }[]>([]);
  const [stats, setStats] = useState({ total: 0, paid: 0, refunded: 0, netCollected: 0, outstanding: 0, overdue: 0, storeCreditBalance: 0 });
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showNetCollectedModal, setShowNetCollectedModal] = useState(false);
  const [viewingInvoice, setViewingInvoice] = useState<InvoiceWithCustomer | null>(null);
  const [invoiceItems, setInvoiceItems] = useState<any[]>([]);
  const [invoicePayments, setInvoicePayments] = useState<any[]>([]);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentInvoice, setPaymentInvoice] = useState<InvoiceWithCustomer | null>(null);
  const [companySettings, setCompanySettings] = useState<any>({ name: '', address: '', phone: '', email: '', logo_url: '' });

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    setLoading(true);
    const [invRes, custRes, prodRes, settingsRes, returnsRes, paymentMethodsRes, paymentsRes] = await Promise.all([
      supabase.from('invoices').select('*, customer:customers(name, code, phone, address)').order('created_at', { ascending: false }),
      supabase.from('customers').select('*').eq('is_active', true).order('name'),
      supabase.from('products').select(`*, units:product_units(id, product_id, unit_name, unit_short, conversion_factor, is_base_unit, is_sale_unit, price, cost_price, is_active, sort_order), inventory_items(quantity_on_hand)`).eq('is_active', true).order('name'),
      supabase.from('app_settings').select('setting_value').eq('setting_key', 'company').maybeSingle(),
      supabase.from('sales_returns').select('id, invoice_id, return_number, total_refund_amount, items:sales_return_items(quantity_returned)'),
      supabase.from('payment_methods').select('code, name').eq('is_active', true).order('sort_order'),
      supabase.from('payments').select('id, reference_id, payment_method, amount, payment_date').eq('reference_type', 'invoice'),
    ]);

    // Attach sales returns to their corresponding invoices
    const returnsMap = new Map<string, any[]>();
    (returnsRes.data || []).forEach((ret: any) => {
      const existing = returnsMap.get(ret.invoice_id) || [];
      existing.push(ret);
      returnsMap.set(ret.invoice_id, existing);
    });

    // Attach payments to their corresponding invoices
    const paymentsMap = new Map<string, any[]>();
    (paymentsRes.data || []).forEach((pay: any) => {
      const existing = paymentsMap.get(pay.reference_id) || [];
      existing.push(pay);
      paymentsMap.set(pay.reference_id, existing);
    });

    const invoicesWithReturns = (invRes.data || []).map((inv: any) => ({
      ...inv,
      sales_returns: returnsMap.get(inv.id) || [],
      payments: paymentsMap.get(inv.id) || []
    }));

    setInvoices(invoicesWithReturns);
    setPaymentMethods(paymentMethodsRes.data || []);
    setCustomers(custRes.data || []);
    setProducts(prodRes.data || []);
    if (settingsRes.data?.setting_value) setCompanySettings(settingsRes.data.setting_value);

    const allInv = invoicesWithReturns;
    const totalRefunded = allInv.reduce((s: number, i: any) => {
      const refunds = (i.sales_returns || []).reduce((rs: number, r: any) => rs + Number(r.total_refund_amount), 0);
      return s + refunds;
    }, 0);
    const totalCollected = allInv.reduce((s: number, i: any) => s + Number(i.amount_paid), 0);

    // Fetch store credit balance
    const { data: creditData } = await supabase
      .from('customer_store_credits')
      .select('balance')
      .eq('status', 'active');
    const storeCreditBalance = (creditData || []).reduce((s: number, c: any) => s + Number(c.balance), 0);

    setStats({
      total: allInv.reduce((s: number, i: any) => s + Number(i.total_amount), 0),
      paid: totalCollected,
      refunded: totalRefunded,
      netCollected: totalCollected - totalRefunded,
      outstanding: allInv.reduce((s: number, i: any) => s + Number(i.balance_due || 0), 0),
      overdue: allInv.filter((i: any) => i.status === 'overdue').length,
      storeCreditBalance,
    });
    setLoading(false);
  }

  async function viewInvoiceDetails(invoice: InvoiceWithCustomer) {
    const [itemsRes, paymentsRes] = await Promise.all([
      supabase
        .from('invoice_items')
        .select('*, product:products(name, sku, unit)')
        .eq('invoice_id', invoice.id),
      supabase
        .from('payments')
        .select('id, payment_number, payment_method, amount, payment_date, reference_number')
        .eq('reference_type', 'invoice')
        .eq('reference_id', invoice.id)
    ]);
    setInvoiceItems(itemsRes.data || []);
    setInvoicePayments(paymentsRes.data || []);
    setViewingInvoice(invoice);
  }

  function ViewInvoiceModal({ invoice, items, payments, onClose, onRecordPayment, onUpdateStatus }: {
    invoice: InvoiceWithCustomer;
    items: any[];
    payments: any[];
    onClose: () => void;
    onRecordPayment: () => void;
    onUpdateStatus: (status: InvoiceStatus) => void;
  }) {
    const cfg = statusConfig[invoice.status as InvoiceStatus] || statusConfig.draft;
    const balance = Number(invoice.balance_due ?? (Number(invoice.total_amount) - Number(invoice.amount_paid)));
    const discountTotal = items.reduce((s, item) => s + (item.quantity * item.unit_price * (item.discount_percent || 0) / 100), 0);

    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
        <div className="print-modal bg-white rounded-2xl w-full max-w-3xl shadow-2xl max-h-[90vh] overflow-y-auto">

          {/* Toolbar */}
          <div className="no-print flex items-center justify-between px-6 py-3 border-b border-border sticky top-0 bg-white z-10">
            <span className="text-sm font-semibold text-muted-foreground">Invoice Preview</span>
            <div className="flex items-center gap-2">
              <button onClick={() => window.print()} className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition">
                <Printer className="w-3.5 h-3.5" />Print / PDF
              </button>
              <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1"><X className="w-5 h-5" /></button>
            </div>
          </div>

          {/* Print body */}
          <div className="p-8">
            <PrintTemplate
              docType="INVOICE"
              docNumber={invoice.invoice_number}
              docDate={invoice.invoice_date}
              dueDate={invoice.due_date || undefined}
              status={cfg.label}
              company={{
                name: companySettings.name || 'Your Company',
                address: companySettings.address,
                phone: companySettings.phone,
                email: companySettings.email,
                logo_url: companySettings.logo_url,
              }}
              customer={{
                name: invoice.customer?.name || '—',
                code: invoice.customer?.code,
                phone: invoice.customer?.phone,
                address: invoice.customer?.address,
              }}
              items={items.map((item: any) => ({
                product_name: item.product?.name || '—',
                product_sku: item.product?.sku,
                quantity: item.quantity,
                unit_price: item.unit_price,
                discount_percent: item.discount_percent || 0,
                subtotal: item.subtotal,
                unit_name: item.unit_name,
              }))}
              subtotal={Number(invoice.subtotal)}
              discountTotal={discountTotal}
              totalAmount={Number(invoice.total_amount)}
              amountPaid={Number(invoice.amount_paid)}
              balanceDue={balance}
              notes={(invoice as any).notes}
              payments={payments?.map((p: any) => ({
                payment_number: p.payment_number,
                payment_date: p.payment_date,
                amount: p.amount,
                payment_method: p.payment_method,
              }))}
            />
          </div>

          {/* Product links (hidden on print) */}
          <div className="no-print px-8 py-3 border-t border-border">
            <p className="text-xs text-muted-foreground mb-2">Products in this invoice (click to view details):</p>
            <div className="flex flex-wrap gap-2">
              {items.map((item: any, i: number) => (
                <button
                  key={i}
                  onClick={() => router.push(`/inventory/${item.product_id}`)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-muted/40 hover:bg-blue-50 hover:text-blue-600 rounded-lg text-xs font-medium transition border border-transparent hover:border-blue-200"
                >
                  <Package className="w-3 h-3" />
                  {item.product?.name || 'Unknown'}
                </button>
              ))}
            </div>
          </div>

          {/* Action buttons (hidden on print) */}
          {invoice.status !== 'paid' && invoice.status !== 'cancelled' && invoice.status !== 'refunded' && (
            <div className="no-print flex items-center justify-end gap-2 px-8 py-4 border-t border-border">
              {invoice.status === 'draft' && (
                <button onClick={() => onUpdateStatus('sent')} className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold transition">
                  <Send className="w-4 h-4" />Mark as Sent
                </button>
              )}
              {balance > 0 && (invoice.status === 'sent' || invoice.status === 'partially_paid') && (
                <button onClick={onRecordPayment} className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-semibold transition">
                  <CreditCard className="w-4 h-4" />Record Payment
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  function openPaymentModal(invoice: InvoiceWithCustomer) {
    setPaymentInvoice(invoice);
    setShowPaymentModal(true);
  }

  async function updateInvoiceStatus(invoice: InvoiceWithCustomer, newStatus: InvoiceStatus) {
    const { error } = await supabase
      .from('invoices')
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq('id', invoice.id);

    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Success', description: `Invoice marked as ${statusConfig[newStatus].label}` });
      loadData();
    }
  }

  const filtered = invoices.filter(i => {
    // Basic filters
    if (search && !i.invoice_number.toLowerCase().includes(search.toLowerCase()) && !i.customer?.name?.toLowerCase().includes(search.toLowerCase())) return false;
    if (filterStatus === 'refundable') {
      // Invoices eligible for return (paid or partially paid, with remaining balance)
      if (i.status !== 'paid' && i.status !== 'partially_paid') return false;
    } else if (filterStatus === 'refunded') {
      // Invoices that have any sales returns OR status is explicitly refunded
      const hasReturns = i.sales_returns && i.sales_returns.length > 0;
      if (!hasReturns && i.status !== 'refunded') return false;
    } else if (filterStatus && i.status !== filterStatus) {
      return false;
    }
    if (filterPaymentMethod && (!i.payments || !i.payments.some(p => p.payment_method === filterPaymentMethod))) return false;

    // Advanced filters
    if (filterCustomer && i.customer_id !== filterCustomer) return false;
    if (filterDateFrom && i.invoice_date < filterDateFrom) return false;
    if (filterDateTo && i.invoice_date > filterDateTo) return false;

    return true;
  });

  // Fetch product-filtered invoice IDs when filterProduct changes
  useEffect(() => {
    if (!filterProduct) {
      setProductFilteredIds(null);
      return;
    }
    supabase
      .from('invoice_items')
      .select('invoice_id')
      .eq('product_id', filterProduct)
      .then(({ data }) => {
        setProductFilteredIds(new Set((data || []).map((item: any) => item.invoice_id)));
      });
  }, [filterProduct]);

  // Apply product filter to filtered results
  const displayInvoices = productFilteredIds === null
    ? filtered
    : filtered.filter(inv => productFilteredIds.has(inv.id));

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Sales & Invoices</h1>
          <p className="text-muted-foreground text-sm mt-0.5">Track all sales transactions</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/sales/pos" className="flex items-center justify-center gap-2 border border-blue-600 text-blue-600 hover:bg-blue-50 px-3 sm:px-4 py-2 rounded-lg text-sm font-semibold transition shrink-0">
            <ShoppingCart className="w-4 h-4" />
            <span className="hidden sm:inline">POS</span>
          </Link>
          <button onClick={() => setShowCreateModal(true)} className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-3 sm:px-4 py-2 rounded-lg text-sm font-semibold transition shrink-0">
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">New Invoice</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
        {[
          { label: 'Total Sales', value: formatCurrency(stats.total), icon: TrendingUp, color: 'text-blue-500 bg-blue-50', clickable: false },
          { label: 'Collected', value: formatCurrency(stats.paid), icon: CheckCircle2, color: 'text-green-500 bg-green-50', clickable: false },
          { label: 'Refunded', value: formatCurrency(stats.refunded), icon: RotateCcw, color: 'text-purple-500 bg-purple-50', clickable: false },
          { label: 'Net Collected', value: formatCurrency(stats.netCollected), icon: DollarSign, color: 'text-teal-500 bg-teal-50', clickable: true },
          { label: 'Store Credit', value: formatCurrency(stats.storeCreditBalance), icon: Wallet, color: 'text-indigo-500 bg-indigo-50', clickable: false },
          { label: 'Outstanding', value: formatCurrency(stats.outstanding), icon: Clock, color: 'text-amber-500 bg-amber-50', clickable: false },
        ].map(s => (
          <div
            key={s.label}
            className={`stat-card flex items-center gap-3 ${s.clickable ? 'cursor-pointer hover:shadow-md hover:border-teal-300 transition-all' : ''}`}
            onClick={s.clickable ? () => setShowNetCollectedModal(true) : undefined}
          >
            <div className={`w-10 h-10 rounded-full flex items-center justify-center ${s.color}`}><s.icon className="w-5 h-5" /></div>
            <div>
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className="text-lg font-bold text-foreground">{s.value}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-border p-4 shadow-sm space-y-3">
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search invoices..." className="w-full pl-8 pr-4 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
          </div>
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="border border-border rounded-lg px-3 py-2 text-sm focus:outline-none">
            <option value="">All Status</option>
            {Object.entries(statusConfig).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          <select value={filterPaymentMethod} onChange={e => setFilterPaymentMethod(e.target.value)} className="border border-border rounded-lg px-3 py-2 text-sm focus:outline-none">
            <option value="">All Payment Methods</option>
            {paymentMethods.map(pm => <option key={pm.code} value={pm.code}>{pm.name}</option>)}
          </select>
          <button
            onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
            className={`flex items-center gap-1.5 border rounded-lg px-3 py-2 text-sm transition ${showAdvancedFilters ? 'border-blue-500 text-blue-600 bg-blue-50' : 'border-border text-muted-foreground hover:text-foreground'}`}
          >
            <Filter className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">More Filters</span>
            <ChevronDown className={`w-3 h-3 transition-transform ${showAdvancedFilters ? 'rotate-180' : ''}`} />
          </button>
        </div>

        {/* Advanced Filters */}
        {showAdvancedFilters && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-3 border-t border-border">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Product</label>
              <ProductFilterDropdown
                value={filterProduct}
                onChange={setFilterProduct}
                placeholder="All Products"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Customer</label>
              <select value={filterCustomer} onChange={e => setFilterCustomer(e.target.value)} className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none">
                <option value="">All Customers</option>
                {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Date From</label>
              <input type="date" value={filterDateFrom} onChange={e => setFilterDateFrom(e.target.value)} className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Date To</label>
              <input type="date" value={filterDateTo} onChange={e => setFilterDateTo(e.target.value)} className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
            </div>
          </div>
        )}

        {(filterProduct || filterCustomer || filterDateFrom || filterDateTo) && (
          <div className="flex flex-wrap gap-2 pt-2">
            {filterProduct && (
              <span className="inline-flex items-center gap-1 px-2 py-1 bg-blue-100 text-blue-700 text-xs rounded-full">
                Product: {products.find(p => p.id === filterProduct)?.name || ''}
                <button onClick={() => setFilterProduct('')} className="hover:text-blue-900"><X className="w-3 h-3" /></button>
              </span>
            )}
            {filterCustomer && (
              <span className="inline-flex items-center gap-1 px-2 py-1 bg-teal-100 text-teal-700 text-xs rounded-full">
                Customer: {customers.find(c => c.id === filterCustomer)?.name || ''}
                <button onClick={() => setFilterCustomer('')} className="hover:text-teal-900"><X className="w-3 h-3" /></button>
              </span>
            )}
            {filterDateFrom && (
              <span className="inline-flex items-center gap-1 px-2 py-1 bg-amber-100 text-amber-700 text-xs rounded-full">
                From: {filterDateFrom}
                <button onClick={() => setFilterDateFrom('')} className="hover:text-amber-900"><X className="w-3 h-3" /></button>
              </span>
            )}
            {filterDateTo && (
              <span className="inline-flex items-center gap-1 px-2 py-1 bg-amber-100 text-amber-700 text-xs rounded-full">
                To: {filterDateTo}
                <button onClick={() => setFilterDateTo('')} className="hover:text-amber-900"><X className="w-3 h-3" /></button>
              </span>
            )}
            <button
              onClick={() => { setFilterProduct(''); setFilterCustomer(''); setFilterDateFrom(''); setFilterDateTo(''); }}
              className="text-xs text-muted-foreground hover:text-red-600 underline"
            >
              Clear all
            </button>
          </div>
        )}
      </div>

      <div className="table-wrapper">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-muted/40 border-b border-border">
                <th className="text-left text-xs font-semibold text-muted-foreground px-4 py-3">Invoice #</th>
                <th className="text-left text-xs font-semibold text-muted-foreground px-4 py-3">Customer</th>
                <th className="text-left text-xs font-semibold text-muted-foreground px-4 py-3">Date</th>
                <th className="text-left text-xs font-semibold text-muted-foreground px-4 py-3">Due Date</th>
                <th className="text-right text-xs font-semibold text-muted-foreground px-4 py-3">Amount</th>
                <th className="text-right text-xs font-semibold text-muted-foreground px-4 py-3">Paid</th>
                <th className="text-right text-xs font-semibold text-muted-foreground px-4 py-3">Balance</th>
                <th className="text-left text-xs font-semibold text-muted-foreground px-4 py-3">Status</th>
                <th className="text-right text-xs font-semibold text-muted-foreground px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? Array.from({ length: 6 }).map((_, i) => (
                <tr key={i}>{Array.from({ length: 9 }).map((_, j) => <td key={j} className="px-4 py-3"><div className="h-4 bg-muted rounded animate-pulse" /></td>)}</tr>
              )) : displayInvoices.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-12 text-center text-muted-foreground text-sm">No invoices found</td></tr>
              ) : displayInvoices.map((inv) => {
                const cfg = statusConfig[inv.status as InvoiceStatus] || statusConfig.draft;
                const hasReturns = inv.sales_returns && inv.sales_returns.length > 0;
                const totalReturnedQty = hasReturns
                  ? inv.sales_returns!.flatMap(r => r.items?.map(i => i.quantity_returned) || []).reduce((a, b) => a + b, 0)
                  : 0;
                const totalRefundAmount = hasReturns
                  ? inv.sales_returns!.reduce((sum, r) => sum + Number(r.total_refund_amount), 0)
                  : 0;
                return (
                  <tr key={inv.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3">
                      <span className="text-sm font-semibold text-blue-600">{inv.invoice_number}</span>
                      {hasReturns && (
                        <div className="flex items-center gap-1 mt-1">
                          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-amber-100 text-amber-700 text-[10px] font-medium rounded">
                            <RotateCcw className="w-2.5 h-2.5" />
                            {totalReturnedQty} returned
                          </span>
                          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-red-100 text-red-700 text-[10px] font-medium rounded">
                            {formatCurrency(totalRefundAmount)} refund
                          </span>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-foreground">{inv.customer?.name || '-'}</td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">{formatDate(inv.invoice_date)}</td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">{inv.due_date ? formatDate(inv.due_date) : '-'}</td>
                    <td className="px-4 py-3 text-right text-sm font-semibold text-foreground">{formatCurrency(inv.total_amount)}</td>
                    <td className="px-4 py-3 text-right text-sm text-green-600 font-semibold">{formatCurrency(inv.amount_paid)}</td>
                    <td className="px-4 py-3 text-right text-sm font-bold text-red-600">{formatCurrency(inv.balance_due || (inv.total_amount - inv.amount_paid))}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1 items-center">
                        <span className={`badge-status ${cfg.bg} ${cfg.color} whitespace-nowrap`}>{cfg.label}</span>
                        {inv.payments && inv.payments.length > 0 && (
                          <span className="badge-status bg-slate-100 text-slate-700 flex items-center gap-0.5">
                            <CreditCard className="w-2.5 h-2.5" />
                            {inv.payments.map(p => p.payment_method.replace('_', ' ')).join(', ')}
                          </span>
                        )}
                        {hasReturns && (
                          <span className="badge-status bg-amber-100 text-amber-700 flex items-center gap-0.5">
                            <Package className="w-2.5 h-2.5" />
                            {inv.sales_returns!.length} return{inv.sales_returns!.length > 1 ? 's' : ''}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-0.5 sm:gap-1">
                        {inv.status === 'draft' && (
                          <button onClick={() => updateInvoiceStatus(inv, 'sent')} className="w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center rounded-lg hover:bg-blue-50 text-muted-foreground hover:text-blue-600 transition" title="Mark as Sent">
                            <Send className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {(inv.status === 'sent' || inv.status === 'partially_paid') && (inv.balance_due || inv.total_amount - inv.amount_paid) > 0 && (
                          <button onClick={() => openPaymentModal(inv)} className="w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center rounded-lg hover:bg-green-50 text-muted-foreground hover:text-green-600 transition" title="Record Payment">
                            <DollarSign className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <button onClick={() => viewInvoiceDetails(inv)} className="w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center rounded-lg hover:bg-blue-50 text-muted-foreground hover:text-blue-600 transition" title="View Details">
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-3 border-t border-border">
          <p className="text-xs text-muted-foreground">{displayInvoices.length} invoices</p>
        </div>
      </div>

      {showCreateModal && (
        <CreateInvoiceModal
          customers={customers}
          products={products}
          onClose={() => setShowCreateModal(false)}
          onSaved={loadData}
        />
      )}

      {viewingInvoice && (
        <ViewInvoiceModal
          invoice={viewingInvoice}
          items={invoiceItems}
          payments={invoicePayments}
          onClose={() => setViewingInvoice(null)}
          onRecordPayment={() => { setViewingInvoice(null); openPaymentModal(viewingInvoice); }}
          onUpdateStatus={(status) => { setViewingInvoice(null); updateInvoiceStatus(viewingInvoice, status); }}
        />
      )}

      {showPaymentModal && paymentInvoice && (
        <RecordPaymentModal
          invoice={paymentInvoice}
          onClose={() => { setShowPaymentModal(false); setPaymentInvoice(null); }}
          onSaved={() => { setShowPaymentModal(false); setPaymentInvoice(null); loadData(); }}
        />
      )}

      {showNetCollectedModal && (
        <NetCollectedBreakdownModal
          stats={stats}
          onClose={() => setShowNetCollectedModal(false)}
        />
      )}
    </div>
  );
}

function CreateInvoiceModal({ customers, products, onClose, onSaved }: {
  customers: Customer[];
  products: Product[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const router = useRouter();
  const [form, setForm] = useState({
    customer_id: '',
    invoice_date: new Date().toISOString().split('T')[0],
    due_date: '',
    notes: '',
    payment_type: 'credit' as 'credit' | 'partial' | 'full',
    amount_paid: 0,
    payment_method: 'cash' as PaymentMethod,
    payment_reference: '',
  });
  const [items, setItems] = useState<{
    product_id: string;
    product_name: string;
    product_sku: string;
    product_unit?: string;
    product_base_unit?: string;
    stock_qty: number | null;
    quantity: number;
    unit_price: number;
    cost_price: number;
    discount_percent: number;
    selected_unit?: ProductUnit;
    available_units?: ProductUnit[];
    base_quantity: number;
  }[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [showAddCustomer, setShowAddCustomer] = useState(false);
  const [customerList, setCustomerList] = useState(customers);
  const [paymentMethods, setPaymentMethods] = useState<{ code: string; name: string }[]>([]);

  useEffect(() => {
    supabase.from('payment_methods').select('code, name').eq('is_active', true).order('sort_order')
      .then(({ data }) => { if (data) setPaymentMethods(data); });
  }, []);

  function addProductToItems(product: any) {
    const multiUnit = product.enable_multi_unit && product.units && product.units.filter((u: any) => u.is_active).length > 0;
    const defaultUnit: ProductUnit | undefined = multiUnit ? getDefaultSaleUnit(product) : undefined;
    const unitPrice = defaultUnit ? defaultUnit.price : (product.sale_price || 0);
    const baseQty = defaultUnit ? convertToBaseUnit(1, defaultUnit) : 1;
    const stock = product.inventory_items?.reduce((s: number, i: any) => s + Number(i.quantity_on_hand), 0) ?? null;

    // Stock validation - prevent adding out of stock items
    if (stock !== null && stock <= 0) {
      toast({ title: 'Out of stock', description: `${product.name} is not available`, variant: 'destructive' });
      return;
    }

    // If same product+unit already in list, increment qty instead
    const existingIndex = items.findIndex(
      i => i.product_id === product.id && (i.selected_unit?.id ?? '') === (defaultUnit?.id ?? '')
    );
    if (existingIndex >= 0) {
      const updated = [...items];
      const ex = updated[existingIndex];
      const newQty = ex.quantity + 1;
      const newBase = ex.selected_unit ? convertToBaseUnit(newQty, ex.selected_unit) : newQty;
      // Check stock limit
      if (ex.stock_qty !== null && newBase > ex.stock_qty) {
        toast({ title: 'Stock limit', description: `Only ${ex.stock_qty} ${ex.product_base_unit || 'units'} available`, variant: 'destructive' });
        return;
      }
      updated[existingIndex] = { ...ex, quantity: newQty, base_quantity: newBase };
      setItems(updated);
      return;
    }

    setItems(prev => [...prev, {
      product_id: product.id,
      product_name: product.name,
      product_sku: product.sku,
      product_unit: product.unit,
      product_base_unit: product.base_unit,
      stock_qty: stock,
      quantity: 1,
      unit_price: unitPrice,
      cost_price: defaultUnit ? (defaultUnit.cost_price || product.cost_price || 0) : (product.cost_price || 0),
      discount_percent: 0,
      selected_unit: defaultUnit,
      available_units: multiUnit ? product.units.filter((u: any) => u.is_active) : undefined,
      base_quantity: baseQty,
    }]);
  }

  function updateItem(index: number, field: string, value: any) {
    const updated = [...items];
    if (field === 'selected_unit') {
      const unit = value as ProductUnit;
      const newBaseQty = convertToBaseUnit(updated[index].quantity, unit);
      const stockQty = updated[index].stock_qty;
      // Check stock limit when changing unit
      if (stockQty !== null && newBaseQty > stockQty) {
        toast({ title: 'Stock limit', description: `Only ${stockQty} ${updated[index].product_base_unit || 'units'} available`, variant: 'destructive' });
        return;
      }
      updated[index] = {
        ...updated[index],
        selected_unit: unit,
        unit_price: unit.price,
        base_quantity: newBaseQty,
      };
    } else if (field === 'quantity') {
      const qty = parseInt(value) || 1;
      const unit = updated[index].selected_unit;
      const newBaseQty = unit ? convertToBaseUnit(qty, unit) : qty;
      const stockQty = updated[index].stock_qty;
      // Check stock limit when changing quantity
      if (stockQty !== null && newBaseQty > stockQty) {
        toast({ title: 'Stock limit', description: `Only ${stockQty} ${updated[index].product_base_unit || 'units'} available`, variant: 'destructive' });
        return;
      }
      updated[index] = { ...updated[index], quantity: qty, base_quantity: newBaseQty };
    } else if (field === 'discount_percent') {
      updated[index] = { ...updated[index], discount_percent: Math.min(100, Math.max(0, parseFloat(value) || 0)) };
    } else {
      (updated[index] as any)[field] = value;
    }
    setItems(updated);
  }

  function removeItem(index: number) {
    setItems(items.filter((_, i) => i !== index));
  }

  const subtotal = items.reduce((sum, item) => {
    return sum + item.quantity * item.unit_price * (1 - (item.discount_percent || 0) / 100);
  }, 0);

  const amountPaid = form.payment_type === 'full' ? subtotal : (form.payment_type === 'partial' ? form.amount_paid : 0);

  async function handleAddCustomer(newCustomerId: string) {
    const { data } = await supabase.from('customers').select('*').eq('id', newCustomerId).single();
    if (data) {
      setCustomerList([...customerList, data as Customer]);
      setForm({ ...form, customer_id: newCustomerId });
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!form.customer_id) { setError('Please select a customer'); return; }
    if (items.length === 0) { setError('Please add at least one item'); return; }
    if (form.payment_type === 'partial' && form.amount_paid <= 0) { setError('Please enter payment amount for partial payment'); return; }
    if (form.payment_type === 'partial' && form.amount_paid >= subtotal) { setError('Partial payment must be less than total. Use "Full Payment" instead.'); return; }

    // Final stock validation before saving
    for (const item of items) {
      if (item.stock_qty !== null && item.base_quantity > item.stock_qty) {
        setError(`Insufficient stock for ${item.product_name}. Available: ${item.stock_qty} ${item.product_base_unit || 'units'}, Requested: ${item.base_quantity}`);
        return;
      }
    }

    setSaving(true);
    setError('');

    const invoiceNumber = `INV-${Date.now().toString().slice(-6)}`;
    const totalAmount = subtotal;

    const { data: invoice, error: invError } = await supabase
      .from('invoices')
      .insert({
        invoice_number: invoiceNumber,
        customer_id: form.customer_id,
        invoice_date: form.invoice_date,
        due_date: form.due_date || null,
        subtotal,
        total_amount: totalAmount,
        amount_paid: amountPaid,
        status: amountPaid >= totalAmount ? 'paid' : (amountPaid > 0 ? 'partially_paid' : 'draft'),
        is_pos: false,
        notes: form.notes || null,
      })
      .select()
      .single();

    if (invError) { setError(invError.message); setSaving(false); return; }

    const invoiceItems = items.map(item => ({
      invoice_id: invoice.id,
      product_id: item.product_id,
      quantity: item.quantity,
      unit_price: item.unit_price,
      cost_price: item.cost_price || 0,
      discount_percent: item.discount_percent || 0,
      tax_rate: 0,
      subtotal: item.quantity * item.unit_price * (1 - (item.discount_percent || 0) / 100),
      unit_name: item.selected_unit?.unit_name,
      unit_conversion_factor: item.selected_unit?.conversion_factor,
      base_quantity: item.base_quantity,
    }));

    const { error: itemsError } = await supabase.from('invoice_items').insert(invoiceItems);
    if (itemsError) { setError(itemsError.message); setSaving(false); return; }

    // Record payment if full or partial
    if (amountPaid > 0) {
      const paymentNumber = `PAY-${Date.now().toString().slice(-6)}`;
      await supabase.from('payments').insert({
        payment_number: paymentNumber,
        payment_type: 'received',
        reference_type: 'invoice',
        reference_id: invoice.id,
        customer_id: form.customer_id,
        amount: amountPaid,
        payment_method: form.payment_method,
        payment_date: form.invoice_date,
        reference_number: form.payment_reference || null,
        notes: form.payment_type === 'full' ? 'Full payment at invoice time' : 'Partial payment at invoice time',
      });

      // Update customer outstanding balance
      const { data: currentCustomer } = await supabase
        .from('customers')
        .select('outstanding_balance, total_purchases')
        .eq('id', form.customer_id)
        .single();

      if (currentCustomer) {
        await supabase
          .from('customers')
          .update({
            outstanding_balance: (currentCustomer.outstanding_balance || 0) + (totalAmount - amountPaid),
            total_purchases: (currentCustomer.total_purchases || 0) + totalAmount,
            updated_at: new Date().toISOString()
          })
          .eq('id', form.customer_id);
      }
    }

    toast({ title: 'Success', description: 'Invoice created successfully' });
    onSaved();
    onClose();
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-3xl shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border sticky top-0 bg-white z-10">
          <h2 className="text-base font-bold">Create New Invoice</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSave} className="p-6 space-y-4">
          {error && <div className="p-3 bg-red-50 text-red-600 rounded-lg text-sm">{error}</div>}

          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2">
              <label className="block text-xs font-medium mb-1">Customer *</label>
              <div className="flex gap-2">
                <select required value={form.customer_id} onChange={e => setForm({ ...form, customer_id: e.target.value })} className="flex-1 border border-border rounded-lg px-3 py-2 text-sm focus:outline-none">
                  <option value="">Select customer</option>
                  {customerList.map(c => <option key={c.id} value={c.id}>{c.name} ({c.code})</option>)}
                </select>
                <button
                  type="button"
                  onClick={() => setShowAddCustomer(true)}
                  className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-3 py-2 text-sm font-medium transition shrink-0"
                >
                  <UserPlus className="w-4 h-4" /> New
                </button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-medium mb-1">Invoice Date</label>
                <input type="date" value={form.invoice_date} onChange={e => setForm({ ...form, invoice_date: e.target.value })} className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Due Date</label>
                <input type="date" value={form.due_date} onChange={e => setForm({ ...form, due_date: e.target.value })} className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
              </div>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium">Line Items</label>
              {items.length > 0 && <span className="text-xs text-muted-foreground">{items.length} item{items.length !== 1 ? 's' : ''}</span>}
            </div>
            <ProductSearchInput
              onSelect={addProductToItems}
              showStock
              placeholder="Search and add products..."
              className="mb-3"
            />
            {items.length > 0 && (
            <div className="border border-border rounded-lg overflow-hidden">
              <table className="w-full">
                <thead className="bg-muted/40">
                  <tr>
                    <th className="text-left text-xs font-semibold text-muted-foreground px-3 py-2">Product</th>
                    <th className="text-right text-xs font-semibold text-muted-foreground px-3 py-2 w-20">Qty</th>
                    <th className="text-right text-xs font-semibold text-muted-foreground px-3 py-2 w-28">Price</th>
                    <th className="text-right text-xs font-semibold text-muted-foreground px-3 py-2 w-20">Disc %</th>
                    <th className="text-right text-xs font-semibold text-muted-foreground px-3 py-2 w-28">Total</th>
                    <th className="w-8"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {items.map((item, index) => {
                    const lineTotal = item.quantity * item.unit_price * (1 - (item.discount_percent || 0) / 100);
                    return (
                      <tr key={index}>
                        <td className="px-3 py-2">
                          <p className="text-sm font-medium text-foreground hover:text-blue-600 hover:underline cursor-pointer" onClick={() => router.push(`/inventory/${item.product_id}`)}>{item.product_name}</p>
                          <p className="text-[10px] text-muted-foreground">{item.product_sku}</p>
                          {item.stock_qty !== null && (
                            <p className={`text-[10px] font-medium ${item.stock_qty > 0 ? (item.base_quantity > item.stock_qty ? 'text-red-500' : 'text-green-600') : 'text-red-500'}`}>
                              {item.stock_qty > 0 ? `${item.stock_qty} ${item.product_base_unit || 'units'} in stock` : 'Out of stock'}
                              {item.base_quantity > item.stock_qty && item.stock_qty > 0 && ' (over limit!)'}
                            </p>
                          )}
                          {item.available_units && item.selected_unit && (
                            <div className="mt-1">
                              <select
                                value={item.selected_unit.id}
                                onChange={e => {
                                  const unit = item.available_units?.find(u => u.id === e.target.value);
                                  if (unit) updateItem(index, 'selected_unit', unit);
                                }}
                                className="w-full border border-blue-200 bg-blue-50 text-blue-700 rounded px-2 py-1 text-xs focus:outline-none"
                              >
                                {item.available_units.map(u => (
                                  <option key={u.id} value={u.id}>{u.unit_name} - {formatCurrency(u.price)}</option>
                                ))}
                              </select>
                              <p className="text-[10px] text-muted-foreground mt-0.5">1 {item.selected_unit.unit_name} = {item.selected_unit.conversion_factor} {item.product_base_unit || 'base'}</p>
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <input type="number" min="1" value={item.quantity} onChange={e => updateItem(index, 'quantity', e.target.value)} className="w-full border border-border rounded px-2 py-1 text-sm text-right focus:outline-none" />
                          {item.available_units && item.selected_unit && (
                            <p className="text-[10px] text-muted-foreground text-center mt-0.5">= {item.base_quantity} {item.product_base_unit || 'base'}</p>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <input type="number" min="0" step="0.01" value={item.unit_price} onChange={e => updateItem(index, 'unit_price', parseFloat(e.target.value) || 0)} className="w-full border border-border rounded px-2 py-1 text-sm text-right focus:outline-none" />
                        </td>
                        <td className="px-3 py-2">
                          <input type="number" min="0" max="100" step="0.5" value={item.discount_percent || 0} onChange={e => updateItem(index, 'discount_percent', e.target.value)} className="w-full border border-border rounded px-2 py-1 text-sm text-right focus:outline-none focus:border-amber-400" placeholder="0" />
                        </td>
                        <td className="px-3 py-2 text-right text-sm font-semibold">
                          {formatCurrency(lineTotal)}
                          {(item.discount_percent || 0) > 0 && (
                            <p className="text-[10px] text-amber-600 line-through">{formatCurrency(item.quantity * item.unit_price)}</p>
                          )}
                        </td>
                        <td className="px-2 py-2">
                          <button type="button" onClick={() => removeItem(index)} className="text-red-500 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            )}
          </div>

          <div className="flex justify-end bg-muted/30 rounded-lg p-3">
            <div className="text-right">
              <p className="text-xs text-muted-foreground">Subtotal</p>
              <p className="text-lg font-bold text-foreground">{formatCurrency(subtotal)}</p>
            </div>
          </div>

          <div className="border border-border rounded-lg p-4">
            <label className="block text-xs font-medium mb-3">Payment Terms</label>
            <div className="grid grid-cols-3 gap-3">
              <button
                type="button"
                onClick={() => setForm({ ...form, payment_type: 'credit', amount_paid: 0 })}
                className={`p-3 border rounded-lg text-center transition ${form.payment_type === 'credit' ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-border hover:border-gray-300'}`}
              >
                <Clock className="w-5 h-5 mx-auto mb-1" />
                <p className="text-xs font-medium">On Credit</p>
                <p className="text-[10px] text-muted-foreground">Pay later</p>
              </button>
              <button
                type="button"
                onClick={() => setForm({ ...form, payment_type: 'partial' })}
                className={`p-3 border rounded-lg text-center transition ${form.payment_type === 'partial' ? 'border-amber-600 bg-amber-50 text-amber-700' : 'border-border hover:border-gray-300'}`}
              >
                <DollarSign className="w-5 h-5 mx-auto mb-1" />
                <p className="text-xs font-medium">Partial</p>
                <p className="text-[10px] text-muted-foreground">Pay some now</p>
              </button>
              <button
                type="button"
                onClick={() => setForm({ ...form, payment_type: 'full', amount_paid: subtotal })}
                className={`p-3 border rounded-lg text-center transition ${form.payment_type === 'full' ? 'border-green-600 bg-green-50 text-green-700' : 'border-border hover:border-gray-300'}`}
              >
                <CheckCircle2 className="w-5 h-5 mx-auto mb-1" />
                <p className="text-xs font-medium">Full Payment</p>
                <p className="text-[10px] text-muted-foreground">Pay all now</p>
              </button>
            </div>
            {(form.payment_type === 'partial' || form.payment_type === 'full') && (
              <div className="mt-4 p-3 bg-green-50 rounded-lg border border-green-200 space-y-3">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium mb-1 text-green-800">Payment Method *</label>
                    <select
                      value={form.payment_method}
                      onChange={e => setForm({ ...form, payment_method: e.target.value as PaymentMethod })}
                      className="w-full border border-green-300 bg-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500/20"
                    >
                      {paymentMethods.length > 0 ? (
                        paymentMethods.map(pm => (
                          <option key={pm.code} value={pm.code}>{pm.name}</option>
                        ))
                      ) : (
                        <>
                          <option value="cash">Cash</option>
                          <option value="bank_transfer">Bank Transfer</option>
                          <option value="card">Card (Credit/Debit)</option>
                          <option value="mobile_banking">Mobile Banking</option>
                          <option value="cheque">Cheque</option>
                          <option value="other">Other</option>
                        </>
                      )}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1 text-green-800">Reference / Transaction ID</label>
                    <input
                      type="text"
                      value={form.payment_reference}
                      onChange={e => setForm({ ...form, payment_reference: e.target.value })}
                      className="w-full border border-green-300 bg-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500/20"
                      placeholder="e.g. Cheque #, Transaction ID"
                    />
                  </div>
                </div>
                {form.payment_type === 'partial' && (
                  <div>
                    <label className="block text-xs font-medium mb-1 text-green-800">Payment Amount *</label>
                    <input
                      type="number"
                      min="0.01"
                      max={subtotal - 0.01}
                      step="0.01"
                      value={form.amount_paid}
                      onChange={e => setForm({ ...form, amount_paid: parseFloat(e.target.value) || 0 })}
                      className="w-full border border-green-300 bg-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500/20"
                      placeholder={`Enter amount (Max: ${formatCurrency(subtotal)})`}
                    />
                    <p className="text-xs text-green-700 mt-1 font-medium">
                      Balance Due After Payment: {formatCurrency(subtotal - form.amount_paid)}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium mb-1">Notes</label>
            <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2} className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20" placeholder="Additional notes..." />
          </div>

          <div className="flex items-center justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 border border-border rounded-lg text-sm hover:bg-muted transition">Cancel</button>
            <button type="submit" disabled={saving} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold transition disabled:opacity-60">
              {saving ? 'Creating...' : 'Create Invoice'}
            </button>
          </div>
        </form>

        {showAddCustomer && (
          <AddCustomerModal
            onClose={() => setShowAddCustomer(false)}
            onSaved={(id) => { handleAddCustomer(id); setShowAddCustomer(false); }}
          />
        )}
      </div>
    </div>
  );
}

function RecordPaymentModal({ invoice, onClose, onSaved }: { invoice: InvoiceWithCustomer; onClose: () => void; onSaved: () => void }) {
  const balance = invoice.balance_due || (invoice.total_amount - invoice.amount_paid);
  const [form, setForm] = useState({
    amount: balance,
    payment_method: 'cash' as PaymentMethod,
    payment_date: new Date().toISOString().split('T')[0],
    reference_number: '',
    notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [paymentMethods, setPaymentMethods] = useState<{ code: string; name: string }[]>([]);

  useEffect(() => {
    supabase.from('payment_methods').select('code, name').eq('is_active', true).order('sort_order')
      .then(({ data }) => { if (data && data.length > 0) setPaymentMethods(data); });
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (form.amount <= 0) { setError('Amount must be greater than 0'); return; }
    if (form.amount > balance) { setError(`Amount cannot exceed balance due (${formatCurrency(balance)})`); return; }

    setSaving(true);
    setError('');

    const paymentNumber = `PAY-${Date.now().toString().slice(-6)}`;

    const { error: payError } = await supabase.from('payments').insert({
      payment_number: paymentNumber,
      payment_type: 'received',
      reference_type: 'invoice',
      reference_id: invoice.id,
      customer_id: invoice.customer_id,
      amount: form.amount,
      payment_method: form.payment_method,
      payment_date: form.payment_date,
      reference_number: form.reference_number || null,
      notes: form.notes || null,
    });

    if (payError) { setError(payError.message); setSaving(false); return; }

    const newAmountPaid = invoice.amount_paid + form.amount;
    const newBalance = invoice.total_amount - newAmountPaid;
    const newStatus: InvoiceStatus = newBalance <= 0 ? 'paid' : 'partially_paid';

    const { error: invError } = await supabase
      .from('invoices')
      .update({
        amount_paid: newAmountPaid,
        status: newStatus,
        updated_at: new Date().toISOString()
      })
      .eq('id', invoice.id);

    if (invError) { setError(invError.message); setSaving(false); return; }

    // Update customer outstanding balance
    const { data: currentCustomer } = await supabase
      .from('customers')
      .select('outstanding_balance, total_purchases')
      .eq('id', invoice.customer_id)
      .single();

    if (currentCustomer) {
      await supabase
        .from('customers')
        .update({
          outstanding_balance: Math.max(0, (currentCustomer.outstanding_balance || 0) - form.amount),
          total_purchases: (currentCustomer.total_purchases || 0) + form.amount,
          updated_at: new Date().toISOString()
        })
        .eq('id', invoice.customer_id);
    }

    toast({ title: 'Success', description: `Payment of ${formatCurrency(form.amount)} recorded` });
    onSaved();
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-base font-bold">Record Payment</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && <div className="p-3 bg-red-50 text-red-600 rounded-lg text-sm">{error}</div>}

          <div className="bg-muted/30 rounded-lg p-3 flex justify-between">
            <span className="text-sm text-muted-foreground">Invoice Balance</span>
            <span className="text-sm font-bold text-red-600">{formatCurrency(balance)}</span>
          </div>

          <div>
            <label className="block text-xs font-medium mb-1">Payment Amount *</label>
            <input type="number" min="0.01" max={balance} step="0.01" value={form.amount} onChange={e => setForm({ ...form, amount: parseFloat(e.target.value) || 0 })} className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
          </div>

          <div>
            <label className="block text-xs font-medium mb-1">Payment Method *</label>
            <select required value={form.payment_method} onChange={e => setForm({ ...form, payment_method: e.target.value as PaymentMethod })} className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none">
              {paymentMethods.length > 0 ? (
                paymentMethods.map(pm => <option key={pm.code} value={pm.code}>{pm.name}</option>)
              ) : (
                <>
                  <option value="cash">Cash</option>
                  <option value="bank_transfer">Bank Transfer</option>
                  <option value="card">Card</option>
                  <option value="cheque">Cheque</option>
                </>
              )}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium mb-1">Payment Date</label>
            <input type="date" value={form.payment_date} onChange={e => setForm({ ...form, payment_date: e.target.value })} className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
          </div>

          <div>
            <label className="block text-xs font-medium mb-1">Reference Number</label>
            <input type="text" value={form.reference_number} onChange={e => setForm({ ...form, reference_number: e.target.value })} placeholder="Transaction ID, cheque no." className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
          </div>

          <div>
            <label className="block text-xs font-medium mb-1">Notes</label>
            <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2} className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
          </div>

          <div className="flex items-center justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 border border-border rounded-lg text-sm hover:bg-muted transition">Cancel</button>
            <button type="submit" disabled={saving} className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-semibold transition disabled:opacity-60">
              {saving ? 'Recording...' : 'Record Payment'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function AddCustomerModal({ onClose, onSaved }: { onClose: () => void; onSaved: (id: string) => void }) {
  const [form, setForm] = useState({
    name: '',
    phone: '',
    email: '',
    address: '',
    type: 'retail' as 'retail' | 'contractor' | 'builder' | 'architect' | 'interior_designer' | 'corporate' | 'government',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { setError('Customer name is required'); return; }
    setSaving(true);
    setError('');

    const code = `CUST-${Date.now().toString().slice(-6)}`;
    const { data, error: insertError } = await supabase
      .from('customers')
      .insert({
        code,
        name: form.name.trim(),
        phone: form.phone || null,
        email: form.email || null,
        address: form.address || null,
        type: form.type,
        country: 'Bangladesh',
        is_active: true,
        credit_limit: 0,
        credit_days: 0,
        outstanding_balance: 0,
        total_purchases: 0,
        loyalty_points: 0,
        discount_percent: 0,
      })
      .select('id')
      .single();

    if (insertError) {
      setError(insertError.message);
      setSaving(false);
      return;
    }

    toast({ title: 'Success', description: 'Customer added successfully' });
    onSaved(data.id);
    onClose();
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-base font-bold flex items-center gap-2"><UserPlus className="w-4 h-4" />Add New Customer</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSave} className="p-4 space-y-3">
          {error && <div className="p-3 bg-red-50 text-red-600 rounded-lg text-sm">{error}</div>}
          <div>
            <label className="block text-xs font-medium mb-1">Customer Name *</label>
            <input
              required
              value={form.name}
              onChange={e => setForm({ ...form, name: e.target.value })}
              placeholder="Enter customer name..."
              className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">Phone</label>
              <input
                value={form.phone}
                onChange={e => setForm({ ...form, phone: e.target.value })}
                placeholder="Phone number..."
                className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Type</label>
              <select
                value={form.type}
                onChange={e => setForm({ ...form, type: e.target.value as any })}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none"
              >
                <option value="retail">Retail</option>
                <option value="contractor">Contractor</option>
                <option value="builder">Builder</option>
                <option value="architect">Architect</option>
                <option value="interior_designer">Interior Designer</option>
                <option value="corporate">Corporate</option>
                <option value="government">Government</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Email</label>
            <input
              type="email"
              value={form.email}
              onChange={e => setForm({ ...form, email: e.target.value })}
              placeholder="Email address..."
              className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Address</label>
            <textarea
              value={form.address}
              onChange={e => setForm({ ...form, address: e.target.value })}
              placeholder="Full address..."
              rows={2}
              className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 resize-none"
            />
          </div>
          <div className="flex gap-2 pt-2">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border border-border rounded-lg text-sm font-medium hover:bg-muted transition">Cancel</button>
            <button type="submit" disabled={saving} className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold transition disabled:opacity-50">{saving ? 'Saving...' : 'Add Customer'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function NetCollectedBreakdownModal({ stats, onClose }: { stats: any; onClose: () => void }) {
  const [loading, setLoading] = useState(true);
  const [paymentBreakdown, setPaymentBreakdown] = useState<{ method: string; amount: number; count: number }[]>([]);
  const [refundBreakdown, setRefundBreakdown] = useState<{ method: string; amount: number; count: number }[]>([]);
  const [timeline, setTimeline] = useState<{ date: string; type: 'payment' | 'refund'; description: string; method: string; amount: number; runningNet: number }[]>([]);

  useEffect(() => {
    (async () => {
      const { data: payments } = await supabase
        .from('payments')
        .select('payment_method, amount, payment_date, notes, reference_id')
        .eq('payment_type', 'received')
        .eq('reference_type', 'invoice')
        .order('payment_date', { ascending: true });

      const { data: returns } = await supabase
        .from('sales_returns')
        .select('refund_method, total_refund_amount, created_at, return_number')
        .order('created_at', { ascending: true });

      const payMap = new Map<string, { amount: number; count: number }>();
      (payments || []).forEach((p: any) => {
        const method = p.payment_method || 'unknown';
        const existing = payMap.get(method) || { amount: 0, count: 0 };
        existing.amount += Number(p.amount);
        existing.count += 1;
        payMap.set(method, existing);
      });
      setPaymentBreakdown(Array.from(payMap.entries()).map(([method, v]) => ({ method, ...v })).sort((a, b) => b.amount - a.amount));

      const refundMap = new Map<string, { amount: number; count: number }>();
      (returns || []).forEach((r: any) => {
        const method = r.refund_method || 'unknown';
        const existing = refundMap.get(method) || { amount: 0, count: 0 };
        existing.amount += Number(r.total_refund_amount);
        existing.count += 1;
        refundMap.set(method, existing);
      });
      setRefundBreakdown(Array.from(refundMap.entries()).map(([method, v]) => ({ method, ...v })).sort((a, b) => b.amount - a.amount));

      const events: { date: string; type: 'payment' | 'refund'; description: string; method: string; amount: number }[] = [];
      (payments || []).forEach((p: any) => {
        events.push({ date: p.payment_date, type: 'payment', description: p.notes || 'Invoice payment', method: p.payment_method || 'unknown', amount: Number(p.amount) });
      });
      (returns || []).forEach((r: any) => {
        events.push({ date: r.created_at.split('T')[0], type: 'refund', description: `Sales return ${r.return_number}`, method: r.refund_method || 'unknown', amount: -Number(r.total_refund_amount) });
      });
      events.sort((a, b) => a.date.localeCompare(b.date));

      let running = 0;
      setTimeline(events.map(e => { running += e.amount; return { ...e, runningNet: running }; }));
      setLoading(false);
    })();
  }, []);

  const methodLabel = (method: string) => {
    const labels: Record<string, string> = {
      store_credit: 'Store Credit', cash: 'Cash', bank_transfer: 'Bank Transfer',
      bkash: 'bKash', nagad: 'Nagad', rocket: 'Rocket', sslcommerz: 'SSLCommerz',
      cheque: 'Cheque', card: 'Card', other: 'Other',
    };
    return labels[method] || method;
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl max-w-3xl w-full max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-border sticky top-0 bg-white z-10">
          <div>
            <h3 className="font-bold text-foreground text-lg">Net Collected Breakdown</h3>
            <p className="text-sm text-muted-foreground">How Collected becomes Net Collected</p>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-muted rounded"><X className="w-5 h-5" /></button>
        </div>

        {loading ? (
          <div className="p-8 text-center text-muted-foreground">Loading...</div>
        ) : (
          <div className="p-4 space-y-5">
            <div className="grid grid-cols-3 gap-3">
              <div className="p-3 bg-green-50 rounded-lg">
                <p className="text-xs text-muted-foreground">Collected (Gross)</p>
                <p className="text-lg font-bold text-green-600">{formatCurrency(stats.paid)}</p>
              </div>
              <div className="p-3 bg-purple-50 rounded-lg">
                <p className="text-xs text-muted-foreground">Refunded</p>
                <p className="text-lg font-bold text-purple-600">-{formatCurrency(stats.refunded)}</p>
              </div>
              <div className="p-3 bg-teal-50 rounded-lg border border-teal-100">
                <p className="text-xs text-muted-foreground">Net Collected</p>
                <p className="text-lg font-bold text-teal-600">{formatCurrency(stats.netCollected)}</p>
              </div>
            </div>

            <div>
              <p className="text-sm font-medium text-foreground mb-2 flex items-center gap-2">
                <ArrowDownCircle className="w-4 h-4 text-green-500" />
                Collected by Payment Method
              </p>
              <div className="border border-border rounded-lg overflow-hidden">
                <table className="w-full">
                  <thead className="bg-muted/30 text-xs text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">Method</th>
                      <th className="px-3 py-2 text-center font-medium">Count</th>
                      <th className="px-3 py-2 text-right font-medium">Amount</th>
                      <th className="px-3 py-2 text-right font-medium">% of Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {paymentBreakdown.length === 0 ? (
                      <tr><td colSpan={4} className="px-3 py-4 text-center text-sm text-muted-foreground">No payments recorded</td></tr>
                    ) : paymentBreakdown.map(p => (
                      <tr key={p.method}>
                        <td className="px-3 py-2 text-sm font-medium text-foreground">{methodLabel(p.method)}</td>
                        <td className="px-3 py-2 text-sm text-center text-muted-foreground">{p.count}</td>
                        <td className="px-3 py-2 text-sm text-right font-medium text-green-600">{formatCurrency(p.amount)}</td>
                        <td className="px-3 py-2 text-sm text-right text-muted-foreground">{stats.paid > 0 ? ((p.amount / stats.paid) * 100).toFixed(1) : 0}%</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-muted/30">
                    <tr>
                      <td colSpan={2} className="px-3 py-2 text-sm font-bold">Total Collected</td>
                      <td className="px-3 py-2 text-sm text-right font-bold text-green-600">{formatCurrency(stats.paid)}</td>
                      <td className="px-3 py-2 text-sm text-right font-bold">100%</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            <div>
              <p className="text-sm font-medium text-foreground mb-2 flex items-center gap-2">
                <ArrowUpCircle className="w-4 h-4 text-purple-500" />
                Refunded by Method
              </p>
              <div className="border border-border rounded-lg overflow-hidden">
                <table className="w-full">
                  <thead className="bg-muted/30 text-xs text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">Method</th>
                      <th className="px-3 py-2 text-center font-medium">Count</th>
                      <th className="px-3 py-2 text-right font-medium">Amount</th>
                      <th className="px-3 py-2 text-right font-medium">% of Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {refundBreakdown.length === 0 ? (
                      <tr><td colSpan={4} className="px-3 py-4 text-center text-sm text-muted-foreground">No refunds recorded</td></tr>
                    ) : refundBreakdown.map(r => (
                      <tr key={r.method}>
                        <td className="px-3 py-2 text-sm font-medium text-foreground">{methodLabel(r.method)}</td>
                        <td className="px-3 py-2 text-sm text-center text-muted-foreground">{r.count}</td>
                        <td className="px-3 py-2 text-sm text-right font-medium text-purple-600">-{formatCurrency(r.amount)}</td>
                        <td className="px-3 py-2 text-sm text-right text-muted-foreground">{stats.refunded > 0 ? ((r.amount / stats.refunded) * 100).toFixed(1) : 0}%</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-muted/30">
                    <tr>
                      <td colSpan={2} className="px-3 py-2 text-sm font-bold">Total Refunded</td>
                      <td className="px-3 py-2 text-sm text-right font-bold text-purple-600">-{formatCurrency(stats.refunded)}</td>
                      <td className="px-3 py-2 text-sm text-right font-bold">100%</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            <div>
              <p className="text-sm font-medium text-foreground mb-2">Balance Change History</p>
              <p className="text-xs text-muted-foreground mb-3">Chronological log of every payment and refund that changed the net collected amount</p>
              <div className="max-h-64 overflow-y-auto border border-border rounded-lg">
                {timeline.length === 0 ? (
                  <p className="px-3 py-4 text-center text-sm text-muted-foreground">No transactions recorded</p>
                ) : (
                  <div className="divide-y divide-border">
                    {timeline.map((e, i) => (
                      <div key={i} className="flex items-center gap-3 px-3 py-2 text-sm hover:bg-muted/20">
                        <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${e.type === 'payment' ? 'bg-green-50 text-green-600' : 'bg-purple-50 text-purple-600'}`}>
                          {e.type === 'payment' ? <ArrowDownCircle className="w-3.5 h-3.5" /> : <ArrowUpCircle className="w-3.5 h-3.5" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-foreground truncate">{e.description}</p>
                          <p className="text-xs text-muted-foreground">{new Date(e.date).toLocaleDateString()} - {methodLabel(e.method)}</p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className={`text-sm font-medium ${e.amount >= 0 ? 'text-green-600' : 'text-purple-600'}`}>
                            {e.amount >= 0 ? '+' : ''}{formatCurrency(e.amount)}
                          </p>
                          <p className="text-xs text-muted-foreground">Net: {formatCurrency(e.runningNet)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
