'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { formatCurrency, formatDate } from '@/lib/format';
import { toast } from '@/hooks/use-toast';
import { ShoppingCart, Plus, Search, Eye, X, Trash2, TrendingUp, Clock, CircleCheck as CheckCircle2, CircleAlert as AlertCircle, Printer, DollarSign, Send, CreditCard, UserPlus, RotateCcw, Package } from 'lucide-react';
import type { Invoice, InvoiceStatus, Customer, Product, Payment, PaymentMethod, ProductUnit } from '@/lib/types';
import { isMultiUnitEnabled, getDefaultSaleUnit, convertToBaseUnit } from '@/lib/unit-utils';
import ProductSearchInput from '@/components/ui/ProductSearchInput';

const statusConfig: Record<InvoiceStatus, { label: string; color: string; bg: string }> = {
  draft: { label: 'Draft', color: 'text-gray-600', bg: 'bg-gray-100' },
  sent: { label: 'Sent', color: 'text-blue-600', bg: 'bg-blue-100' },
  partially_paid: { label: 'Partial', color: 'text-amber-600', bg: 'bg-amber-100' },
  paid: { label: 'Paid', color: 'text-green-600', bg: 'bg-green-100' },
  overdue: { label: 'Overdue', color: 'text-red-600', bg: 'bg-red-100' },
  cancelled: { label: 'Cancelled', color: 'text-gray-600', bg: 'bg-gray-100' },
  refunded: { label: 'Refunded', color: 'text-purple-600', bg: 'bg-purple-100' },
};

interface InvoiceWithCustomer extends Omit<Invoice, 'customer'> {
  customer?: { name: string; code: string; phone?: string; address?: string };
  sales_returns?: { id: string; return_number: string; total_refund_amount: number; items: { quantity_returned: number }[] }[];
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
  const [invoices, setInvoices] = useState<InvoiceWithCustomer[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [stats, setStats] = useState({ total: 0, paid: 0, outstanding: 0, overdue: 0 });
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [viewingInvoice, setViewingInvoice] = useState<InvoiceWithCustomer | null>(null);
  const [invoiceItems, setInvoiceItems] = useState<any[]>([]);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentInvoice, setPaymentInvoice] = useState<InvoiceWithCustomer | null>(null);
  const [companySettings, setCompanySettings] = useState<any>({ name: '', address: '', phone: '', email: '', logo_url: '' });

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    setLoading(true);
    const [invRes, custRes, prodRes, settingsRes, returnsRes] = await Promise.all([
      supabase.from('invoices').select('*, customer:customers(name, code, phone, address)').order('created_at', { ascending: false }),
      supabase.from('customers').select('*').eq('is_active', true).order('name'),
      supabase.from('products').select(`*, units:product_units(id, product_id, unit_name, unit_short, conversion_factor, is_base_unit, is_sale_unit, price, cost_price, is_active, sort_order), inventory_items(quantity_on_hand)`).eq('is_active', true).order('name'),
      supabase.from('app_settings').select('setting_value').eq('setting_key', 'company').maybeSingle(),
      supabase.from('sales_returns').select('id, invoice_id, return_number, total_refund_amount, items:sales_return_items(quantity_returned)'),
    ]);

    // Attach sales returns to their corresponding invoices
    const returnsMap = new Map<string, any[]>();
    (returnsRes.data || []).forEach((ret: any) => {
      const existing = returnsMap.get(ret.invoice_id) || [];
      existing.push(ret);
      returnsMap.set(ret.invoice_id, existing);
    });

    const invoicesWithReturns = (invRes.data || []).map((inv: any) => ({
      ...inv,
      sales_returns: returnsMap.get(inv.id) || []
    }));

    setInvoices(invoicesWithReturns);
    setCustomers(custRes.data || []);
    setProducts(prodRes.data || []);
    if (settingsRes.data?.setting_value) setCompanySettings(settingsRes.data.setting_value);

