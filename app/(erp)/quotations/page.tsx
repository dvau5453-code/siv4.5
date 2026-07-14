'use client';

import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { formatCurrency, formatDate } from '@/lib/format';
import { toast } from '@/hooks/use-toast';
import { Plus, Search, Eye, Send, X, Trash2, FileText, ArrowRight, UserPlus, CreditCard, DollarSign, CircleCheck as CheckCircle, Printer, Share2, MessageCircle, Mail, Filter, ChevronDown, TriangleAlert as AlertTriangle } from 'lucide-react';
import type { Quotation, QuotationStatus, Customer, Product, ProductUnit } from '@/lib/types';
import { isMultiUnitEnabled, getDefaultSaleUnit, convertToBaseUnit } from '@/lib/unit-utils';
import ProductSearchInput from '@/components/ui/ProductSearchInput';
import ProductFilterDropdown from '@/components/ui/ProductFilterDropdown';
import PrintTemplate from '@/components/PrintTemplate';
import { printNode } from '@/lib/print';
import Pagination from '@/components/ui/AppPagination';

const statusConfig: Record<QuotationStatus, { label: string; color: string; bg: string }> = {
  draft: { label: 'Draft', color: 'text-gray-600', bg: 'bg-gray-100' },
  sent: { label: 'Sent', color: 'text-blue-600', bg: 'bg-blue-100' },
  viewed: { label: 'Viewed', color: 'text-purple-600', bg: 'bg-purple-100' },
  accepted: { label: 'Accepted', color: 'text-green-600', bg: 'bg-green-100' },
  rejected: { label: 'Rejected', color: 'text-red-600', bg: 'bg-red-100' },
  expired: { label: 'Expired', color: 'text-orange-600', bg: 'bg-orange-100' },
  converted: { label: 'Converted', color: 'text-teal-600', bg: 'bg-teal-100' },
};

interface QuotationWithCustomer extends Omit<Quotation, 'customer'> {
  customer?: { name: string; code: string };
}

export default function QuotationsPage() {
  const [quotations, setQuotations] = useState<QuotationWithCustomer[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterProduct, setFilterProduct] = useState('');
  const [filterCustomer, setFilterCustomer] = useState('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [productFilteredIds, setProductFilteredIds] = useState<Set<string> | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [viewingQuotation, setViewingQuotation] = useState<QuotationWithCustomer | null>(null);
  const [quotationItems, setQuotationItems] = useState<any[]>([]);
  const [convertingQuotation, setConvertingQuotation] = useState<QuotationWithCustomer | null>(null);
  const [companySettings, setCompanySettings] = useState<any>({});

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    setLoading(true);
    const [quoteRes, custRes, prodRes, settingsRes] = await Promise.all([
      supabase.from('quotations').select('*, customer:customers(name, code, phone, email, address)').order('created_at', { ascending: false }),
      supabase.from('customers').select('*').eq('is_active', true).order('name'),
      supabase.from('products').select(`*, units:product_units(id, product_id, unit_name, unit_short, conversion_factor, is_base_unit, is_sale_unit, price, cost_price, is_active, sort_order), inventory_items(quantity_on_hand)`).eq('is_active', true).order('name'),
      supabase.from('app_settings').select('setting_value').eq('setting_key', 'company').maybeSingle(),
    ]);
    setQuotations(quoteRes.data || []);
    setCustomers(custRes.data || []);
    setProducts(prodRes.data || []);
    setCompanySettings(settingsRes.data?.setting_value || {});
    setLoading(false);
  }

  async function viewQuotationDetails(quotation: QuotationWithCustomer) {
    const { data } = await supabase
      .from('quotation_items')
      .select('*, product:products(name, sku, unit)')
      .eq('quotation_id', quotation.id);
    setQuotationItems(data || []);
    setViewingQuotation(quotation);
  }

  async function sendQuotation(quotation: QuotationWithCustomer) {
    const { error } = await supabase
      .from('quotations')
      .update({ status: 'sent' })
      .eq('id', quotation.id);
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Success', description: 'Quotation marked as sent' });
      loadData();
    }
  }

  function initiateConvert(quotation: QuotationWithCustomer) {
    if (quotation.status === 'converted') {
      toast({ title: 'Error', description: 'Quotation already converted', variant: 'destructive' });
      return;
    }
    setViewingQuotation(null);
    setConvertingQuotation(quotation);
  }

  const filtered = quotations.filter(q => {
    if (search && !q.quote_number.toLowerCase().includes(search.toLowerCase()) && !q.customer?.name?.toLowerCase().includes(search.toLowerCase())) return false;
    if (filterStatus && q.status !== filterStatus) return false;
    if (filterCustomer && q.customer_id !== filterCustomer) return false;
    if (filterDateFrom && q.issue_date < filterDateFrom) return false;
    if (filterDateTo && q.issue_date > filterDateTo) return false;
    return true;
  });

  // Fetch product-filtered quotation IDs when filterProduct changes
  useEffect(() => {
    if (!filterProduct) {
      setProductFilteredIds(null);
      return;
    }
    supabase
      .from('quotation_items')
      .select('quotation_id')
      .eq('product_id', filterProduct)
      .then(({ data }) => {
        setProductFilteredIds(new Set((data || []).map((item: any) => item.quotation_id)));
      });
  }, [filterProduct]);

  // Apply product filter to filtered results
  const displayQuotations = productFilteredIds === null
    ? filtered
    : filtered.filter(q => productFilteredIds.has(q.id));
  const [qtPage, setQtPage] = useState(1);
  const [qtPageSize, setQtPageSize] = useState(25);
  const pagedQuotations = displayQuotations.slice((qtPage - 1) * qtPageSize, qtPage * qtPageSize);

  const stats = {
    total: quotations.length,
    sent: quotations.filter(q => q.status === 'sent' || q.status === 'viewed').length,
    accepted: quotations.filter(q => q.status === 'accepted').length,
    totalValue: quotations.filter(q => q.status !== 'expired' && q.status !== 'rejected' && q.status !== 'converted').reduce((s, q) => s + Number(q.total_amount), 0),
  };

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Quotations</h1>
          <p className="text-muted-foreground text-sm mt-0.5">Create and manage price quotations</p>
        </div>
        <button onClick={() => setShowCreateModal(true)} className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-3 sm:px-4 py-2 rounded-lg text-sm font-semibold transition shrink-0">
          <Plus className="w-4 h-4" />
          <span className="hidden sm:inline">New Quotation</span>
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Total Quotes', value: stats.total },
          { label: 'Awaiting Response', value: stats.sent },
          { label: 'Accepted', value: stats.accepted },
          { label: 'Pipeline Value', value: formatCurrency(stats.totalValue) },
        ].map(s => (
          <div key={s.label} className="stat-card">
            <p className="text-xs text-muted-foreground">{s.label}</p>
            <p className="text-xl font-bold text-foreground mt-1">{s.value}</p>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-border p-4 shadow-sm space-y-3">
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search quotations..." className="w-full pl-8 pr-4 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
          </div>
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="border border-border rounded-lg px-3 py-2 text-sm focus:outline-none">
            <option value="">All Status</option>
            {Object.entries(statusConfig).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
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
                <th className="text-left text-xs font-semibold text-muted-foreground px-4 py-3">Quote #</th>
                <th className="text-left text-xs font-semibold text-muted-foreground px-4 py-3">Customer</th>
                <th className="text-left text-xs font-semibold text-muted-foreground px-4 py-3">Issue Date</th>
                <th className="text-left text-xs font-semibold text-muted-foreground px-4 py-3">Expiry</th>
                <th className="text-right text-xs font-semibold text-muted-foreground px-4 py-3">Amount</th>
                <th className="text-left text-xs font-semibold text-muted-foreground px-4 py-3">Status</th>
                <th className="text-right text-xs font-semibold text-muted-foreground px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? Array.from({ length: 5 }).map((_, i) => (
                <tr key={i}>{Array.from({ length: 7 }).map((_, j) => <td key={j} className="px-4 py-3"><div className="h-4 bg-muted rounded animate-pulse" /></td>)}</tr>
              )) : displayQuotations.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-12 text-center text-muted-foreground text-sm">No quotations found</td></tr>
              ) : pagedQuotations.map((q) => {
                const cfg = statusConfig[q.status as QuotationStatus] || statusConfig.draft;
                return (
                  <tr key={q.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3"><span className="text-sm font-semibold text-blue-600">{q.quote_number}</span></td>
                    <td className="px-4 py-3 text-sm text-foreground">{q.customer?.name || '-'}</td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">{formatDate(q.issue_date)}</td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">{q.expiry_date ? formatDate(q.expiry_date) : '-'}</td>
                    <td className="px-4 py-3 text-right text-sm font-semibold text-foreground">{formatCurrency(q.total_amount)}</td>
                    <td className="px-4 py-3"><span className={`badge-status ${cfg.bg} ${cfg.color}`}>{cfg.label}</span></td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => viewQuotationDetails(q)} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-blue-50 text-muted-foreground hover:text-blue-600 transition"><Eye className="w-3.5 h-3.5" /></button>
                        {q.status === 'draft' && (
                          <button onClick={() => sendQuotation(q)} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-green-50 text-muted-foreground hover:text-green-600 transition"><Send className="w-3.5 h-3.5" /></button>
                        )}
                        {q.status !== 'converted' && q.status !== 'rejected' && q.status !== 'expired' && (
                          <button onClick={() => initiateConvert(q)} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-teal-50 text-muted-foreground hover:text-teal-600 transition" title="Convert to Invoice"><ArrowRight className="w-3.5 h-3.5" /></button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <Pagination
          page={qtPage}
          pageSize={qtPageSize}
          total={displayQuotations.length}
          onPageChange={setQtPage}
          onPageSizeChange={(s) => { setQtPageSize(s); setQtPage(1); }}
        />
      </div>

      {showCreateModal && (
        <CreateQuotationModal
          customers={customers}
          products={products}
          onClose={() => setShowCreateModal(false)}
          onSaved={() => { loadData(); }}
        />
      )}

      {viewingQuotation && (
        <ViewQuotationModal
          quotation={viewingQuotation}
          items={quotationItems}
          onClose={() => setViewingQuotation(null)}
          onConvert={() => initiateConvert(viewingQuotation)}
          companySettings={companySettings}
        />
      )}

      {convertingQuotation && (
        <ConvertToInvoiceModal
          quotation={convertingQuotation}
          onClose={() => setConvertingQuotation(null)}
          onConverted={() => { setConvertingQuotation(null); loadData(); }}
        />
      )}
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

    if (insertError) { setError(insertError.message); setSaving(false); return; }

    toast({ title: 'Success', description: 'Customer added successfully' });
    onSaved(data.id);
    onClose();
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4" style={{ zIndex: 60 }}>
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-base font-bold flex items-center gap-2"><UserPlus className="w-4 h-4" />Add New Customer</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSave} className="p-4 space-y-3">
          {error && <div className="p-3 bg-red-50 text-red-600 rounded-lg text-sm">{error}</div>}
          <div>
            <label className="block text-xs font-medium mb-1">Customer Name *</label>
            <input required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Enter customer name..." className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">Phone</label>
              <input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="Phone number..." className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Type</label>
              <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value as any })} className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none">
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
            <input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="Email address..." className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Address</label>
            <textarea value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} placeholder="Full address..." rows={2} className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 resize-none" />
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

function CreateQuotationModal({ customers: initialCustomers, products, onClose, onSaved }: {
  customers: Customer[];
  products: Product[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [customers, setCustomers] = useState<Customer[]>(initialCustomers);
  const [form, setForm] = useState({
    customer_id: '',
    issue_date: new Date().toISOString().split('T')[0],
    expiry_date: '',
    notes: '',
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
    discount_percent: number;
    selected_unit?: ProductUnit;
    available_units?: ProductUnit[];
    base_quantity: number;
    cost_price: number;
  }[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [showAddCustomer, setShowAddCustomer] = useState(false);
  const [formTab, setFormTab] = useState<'items' | 'cost'>('items');

  function addProductToItems(product: any) {
    const multiUnit = product.enable_multi_unit && product.units && product.units.filter((u: any) => u.is_active).length > 0;
    const defaultUnit: ProductUnit | undefined = multiUnit ? getDefaultSaleUnit(product) : undefined;
    const unitPrice = defaultUnit ? defaultUnit.price : (product.sale_price || 0);
    const costPrice = defaultUnit ? (defaultUnit.cost_price || product.cost_price || 0) : (product.cost_price || 0);
    const baseQty = defaultUnit ? convertToBaseUnit(1, defaultUnit) : 1;
    const stock = product.inventory_items?.reduce((s: number, i: any) => s + Number(i.quantity_on_hand), 0) ?? null;

    // Show warning for out of stock items (quotations can still proceed, just warn)
    if (stock !== null && stock <= 0) {
      toast({ title: 'Warning', description: `${product.name} is currently out of stock`, variant: 'destructive' });
    }

    const existingIndex = items.findIndex(i => i.product_id === product.id && (i.selected_unit?.id ?? '') === (defaultUnit?.id ?? ''));
    if (existingIndex >= 0) {
      const updated = [...items];
      const ex = updated[existingIndex];
      const newQty = ex.quantity + 1;
      const newBase = ex.selected_unit ? convertToBaseUnit(newQty, ex.selected_unit) : newQty;
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
      discount_percent: 0,
      selected_unit: defaultUnit,
      available_units: multiUnit ? product.units.filter((u: any) => u.is_active) : undefined,
      base_quantity: baseQty,
      cost_price: costPrice,
    }]);
  }

  function updateItem(index: number, field: string, value: any) {
    const updated = [...items];
    if (field === 'selected_unit') {
      const unit = value as ProductUnit;
      updated[index] = {
        ...updated[index],
        selected_unit: unit,
        unit_price: unit.price,
        cost_price: unit.cost_price || updated[index].cost_price || 0,
        base_quantity: convertToBaseUnit(updated[index].quantity, unit),
      };
    } else if (field === 'quantity') {
      const qty = parseInt(value) || 1;
      const unit = updated[index].selected_unit;
      updated[index] = { ...updated[index], quantity: qty, base_quantity: unit ? convertToBaseUnit(qty, unit) : qty };
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
    return sum + (item.quantity * item.unit_price * (1 - item.discount_percent / 100));
  }, 0);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!form.customer_id) { setError('Please select a customer'); return; }
    if (items.length === 0) { setError('Please add at least one item'); return; }

    setSaving(true);
    setError('');

    const { data: qNum, error: qNumError } = await supabase.rpc('generate_quotation_number');
    if (qNumError) { setError('Failed to generate quotation number: ' + qNumError.message); setSaving(false); return; }
    const quoteNumber = qNum as string;

    const { data: quote, error: quoteError } = await supabase
      .from('quotations')
      .insert({
        quote_number: quoteNumber,
        customer_id: form.customer_id,
        issue_date: form.issue_date,
        expiry_date: form.expiry_date || null,
        subtotal,
        discount_amount: 0,
        tax_amount: 0,
        total_amount: subtotal,
        status: 'draft',
        notes: form.notes || null,
      })
      .select()
      .single();

    if (quoteError) { setError(quoteError.message); setSaving(false); return; }

    const quoteItems = items.map(item => {
      const discount = (item.unit_price * item.quantity * item.discount_percent) / 100;
      return {
        quotation_id: quote.id,
        product_id: item.product_id,
        quantity: item.quantity,
        unit_price: item.unit_price,
        discount_percent: item.discount_percent,
        tax_rate: 0,
        subtotal: item.quantity * item.unit_price - discount,
        unit_name: item.selected_unit?.unit_name || (item as any).product_unit || null,
        unit_conversion_factor: item.selected_unit?.conversion_factor,
        base_quantity: item.base_quantity,
      };
    });

    const { error: itemsError } = await supabase.from('quotation_items').insert(quoteItems);
    if (itemsError) { setError(itemsError.message); setSaving(false); return; }

    // Record cost price history snapshot for each item at time of quotation
    const costHistoryRecords = items.map(item => {
      const unitName = item.selected_unit?.unit_name || item.product_unit || 'pcs';
      const costPerUnit = item.cost_price || 0;
      const totalCostAdded = costPerUnit * item.quantity;
      return {
        product_id: item.product_id,
        product_name: item.product_name,
        product_sku: item.product_sku || '',
        quotation_id: quote.id,
        unit: unitName,
        quantity: item.quantity,
        unit_price: item.unit_price,
        cost_price_per_qty: costPerUnit,
        cost_price_for_added_qty: totalCostAdded,
        total_cost_price_single: costPerUnit,
        total_cost_price_added: totalCostAdded,
      };
    });
    if (costHistoryRecords.length > 0) {
      await supabase.from('cost_price_history').insert(costHistoryRecords);
    }

    toast({ title: 'Success', description: 'Quotation created successfully' });
    onSaved();
    onClose();
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-2xl w-full max-w-3xl shadow-2xl max-h-[90vh] overflow-y-auto">
          <div className="flex items-center justify-between px-6 py-4 border-b border-border sticky top-0 bg-white z-10">
            <h2 className="text-base font-bold">Create Quotation</h2>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
          </div>
          <form onSubmit={handleSave} className="p-6 space-y-4">
            {error && <div className="p-3 bg-red-50 text-red-600 rounded-lg text-sm">{error}</div>}

            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium mb-1">Customer *</label>
                <div className="flex gap-1.5">
                  <select required value={form.customer_id} onChange={e => setForm({ ...form, customer_id: e.target.value })} className="flex-1 min-w-0 border border-border rounded-lg px-3 py-2 text-sm focus:outline-none">
                    <option value="">Select customer</option>
                    {customers.map(c => <option key={c.id} value={c.id}>{c.name} ({c.code})</option>)}
                  </select>
                  <button
                    type="button"
                    onClick={() => setShowAddCustomer(true)}
                    title="Add new customer"
                    className="flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-lg border border-border hover:bg-blue-50 hover:border-blue-300 hover:text-blue-600 text-muted-foreground transition"
                  >
                    <UserPlus className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Issue Date</label>
                <input type="date" value={form.issue_date} onChange={e => setForm({ ...form, issue_date: e.target.value })} className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Expiry Date</label>
                <input type="date" value={form.expiry_date} onChange={e => setForm({ ...form, expiry_date: e.target.value })} className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
              </div>
            </div>

            <div>
              <div className="flex items-center gap-1 mb-3 border-b border-border">
                <button type="button" onClick={() => setFormTab('items')} className={`px-3 py-2 text-xs font-semibold border-b-2 -mb-px transition ${formTab === 'items' ? 'border-blue-600 text-blue-600' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>Line Items</button>
                <button type="button" onClick={() => setFormTab('cost')} className={`px-3 py-2 text-xs font-semibold border-b-2 -mb-px transition flex items-center gap-1.5 ${formTab === 'cost' ? 'border-blue-600 text-blue-600' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>Cost Price History {items.length > 0 && <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${formTab === 'cost' ? 'bg-blue-100 text-blue-700' : 'bg-muted text-muted-foreground'}`}>{items.length}</span>}</button>
              </div>

              {formTab === 'items' && (
              <>
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
                      <th className="text-right text-xs font-semibold text-muted-foreground px-3 py-2 w-20">Disc%</th>
                      <th className="text-right text-xs font-semibold text-muted-foreground px-3 py-2 w-28">Total</th>
                      <th className="w-8"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {items.map((item, index) => {
                      const isOverStock = item.stock_qty !== null && item.base_quantity > item.stock_qty;
                      return (
                        <tr key={index} className={isOverStock ? 'bg-red-50/50' : ''}>
                          <td className="px-3 py-2">
                            <p className="text-sm font-medium text-foreground">{item.product_name}</p>
                            <p className="text-[10px] text-muted-foreground">{item.product_sku}</p>
                            {item.stock_qty !== null && (
                              <p className={`text-[10px] font-medium ${item.stock_qty > 0 ? (isOverStock ? 'text-red-500' : 'text-green-600') : 'text-red-500'}`}>
                                {item.stock_qty > 0 ? `${item.stock_qty} ${item.product_base_unit || 'units'} in stock` : 'Out of stock'}
                                {isOverStock && <span className="ml-1"><AlertTriangle className="w-3 h-3 inline" /></span>}
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
                            <input type="number" min="1" value={item.quantity} onChange={e => updateItem(index, 'quantity', e.target.value)} className={`w-full border rounded px-2 py-1 text-sm text-right focus:outline-none ${isOverStock ? 'border-red-300 bg-red-50' : 'border-border'}`} />
                            {item.available_units && item.selected_unit && (
                              <p className="text-[10px] text-muted-foreground text-center mt-0.5">= {item.base_quantity} {item.product_base_unit || 'base'}</p>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <input type="number" min="0" step="0.01" value={item.unit_price} onChange={e => updateItem(index, 'unit_price', e.target.value)} className="w-full border border-border rounded px-2 py-1 text-sm text-right focus:outline-none" />
                          </td>
                          <td className="px-3 py-2">
                            <input type="number" min="0" max="100" value={item.discount_percent} onChange={e => updateItem(index, 'discount_percent', e.target.value)} className="w-full border border-border rounded px-2 py-1 text-sm text-right focus:outline-none" />
                          </td>
                          <td className="px-3 py-2 text-right text-sm font-semibold">{formatCurrency(item.quantity * item.unit_price * (1 - item.discount_percent / 100))}</td>
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
              </>
              )}

              {formTab === 'cost' && (
                <div className="space-y-3">
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-800">
                    This tab records the cost price of each product in this quotation at the time it was created. When the quotation is saved, this snapshot is stored permanently in the cost price history for future reference.
                  </div>
                  {items.length === 0 ? (
                    <div className="text-center py-12 text-muted-foreground">
                      <p className="text-sm">No products added yet. Add products in the Line Items tab to see their cost prices.</p>
                    </div>
                  ) : (
                    <div className="border border-border rounded-lg overflow-hidden">
                      <table className="w-full">
                        <thead className="bg-muted/40">
                          <tr>
                            <th className="text-left text-xs font-semibold text-muted-foreground px-3 py-2">Product</th>
                            <th className="text-left text-xs font-semibold text-muted-foreground px-3 py-2">Unit</th>
                            <th className="text-right text-xs font-semibold text-muted-foreground px-3 py-2">Qty</th>
                            <th className="text-right text-xs font-semibold text-muted-foreground px-3 py-2">Cost / 1 Qty</th>
                            <th className="text-right text-xs font-semibold text-muted-foreground px-3 py-2">Total Cost (Single)</th>
                            <th className="text-right text-xs font-semibold text-muted-foreground px-3 py-2">Total Cost (Added Qty)</th>
                            <th className="text-left text-xs font-semibold text-muted-foreground px-3 py-2">Recorded At</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {items.map((item, index) => {
                            const unitName = item.selected_unit?.unit_name || item.product_unit || 'pcs';
                            const costPerUnit = item.cost_price || 0;
                            const totalCostSingle = costPerUnit;
                            const totalCostAdded = costPerUnit * item.quantity;
                            return (
                              <tr key={index} className="hover:bg-muted/20">
                                <td className="px-3 py-2">
                                  <p className="text-sm font-medium text-foreground">{item.product_name}</p>
                                  <p className="text-[10px] text-muted-foreground">{item.product_sku}</p>
                                </td>
                                <td className="px-3 py-2 text-sm text-foreground">{unitName}</td>
                                <td className="px-3 py-2 text-right text-sm text-foreground">{item.quantity}</td>
                                <td className="px-3 py-2 text-right text-sm text-foreground">{formatCurrency(costPerUnit)}</td>
                                <td className="px-3 py-2 text-right text-sm text-foreground">{formatCurrency(totalCostSingle)}</td>
                                <td className="px-3 py-2 text-right text-sm font-semibold text-foreground">{formatCurrency(totalCostAdded)}</td>
                                <td className="px-3 py-2 text-xs text-muted-foreground">{new Date().toLocaleString()}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                        <tfoot className="bg-muted/30">
                          <tr>
                            <td colSpan={5} className="px-3 py-2 text-right text-xs font-semibold text-muted-foreground">Total Cost:</td>
                            <td className="px-3 py-2 text-right text-sm font-bold text-foreground">{formatCurrency(items.reduce((s, i) => s + (i.cost_price || 0) * i.quantity, 0))}</td>
                            <td></td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex justify-end bg-muted/30 rounded-lg p-3">
              <div className="text-right">
                <p className="text-xs text-muted-foreground">Total</p>
                <p className="text-lg font-bold text-foreground">{formatCurrency(subtotal)}</p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button type="button" onClick={onClose} className="px-4 py-2 border border-border rounded-lg text-sm hover:bg-muted transition">Cancel</button>
              <button type="submit" disabled={saving} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold transition disabled:opacity-60">
                {saving ? 'Creating...' : 'Create Quotation'}
              </button>
            </div>
          </form>
        </div>
      </div>

      {showAddCustomer && (
        <AddCustomerModal
          onClose={() => setShowAddCustomer(false)}
          onSaved={(id) => {
            supabase.from('customers').select('*').eq('is_active', true).order('name').then(({ data }) => {
              if (data) setCustomers(data);
            });
            setForm(f => ({ ...f, customer_id: id }));
            setShowAddCustomer(false);
          }}
        />
      )}
    </>
  );
}

function ConvertToInvoiceModal({ quotation, onClose, onConverted }: {
  quotation: QuotationWithCustomer;
  onClose: () => void;
  onConverted: () => void;
}) {
  const [paymentMethods, setPaymentMethods] = useState<{ code: string; name: string }[]>([]);
  const [form, setForm] = useState({
    payment_type: 'credit' as 'credit' | 'partial' | 'full',
    payment_method: 'cash',
    amount_paid: 0,
    reference_number: '',
    notes: '',
    invoice_date: new Date().toISOString().split('T')[0],
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    supabase.from('payment_methods').select('code, name').eq('is_active', true).order('sort_order')
      .then(({ data }) => { if (data) setPaymentMethods(data); });
  }, []);

  const totalAmount = Number(quotation.total_amount);

  const effectiveAmountPaid =
    form.payment_type === 'credit' ? 0 :
    form.payment_type === 'full' ? totalAmount :
    form.amount_paid;

  const balanceDue = totalAmount - effectiveAmountPaid;

  const invoiceStatus =
    form.payment_type === 'full' ? 'paid' :
    form.payment_type === 'partial' && effectiveAmountPaid > 0 ? 'partially_paid' :
    form.payment_type === 'credit' ? 'sent' :
    'draft';

  async function handleConvert(e: React.FormEvent) {
    e.preventDefault();
    if (form.payment_type === 'partial' && (form.amount_paid <= 0 || form.amount_paid >= totalAmount)) {
      setError('Partial payment amount must be greater than 0 and less than the total amount');
      return;
    }

    setSaving(true);
    setError('');

    // Fetch quotation items with product info and stock
    const { data: items } = await supabase
      .from('quotation_items')
      .select('*, product:products(cost_price, name)')
      .eq('quotation_id', quotation.id);

    // Validate stock before conversion
    const stockChecks = await Promise.all(
      (items || []).map(async (item: any) => {
        const { data: invItems } = await supabase
          .from('inventory_items')
          .select('quantity_on_hand')
          .eq('product_id', item.product_id);
        const totalStock = (invItems || []).reduce((s: number, i: any) => s + Number(i.quantity_on_hand), 0);
        const baseQty = (item as any).base_quantity || item.quantity;
        return { item, totalStock, baseQty, productName: Array.isArray(item.product) ? item.product[0]?.name : item.product?.name };
      })
    );

    const insufficientItems = stockChecks.filter(s => s.baseQty > s.totalStock);
    if (insufficientItems.length > 0) {
      setError(`Insufficient stock for: ${insufficientItems.map(s => `${s.productName} (need ${s.baseQty}, have ${s.totalStock})`).join(', ')}`);
      setSaving(false);
      return;
    }

    const { data: invoiceNum, error: numError } = await supabase.rpc('generate_invoice_number');
    if (numError) { setError('Failed to generate invoice number: ' + numError.message); setSaving(false); return; }
    const invoiceNumber = invoiceNum as string;

    const { data: invoice, error: invError } = await supabase
      .from('invoices')
      .insert({
        invoice_number: invoiceNumber,
        customer_id: quotation.customer_id,
        quotation_id: quotation.id,
        invoice_date: form.invoice_date,
        subtotal: quotation.subtotal,
        discount_amount: quotation.discount_amount,
        tax_amount: quotation.tax_amount,
        total_amount: totalAmount,
        amount_paid: effectiveAmountPaid,
        status: invoiceStatus,
        is_pos: false,
      })
      .select()
      .single();

    if (invError) { setError(invError.message); setSaving(false); return; }

    if (items && items.length > 0) {
      const invoiceItems = items.map((item: any) => ({
        invoice_id: invoice.id,
        product_id: item.product_id,
        quantity: item.quantity,
        unit_price: item.unit_price,
        cost_price: (Array.isArray(item.product) ? item.product[0]?.cost_price : item.product?.cost_price) || 0,
        discount_percent: item.discount_percent || 0,
        tax_rate: item.tax_rate || 0,
        subtotal: item.subtotal,
        unit_name: (item as any).unit_name || null,
        unit_conversion_factor: (item as any).unit_conversion_factor || null,
        base_quantity: (item as any).base_quantity || item.quantity,
      }));
      await supabase.from('invoice_items').insert(invoiceItems);
    }

    if (effectiveAmountPaid > 0) {
      const paymentNumber = `PAY-${Date.now().toString().slice(-6)}`;
      await supabase.from('payments').insert({
        payment_number: paymentNumber,
        payment_type: 'received',
        reference_type: 'invoice',
        reference_id: invoice.id,
        customer_id: quotation.customer_id,
        amount: effectiveAmountPaid,
        payment_method: form.payment_method,
        payment_date: form.invoice_date,
        reference_number: form.reference_number || null,
        notes: form.notes || (form.payment_type === 'full' ? 'Full payment at invoice conversion' : 'Partial payment at invoice conversion'),
      });
    }

    const { data: customer } = await supabase
      .from('customers')
      .select('outstanding_balance, total_purchases')
      .eq('id', quotation.customer_id)
      .single();

    if (customer) {
      await supabase
        .from('customers')
        .update({
          outstanding_balance: (customer.outstanding_balance || 0) + balanceDue,
          total_purchases: (customer.total_purchases || 0) + totalAmount,
          updated_at: new Date().toISOString(),
        })
        .eq('id', quotation.customer_id);
    }

    await supabase.from('quotations').update({ status: 'converted' }).eq('id', quotation.id);

    toast({ title: 'Success', description: `Invoice ${invoiceNumber} created from quotation` });
    onConverted();
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border sticky top-0 bg-white z-10">
          <div>
            <h2 className="text-base font-bold">Convert to Invoice</h2>
            <p className="text-xs text-muted-foreground mt-0.5">{quotation.quote_number} &rarr; {quotation.customer?.name}</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>

        <form onSubmit={handleConvert} className="p-6 space-y-5">
          {error && <div className="p-3 bg-red-50 text-red-600 rounded-lg text-sm">{error}</div>}

          <div className="bg-muted/30 rounded-lg p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground">Invoice Amount</p>
              <p className="text-2xl font-bold text-foreground">{formatCurrency(totalAmount)}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-muted-foreground">Invoice Date</p>
              <input type="date" value={form.invoice_date} onChange={e => setForm({ ...form, invoice_date: e.target.value })} className="border border-border rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 mt-0.5" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium mb-3">Payment Type *</label>
            <div className="grid grid-cols-3 gap-3">
              <button
                type="button"
                onClick={() => setForm({ ...form, payment_type: 'credit', amount_paid: 0 })}
                className={`p-3 border rounded-lg text-center transition ${form.payment_type === 'credit' ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-border hover:border-gray-300 text-foreground'}`}
              >
                <CreditCard className="w-5 h-5 mx-auto mb-1" />
                <p className="text-xs font-medium">Full Credit</p>
                <p className="text-[10px] text-muted-foreground">Pay later</p>
              </button>
              <button
                type="button"
                onClick={() => setForm({ ...form, payment_type: 'partial', amount_paid: 0 })}
                className={`p-3 border rounded-lg text-center transition ${form.payment_type === 'partial' ? 'border-amber-500 bg-amber-50 text-amber-700' : 'border-border hover:border-gray-300 text-foreground'}`}
              >
                <DollarSign className="w-5 h-5 mx-auto mb-1" />
                <p className="text-xs font-medium">Partial</p>
                <p className="text-[10px] text-muted-foreground">Pay some now</p>
              </button>
              <button
                type="button"
                onClick={() => setForm({ ...form, payment_type: 'full', amount_paid: totalAmount })}
                className={`p-3 border rounded-lg text-center transition ${form.payment_type === 'full' ? 'border-green-600 bg-green-50 text-green-700' : 'border-border hover:border-gray-300 text-foreground'}`}
              >
                <CheckCircle className="w-5 h-5 mx-auto mb-1" />
                <p className="text-xs font-medium">Full Payment</p>
                <p className="text-[10px] text-muted-foreground">Pay all now</p>
              </button>
            </div>
          </div>

          {form.payment_type !== 'credit' && (
            <div className="space-y-4 border border-border rounded-lg p-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium mb-1">Payment Method *</label>
                  <select value={form.payment_method} onChange={e => setForm({ ...form, payment_method: e.target.value })} className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none">
                    {paymentMethods.length > 0
                      ? paymentMethods.map(m => <option key={m.code} value={m.code}>{m.name}</option>)
                      : <>
                          <option value="cash">Cash</option>
                          <option value="bank_transfer">Bank Transfer</option>
                          <option value="cheque">Cheque</option>
                          <option value="card">Card</option>
                          <option value="mobile_banking">Mobile Banking</option>
                        </>
                    }
                  </select>
                </div>
                {form.payment_type === 'partial' && (
                  <div>
                    <label className="block text-xs font-medium mb-1">Amount Paid *</label>
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      max={totalAmount - 0.01}
                      value={form.amount_paid}
                      onChange={e => setForm({ ...form, amount_paid: parseFloat(e.target.value) || 0 })}
                      className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                    />
                  </div>
                )}
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Reference Number</label>
                <input value={form.reference_number} onChange={e => setForm({ ...form, reference_number: e.target.value })} placeholder="Cheque no., transaction ID..." className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Notes</label>
                <input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="Optional payment notes..." className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
              </div>
            </div>
          )}

          <div className="bg-muted/30 rounded-lg p-3 space-y-1.5 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Total Amount</span>
              <span className="font-semibold">{formatCurrency(totalAmount)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Amount Paid</span>
              <span className={`font-semibold ${effectiveAmountPaid > 0 ? 'text-green-600' : 'text-muted-foreground'}`}>{formatCurrency(effectiveAmountPaid)}</span>
            </div>
            <div className="flex justify-between border-t border-border pt-1.5">
              <span className="font-medium">Balance Due</span>
              <span className={`font-bold ${balanceDue > 0 ? 'text-red-600' : 'text-green-600'}`}>{formatCurrency(balanceDue)}</span>
            </div>
          </div>

          <div className="flex items-center justify-end gap-3">
            <button type="button" onClick={onClose} className="px-4 py-2 border border-border rounded-lg text-sm hover:bg-muted transition">Cancel</button>
            <button type="submit" disabled={saving} className="flex items-center gap-2 px-5 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-semibold transition disabled:opacity-60">
              <FileText className="w-4 h-4" />
              {saving ? 'Converting...' : 'Convert to Invoice'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ViewQuotationModal({ quotation, items, onClose, onConvert, companySettings }: {
  quotation: QuotationWithCustomer;
  items: any[];
  onClose: () => void;
  onConvert: () => void;
  companySettings: any;
}) {
  const cfg = statusConfig[quotation.status as QuotationStatus] || statusConfig.draft;
  const printRef = useRef<HTMLDivElement>(null);

  function buildShareText() {
    const lines = [
      `*QUOTATION ${quotation.quote_number}*`,
      `From: ${companySettings?.name || 'Our Company'}`,
      `Date: ${formatDate(quotation.issue_date)}`,
      `Valid Until: ${quotation.expiry_date ? formatDate(quotation.expiry_date) : 'N/A'}`,
      '',
      'Items:',
      ...items.map((item: any, i: number) => `${i + 1}. ${item.product?.name || 'Item'} — Qty: ${item.quantity} ${item.unit_name || ''} — ${formatCurrency(item.subtotal)}`),
      '',
      `Total: ${formatCurrency(quotation.total_amount)}`,
      '',
      'Thank you for your interest!',
    ];
    return lines.join('\n');
  }

  function shareWhatsApp() {
    const phone = (quotation.customer as any)?.phone?.replace(/[^0-9]/g, '');
    const text = encodeURIComponent(buildShareText());
    const url = phone
      ? `https://wa.me/${phone}?text=${text}`
      : `https://wa.me/?text=${text}`;
    window.open(url, '_blank');
  }

  function shareEmail() {
    const email = (quotation.customer as any)?.email || '';
    const subject = encodeURIComponent(`Quotation ${quotation.quote_number} from ${companySettings?.name || 'Our Company'}`);
    const body = encodeURIComponent(buildShareText());
    window.location.href = `mailto:${email}?subject=${subject}&body=${body}`;
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="print-modal bg-white rounded-2xl w-full max-w-3xl shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="no-print flex items-center justify-between px-6 py-3 border-b border-border sticky top-0 bg-white z-10">
          <span className="text-sm font-semibold text-muted-foreground">Quotation Preview</span>
          <div className="flex items-center gap-2">
            <button onClick={shareWhatsApp} className="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium transition">
              <MessageCircle className="w-3.5 h-3.5" />WhatsApp
            </button>
            <button onClick={shareEmail} className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition">
              <Mail className="w-3.5 h-3.5" />Email
            </button>
            <button onClick={() => printNode(printRef.current)} className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-700 hover:bg-slate-800 text-white rounded-lg text-sm font-medium transition">
              <Printer className="w-3.5 h-3.5" />Print
            </button>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1"><X className="w-5 h-5" /></button>
          </div>
        </div>

        <div className="p-8" ref={printRef}>
          <PrintTemplate
            docType="QUOTATION"
            docNumber={quotation.quote_number}
            docDate={quotation.issue_date}
            expiryDate={quotation.expiry_date || undefined}
            status={cfg.label}
            company={{
              name: companySettings.name || 'Your Company',
              address: companySettings.address,
              phone: companySettings.phone,
              email: companySettings.email,
              logo_url: companySettings.logo_url,
            }}
            customer={{
              name: quotation.customer?.name || '—',
              code: quotation.customer?.code,
              phone: (quotation.customer as any)?.phone,
              address: (quotation.customer as any)?.address,
            }}
            items={items.map((item: any) => ({
              product_name: item.product?.name || '—',
              product_sku: item.product?.sku,
              quantity: item.quantity,
              unit_price: item.unit_price,
              discount_percent: item.discount_percent || 0,
              subtotal: item.subtotal,
              unit_name: item.unit_name || item.product?.unit || null,
            }))}
            subtotal={Number(quotation.subtotal)}
            discountTotal={items.reduce((s, item: any) => s + (item.quantity * item.unit_price * (item.discount_percent || 0) / 100), 0)}
            totalAmount={Number(quotation.total_amount)}
            notes={(quotation as any).notes}
          />
        </div>

        {quotation.status !== 'converted' && quotation.status !== 'rejected' && quotation.status !== 'expired' && (
          <div className="no-print flex items-center justify-end px-8 py-4 border-t border-border">
            <button onClick={onConvert} className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-semibold transition">
              <FileText className="w-4 h-4" />Convert to Invoice
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