    const allInv = invoicesWithReturns;
    setStats({
      total: allInv.reduce((s: number, i: any) => s + Number(i.total_amount), 0),
      paid: allInv.filter((i: any) => i.status === 'paid').reduce((s: number, i: any) => s + Number(i.total_amount), 0),
      outstanding: allInv.reduce((s: number, i: any) => s + Number(i.balance_due || 0), 0),
      overdue: allInv.filter((i: any) => i.status === 'overdue').length,
    });
    setLoading(false);
  }

  async function viewInvoiceDetails(invoice: InvoiceWithCustomer) {
    const { data } = await supabase
      .from('invoice_items')
      .select('*, product:products(name, sku, unit)')
      .eq('invoice_id', invoice.id);
    setInvoiceItems(data || []);
    setViewingInvoice(invoice);
  }

  function ViewInvoiceModal({ invoice, items, onClose, onRecordPayment, onUpdateStatus }: {
    invoice: InvoiceWithCustomer;
    items: any[];
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

          {/* Invoice body */}
          <div className="p-8 space-y-8">

            {/* Header: Company + INVOICE title */}
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-4">
                {companySettings.logo_url && (
                  <img src={companySettings.logo_url} alt="Logo" className="h-14 w-14 object-contain rounded-lg" />
                )}
                <div>
                  <h1 className="text-xl font-bold text-foreground">{companySettings.name || 'Your Company'}</h1>
                  {companySettings.address && <p className="text-xs text-muted-foreground mt-0.5 max-w-xs">{companySettings.address}</p>}
                  <div className="flex flex-wrap gap-3 mt-1">
                    {companySettings.phone && <p className="text-xs text-muted-foreground">{companySettings.phone}</p>}
                    {companySettings.email && <p className="text-xs text-muted-foreground">{companySettings.email}</p>}
                  </div>
                </div>
              </div>
              <div className="text-right">
                <p className="text-4xl font-black text-blue-600 tracking-tight">INVOICE</p>
                <p className="text-base font-bold text-foreground mt-1">#{invoice.invoice_number}</p>
                <span className={`badge-status ${cfg.bg} ${cfg.color} mt-2 inline-flex`}>{cfg.label}</span>
              </div>
            </div>

            {/* Bill To + Invoice Meta */}
            <div className="grid grid-cols-2 gap-6">
              <div className="bg-slate-50 rounded-xl p-4 border border-border">
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-3">Bill To</p>
                <p className="font-bold text-foreground">{invoice.customer?.name || '—'}</p>
                {invoice.customer?.phone && <p className="text-sm text-muted-foreground mt-0.5">{invoice.customer.phone}</p>}
                {invoice.customer?.address && <p className="text-sm text-muted-foreground mt-0.5 leading-relaxed">{invoice.customer.address}</p>}
              </div>
              <div className="bg-slate-50 rounded-xl p-4 border border-border space-y-2.5">
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-3">Details</p>
                <div className="flex justify-between items-center">
                  <span className="text-xs text-muted-foreground">Invoice Date</span>
                  <span className="text-xs font-semibold">{formatDate(invoice.invoice_date)}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs text-muted-foreground">Due Date</span>
                  <span className="text-xs font-semibold">{invoice.due_date ? formatDate(invoice.due_date) : 'On receipt'}</span>
                </div>
                <div className="flex justify-between items-center pt-1.5 border-t border-border">
                  <span className="text-xs text-muted-foreground">Balance Due</span>
                  <span className={`text-sm font-bold ${balance > 0 ? 'text-red-600' : 'text-green-600'}`}>
                    {formatCurrency(balance)}
                  </span>
                </div>
              </div>
            </div>

            {/* Items table */}
            <div className="border border-border rounded-xl overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="bg-slate-50 border-b border-border">
                    <th className="text-left text-xs font-semibold text-muted-foreground px-4 py-3 w-8">#</th>
                    <th className="text-left text-xs font-semibold text-muted-foreground px-4 py-3">Product</th>
                    <th className="text-right text-xs font-semibold text-muted-foreground px-4 py-3">Qty</th>
                    <th className="text-right text-xs font-semibold text-muted-foreground px-4 py-3">Unit Price</th>
                    <th className="text-right text-xs font-semibold text-muted-foreground px-4 py-3">Disc</th>
                    <th className="text-right text-xs font-semibold text-muted-foreground px-4 py-3">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {items.length === 0 ? (
                    <tr><td colSpan={6} className="px-4 py-6 text-center text-sm text-muted-foreground">No items</td></tr>
                  ) : items.map((item, idx) => (
                    <tr key={idx} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-4 py-3 text-sm text-muted-foreground">{idx + 1}</td>
                      <td className="px-4 py-3">
                        <p className="text-sm font-medium text-foreground">{item.product?.name || '—'}</p>
                        {item.unit_name && <p className="text-xs text-muted-foreground">{item.unit_name}</p>}
                      </td>
                      <td className="px-4 py-3 text-sm text-right text-foreground">
                        {item.quantity}{item.unit_name ? ` ${item.unit_name}` : ''}
                      </td>
                      <td className="px-4 py-3 text-sm text-right">{formatCurrency(item.unit_price)}</td>
                      <td className="px-4 py-3 text-sm text-right text-amber-600">
                        {(item.discount_percent || 0) > 0 ? `${item.discount_percent}%` : '—'}
                      </td>
                      <td className="px-4 py-3 text-sm text-right font-semibold">{formatCurrency(item.subtotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Totals */}
            <div className="flex justify-end">
              <div className="w-72 bg-slate-50 rounded-xl border border-border p-4 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Subtotal</span>
                  <span>{formatCurrency(Number(invoice.subtotal) + discountTotal)}</span>
                </div>
                {discountTotal > 0 && (
                  <div className="flex justify-between text-sm text-amber-600">
                    <span>Discount</span>
                    <span>-{formatCurrency(discountTotal)}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm font-semibold border-t border-border pt-2">
                  <span>Invoice Total</span>
                  <span>{formatCurrency(invoice.total_amount)}</span>
                </div>
                <div className="flex justify-between text-sm text-green-600">
                  <span>Amount Paid</span>
                  <span>-{formatCurrency(invoice.amount_paid)}</span>
                </div>
                <div className="flex justify-between font-bold text-base border-t border-border pt-2">
                  <span>Balance Due</span>
                  <span className={balance > 0 ? 'text-red-600' : 'text-green-600'}>{formatCurrency(balance)}</span>
                </div>
              </div>
            </div>

            {/* Notes */}
            {(invoice as any).notes && (
              <div className="border-t border-dashed border-border pt-4">
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-2">Notes</p>
                <p className="text-sm text-muted-foreground">{(invoice as any).notes}</p>
              </div>
            )}

            {/* Footer text */}
            <div className="border-t border-dashed border-border pt-4 text-center">
              <p className="text-xs text-muted-foreground">Thank you for your business!</p>
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

  const filtered = invoices.filter(i =>
    (!search || i.invoice_number.toLowerCase().includes(search.toLowerCase()) || i.customer?.name?.toLowerCase().includes(search.toLowerCase())) &&
    (!filterStatus || i.status === filterStatus)
  );

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Sales & Invoices</h1>
          <p className="text-muted-foreground text-sm mt-0.5">Track all sales transactions</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/sales/pos" className="flex items-center gap-2 border border-blue-600 text-blue-600 hover:bg-blue-50 px-4 py-2 rounded-lg text-sm font-semibold transition">
            <ShoppingCart className="w-4 h-4" />POS
          </Link>
          <button onClick={() => setShowCreateModal(true)} className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-semibold transition">
            <Plus className="w-4 h-4" />New Invoice
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Total Sales', value: formatCurrency(stats.total), icon: TrendingUp, color: 'text-blue-500 bg-blue-50' },
          { label: 'Collected', value: formatCurrency(stats.paid), icon: CheckCircle2, color: 'text-green-500 bg-green-50' },
          { label: 'Outstanding', value: formatCurrency(stats.outstanding), icon: Clock, color: 'text-amber-500 bg-amber-50' },
          { label: 'Overdue Invoices', value: stats.overdue, icon: AlertCircle, color: 'text-red-500 bg-red-50' },
        ].map(s => (
          <div key={s.label} className="stat-card flex items-center gap-3">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center ${s.color}`}><s.icon className="w-5 h-5" /></div>
            <div><p className="text-xs text-muted-foreground">{s.label}</p><p className="text-lg font-bold text-foreground">{s.value}</p></div>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-border p-4 shadow-sm flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search invoices..." className="w-full pl-8 pr-4 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
        </div>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="border border-border rounded-lg px-3 py-2 text-sm focus:outline-none">
          <option value="">All Status</option>
          {Object.entries(statusConfig).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
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
              )) : filtered.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-12 text-center text-muted-foreground text-sm">No invoices found</td></tr>
              ) : filtered.map((inv) => {
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
                      <div className="flex flex-wrap gap-1">
                        <span className={`badge-status ${cfg.bg} ${cfg.color}`}>{cfg.label}</span>
                        {hasReturns && (
                          <span className="badge-status bg-amber-100 text-amber-700 flex items-center gap-0.5">
                            <Package className="w-2.5 h-2.5" />
                            {inv.sales_returns!.length} return{inv.sales_returns!.length > 1 ? 's' : ''}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {inv.status === 'draft' && (
                          <button onClick={() => updateInvoiceStatus(inv, 'sent')} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-blue-50 text-muted-foreground hover:text-blue-600 transition" title="Mark as Sent">
                            <Send className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {(inv.status === 'sent' || inv.status === 'partially_paid') && (inv.balance_due || inv.total_amount - inv.amount_paid) > 0 && (
                          <button onClick={() => openPaymentModal(inv)} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-green-50 text-muted-foreground hover:text-green-600 transition" title="Record Payment">
                            <DollarSign className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <button onClick={() => viewInvoiceDetails(inv)} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-blue-50 text-muted-foreground hover:text-blue-600 transition" title="View Details">
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
          <p className="text-xs text-muted-foreground">{filtered.length} invoices</p>
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
    </div>
  );
}

function CreateInvoiceModal({ customers, products, onClose, onSaved }: {
  customers: Customer[];
  products: Product[];
  onClose: () => void;
  onSaved: () => void;
}) {
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

    // If same product+unit already in list, increment qty instead
    const existingIndex = items.findIndex(
      i => i.product_id === product.id && (i.selected_unit?.id ?? '') === (defaultUnit?.id ?? '')
    );
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
                          <p className="text-sm font-medium text-foreground">{item.product_name}</p>
                          <p className="text-[10px] text-muted-foreground">{item.product_sku}</p>
                          {item.stock_qty !== null && (
                            <p className={`text-[10px] font-medium ${item.stock_qty > 0 ? 'text-green-600' : 'text-red-500'}`}>
                              {item.stock_qty > 0 ? `${item.stock_qty} ${item.product_unit || 'units'} in stock` : 'Out of stock'}
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
