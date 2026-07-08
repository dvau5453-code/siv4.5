'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { formatCurrency, formatDate } from '@/lib/format';
import { toast } from '@/hooks/use-toast';
import { ArrowLeft, Phone, Mail, MapPin, Building, CreditCard, Calendar, ShoppingBag, DollarSign, Star, Pencil as Edit, Eye, Receipt, Truck, FileText, User, RotateCcw } from 'lucide-react';
import type { Customer, Invoice, Quotation, Delivery } from '@/lib/types';

interface SalesReturn {
  id: string;
  return_number: string;
  invoice_id: string;
  total_refund_amount: number;
  refund_method: string;
  status: string;
  notes: string;
  created_at: string;
  invoice?: { invoice_number: string };
}

interface ManualReceivable {
  id: string;
  entry_number: string;
  entry_date: string;
  description: string;
  total_debit: number;
  created_at: string;
  paid_amount: number;
  outstanding_balance: number;
}

interface CustomerStats {
  totalInvoices: number;
  totalPaid: number;
  totalOutstanding: number;
  totalPurchases: number;
  totalRefunds: number;
  netPurchases: number;
  activeDeliveries: number;
  manualReceivables: number;
  manualReceivablesOutstanding: number;
  storeCreditBalance: number;
}

export default function CustomerDetailPage() {
  const params = useParams();
  const router = useRouter();
  const customerId = params.id as string;

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<CustomerStats>({
    totalInvoices: 0, totalPaid: 0, totalOutstanding: 0, totalPurchases: 0,
    totalRefunds: 0, netPurchases: 0, activeDeliveries: 0,
    manualReceivables: 0, manualReceivablesOutstanding: 0, storeCreditBalance: 0
  });
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [quotations, setQuotations] = useState<Quotation[]>([]);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [manualReceivables, setManualReceivables] = useState<ManualReceivable[]>([]);
  const [salesReturns, setSalesReturns] = useState<SalesReturn[]>([]);
  const [activeTab, setActiveTab] = useState<'invoices' | 'quotations' | 'deliveries' | 'receivables' | 'returns'>('invoices');

  useEffect(() => { loadCustomerData(); }, [customerId]);

  async function loadCustomerData() {
    setLoading(true);

    const { data: custData } = await supabase
      .from('customers')
      .select('*')
      .eq('id', customerId)
      .single();

    if (!custData) {
      toast({ title: 'Error', description: 'Customer not found', variant: 'destructive' });
      router.push('/crm');
      return;
    }
    setCustomer(custData);

    const [invRes, invTotalsRes, quoteRes, delivRes, receivableRes, receivablePaymentsRes, returnsRes, creditRes] = await Promise.all([
      supabase.from('invoices').select('*').eq('customer_id', customerId).order('created_at', { ascending: false }).limit(20),
      supabase.from('invoices').select('total_amount').eq('customer_id', customerId),
      supabase.from('quotations').select('*').eq('customer_id', customerId).order('created_at', { ascending: false }).limit(10),
      supabase.from('deliveries').select('*').eq('customer_id', customerId).order('created_at', { ascending: false }).limit(10),
      supabase.from('journal_entries').select('id, entry_number, entry_date, description, total_debit, created_at').eq('customer_id', customerId).eq('reference_type', 'receivable').eq('is_posted', true).order('entry_date', { ascending: false }),
      supabase.from('payments').select('reference_id, amount').eq('reference_type', 'receivable'),
      supabase.from('sales_returns').select('*, invoice:invoices(invoice_number)').eq('customer_id', customerId).order('created_at', { ascending: false }),
      supabase.from('customer_store_credits').select('balance').eq('customer_id', customerId).eq('status', 'active'),
    ]);

    setInvoices(invRes.data || []);
    setQuotations(quoteRes.data || []);
    setDeliveries(delivRes.data || []);

    // Calculate manual receivables with payments
    const receivablePaymentsMap = new Map<string, number>();
    (receivablePaymentsRes.data || []).forEach((p: any) => {
      const current = receivablePaymentsMap.get(p.reference_id) || 0;
      receivablePaymentsMap.set(p.reference_id, current + Number(p.amount));
    });

    const receivablesWithPayments: ManualReceivable[] = (receivableRes.data || []).map((r: any) => {
      const paidAmount = receivablePaymentsMap.get(r.id) || 0;
      return {
        ...r,
        paid_amount: paidAmount,
        outstanding_balance: Number(r.total_debit) - paidAmount,
      };
    });

    setManualReceivables(receivablesWithPayments);
    setSalesReturns(returnsRes.data || []);

    const invData = invRes.data || [];
    const returnsData = returnsRes.data || [];
    const totalPaid = invData.reduce((s, i) => s + Number(i.amount_paid), 0);
    const totalOut = invData.reduce((s, i) => s + Number(i.balance_due || i.total_amount - i.amount_paid), 0);
    const manualReceivablesOutstanding = receivablesWithPayments.reduce((s, r) => s + r.outstanding_balance, 0);
    const totalRefunds = returnsData.reduce((s, r) => s + Number(r.total_refund_amount), 0);
    const actualTotalPurchases = (invTotalsRes.data || []).reduce((s, i) => s + Number(i.total_amount), 0);
    const netPurchases = actualTotalPurchases - totalRefunds;

    setStats({
      totalInvoices: (invTotalsRes.data || []).length,
      totalPaid,
      totalOutstanding: totalOut,
      totalPurchases: actualTotalPurchases,
      totalRefunds,
      netPurchases,
      activeDeliveries: (delivRes.data || []).filter(d => d.status !== 'delivered' && d.status !== 'returned').length,
      manualReceivables: receivablesWithPayments.length,
      manualReceivablesOutstanding,
      storeCreditBalance: (creditRes.data || []).reduce((s: number, c: any) => s + Number(c.balance), 0),
    });

    setLoading(false);
  }

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!customer) return null;

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center gap-4">
        <button onClick={() => router.back()} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-muted transition">
          <ArrowLeft className="w-5 h-5 text-muted-foreground" />
        </button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-foreground">{customer.name}</h1>
          <p className="text-sm text-muted-foreground">{customer.code} - {customer.type.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}</p>
        </div>
        <Link href={`/crm?edit=${customer.id}`} className="flex items-center gap-2 px-4 py-2 border border-border rounded-lg text-sm hover:bg-muted transition">
          <Edit className="w-4 h-4" />Edit
        </Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 space-y-4">
          <div className="bg-white rounded-xl border border-border p-5 shadow-sm">
            <h3 className="text-sm font-semibold mb-4 text-foreground">Contact Information</h3>
            <div className="space-y-3">
              {customer.phone && (
                <div className="flex items-center gap-3 text-sm">
                  <Phone className="w-4 h-4 text-muted-foreground" />
                  <span className="text-foreground">{customer.phone}</span>
                </div>
              )}
              {customer.mobile && (
                <div className="flex items-center gap-3 text-sm">
                  <Phone className="w-4 h-4 text-muted-foreground" />
                  <span className="text-foreground">{customer.mobile}</span>
                </div>
              )}
              {customer.email && (
                <div className="flex items-center gap-3 text-sm">
                  <Mail className="w-4 h-4 text-muted-foreground" />
                  <span className="text-foreground">{customer.email}</span>
                </div>
              )}
              {(customer.address || customer.city) && (
                <div className="flex items-start gap-3 text-sm">
                  <MapPin className="w-4 h-4 text-muted-foreground mt-0.5" />
                  <div>
                    {customer.address && <p className="text-foreground">{customer.address}</p>}
                    {customer.city && <p className="text-muted-foreground">{customer.city}, {customer.country}</p>}
                  </div>
                </div>
              )}
              {customer.company_name && (
                <div className="flex items-center gap-3 text-sm">
                  <Building className="w-4 h-4 text-muted-foreground" />
                  <span className="text-foreground">{customer.company_name}</span>
                </div>
              )}
            </div>
          </div>

          <div className="bg-white rounded-xl border border-border p-5 shadow-sm">
            <h3 className="text-sm font-semibold mb-4 text-foreground">Credit & Financial</h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground flex items-center gap-2"><CreditCard className="w-4 h-4" />Credit Limit</span>
                <span className="font-semibold text-foreground">{formatCurrency(customer.credit_limit)}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground flex items-center gap-2"><Calendar className="w-4 h-4" />Credit Days</span>
                <span className="font-semibold text-foreground">{customer.credit_days} days</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground flex items-center gap-2"><DollarSign className="w-4 h-4" />Outstanding</span>
                <span className="font-semibold text-red-600">{formatCurrency(customer.outstanding_balance)}</span>
              </div>
              <div className="flex items-center justify-between text-sm border-t border-border pt-3 mt-1">
                <span className="text-muted-foreground flex items-center gap-2"><ShoppingBag className="w-4 h-4" />Total Purchases</span>
                <span className="font-semibold text-foreground">{formatCurrency(stats.totalPurchases)}</span>
              </div>
              {stats.totalRefunds > 0 && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground flex items-center gap-2"><RotateCcw className="w-4 h-4" />Total Returned</span>
                  <span className="font-semibold text-red-500">-{formatCurrency(stats.totalRefunds)}</span>
                </div>
              )}
              {stats.totalRefunds > 0 && (
                <div className="flex items-center justify-between text-sm bg-teal-50 px-2 py-1.5 rounded-lg -mx-2">
                  <span className="text-teal-700 font-semibold flex items-center gap-2"><DollarSign className="w-4 h-4" />Net Purchases</span>
                  <span className="font-bold text-teal-700">{formatCurrency(stats.netPurchases)}</span>
                </div>
              )}
              {customer.discount_percent > 0 && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground flex items-center gap-2"><Star className="w-4 h-4" />Discount</span>
                  <span className="font-semibold text-green-600">{customer.discount_percent}%</span>
                </div>
              )}
            </div>
          </div>

          <div className="bg-white rounded-xl border border-border p-5 shadow-sm">
            <h3 className="text-sm font-semibold mb-4 text-foreground">Quick Stats</h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-blue-50 rounded-lg p-3 text-center">
                <p className="text-xl font-bold text-blue-600">{stats.totalInvoices}</p>
                <p className="text-xs text-blue-700">Invoices</p>
              </div>
              <div className="bg-orange-50 rounded-lg p-3 text-center">
                <p className="text-xl font-bold text-orange-600">{salesReturns.length}</p>
                <p className="text-xs text-orange-700">Returns</p>
              </div>
              <div className="bg-green-50 rounded-lg p-3 text-center">
                <p className="text-lg font-bold text-green-600">{formatCurrency(stats.totalPaid)}</p>
                <p className="text-xs text-green-700">Total Paid</p>
              </div>
              <div className="bg-red-50 rounded-lg p-3 text-center">
                <p className="text-lg font-bold text-red-600">{formatCurrency(stats.totalRefunds)}</p>
                <p className="text-xs text-red-700">Total Refunded</p>
              </div>
              <div className="bg-teal-50 rounded-lg p-3 text-center col-span-2 border border-teal-100">
                <p className="text-xl font-bold text-teal-600">{formatCurrency(stats.netPurchases)}</p>
                <p className="text-xs text-teal-700 font-medium">Net Purchases (after returns)</p>
              </div>
              <div className="bg-amber-50 rounded-lg p-3 text-center">
                <p className="text-xl font-bold text-amber-600">{stats.activeDeliveries}</p>
                <p className="text-xs text-amber-700">Active Deliveries</p>
              </div>
              <div className="bg-slate-50 rounded-lg p-3 text-center">
                <p className="text-lg font-bold text-slate-600">{formatCurrency(stats.totalOutstanding)}</p>
                <p className="text-xs text-slate-600">Outstanding</p>
              </div>
              {stats.storeCreditBalance > 0 && (
                <div className="bg-purple-50 rounded-lg p-3 text-center col-span-2 border border-purple-100">
                  <p className="text-lg font-bold text-purple-600">{formatCurrency(stats.storeCreditBalance)}</p>
                  <p className="text-xs text-purple-700 font-medium">Store Credit Available</p>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="lg:col-span-2">
          <div className="bg-white rounded-xl border border-border shadow-sm">
            <div className="flex border-b border-border overflow-x-auto">
              {[
                { key: 'invoices', label: 'Invoices', icon: Receipt },
                { key: 'returns', label: `Returns${salesReturns.length > 0 ? ` (${salesReturns.length})` : ''}`, icon: RotateCcw },
                { key: 'receivables', label: 'Receivables', icon: User },
                { key: 'quotations', label: 'Quotations', icon: FileText },
                { key: 'deliveries', label: 'Deliveries', icon: Truck },
              ].map(tab => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key as typeof activeTab)}
                  className={`flex items-center gap-2 px-5 py-3 text-sm font-medium border-b-2 transition ${
                    activeTab === tab.key
                      ? 'border-blue-600 text-blue-600'
                      : 'border-transparent text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <tab.icon className="w-4 h-4" />
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="p-4">
              {activeTab === 'invoices' && (
                <div className="overflow-x-auto">
                  {invoices.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground text-sm">
                      <ShoppingBag className="w-10 h-10 mx-auto mb-2 opacity-30" />
                      No invoices yet
                    </div>
                  ) : (
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-border">
                          <th className="text-left text-xs font-semibold text-muted-foreground px-3 py-2">Invoice #</th>
                          <th className="text-left text-xs font-semibold text-muted-foreground px-3 py-2">Date</th>
                          <th className="text-right text-xs font-semibold text-muted-foreground px-3 py-2">Amount</th>
                          <th className="text-right text-xs font-semibold text-muted-foreground px-3 py-2">Paid</th>
                          <th className="text-right text-xs font-semibold text-muted-foreground px-3 py-2">Balance</th>
                          <th className="text-left text-xs font-semibold text-muted-foreground px-3 py-2">Status</th>
                          <th className="text-right text-xs font-semibold text-muted-foreground px-3 py-2"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {invoices.map(inv => (
                          <tr key={inv.id} className="hover:bg-muted/30">
                            <td className="px-3 py-2 text-sm font-semibold text-blue-600">{inv.invoice_number}</td>
                            <td className="px-3 py-2 text-sm text-muted-foreground">{formatDate(inv.invoice_date)}</td>
                            <td className="px-3 py-2 text-sm text-right font-semibold">{formatCurrency(inv.total_amount)}</td>
                            <td className="px-3 py-2 text-sm text-right text-green-600">{formatCurrency(inv.amount_paid)}</td>
                            <td className="px-3 py-2 text-sm text-right text-red-600 font-bold">{formatCurrency(inv.balance_due || inv.total_amount - inv.amount_paid)}</td>
                            <td className="px-3 py-2">
                              <span className={`badge-status ${inv.status === 'paid' ? 'bg-green-100 text-green-700' : inv.status === 'overdue' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                                {inv.status.replace('_', ' ')}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-right">
                              <Link href={`/sales?view=${inv.id}`} className="w-7 h-7 inline-flex items-center justify-center rounded-lg hover:bg-blue-50 text-muted-foreground hover:text-blue-600">
                                <Eye className="w-3.5 h-3.5" />
                              </Link>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}

              {activeTab === 'returns' && (
                <div className="overflow-x-auto">
                  {salesReturns.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground text-sm">
                      <RotateCcw className="w-10 h-10 mx-auto mb-2 opacity-30" />
                      No sales returns yet
                    </div>
                  ) : (
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-border">
                          <th className="text-left text-xs font-semibold text-muted-foreground px-3 py-2">Return #</th>
                          <th className="text-left text-xs font-semibold text-muted-foreground px-3 py-2">Invoice</th>
                          <th className="text-left text-xs font-semibold text-muted-foreground px-3 py-2">Date</th>
                          <th className="text-right text-xs font-semibold text-muted-foreground px-3 py-2">Refund</th>
                          <th className="text-left text-xs font-semibold text-muted-foreground px-3 py-2">Method</th>
                          <th className="text-left text-xs font-semibold text-muted-foreground px-3 py-2">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {salesReturns.map(ret => (
                          <tr key={ret.id} className="hover:bg-muted/30">
                            <td className="px-3 py-2 text-sm font-semibold text-orange-600">{ret.return_number}</td>
                            <td className="px-3 py-2 text-sm text-blue-600">{ret.invoice?.invoice_number || '—'}</td>
                            <td className="px-3 py-2 text-sm text-muted-foreground">{formatDate(ret.created_at)}</td>
                            <td className="px-3 py-2 text-sm text-right font-bold text-red-600">{formatCurrency(ret.total_refund_amount)}</td>
                            <td className="px-3 py-2 text-sm text-muted-foreground capitalize">{ret.refund_method?.replace(/_/g, ' ')}</td>
                            <td className="px-3 py-2">
                              <span className={`badge-status ${ret.status === 'completed' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                                {ret.status}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="bg-muted/40 border-t-2 border-border">
                          <td colSpan={3} className="px-3 py-2 text-sm font-semibold text-muted-foreground">Total Refunded</td>
                          <td className="px-3 py-2 text-sm text-right font-bold text-red-600">{formatCurrency(stats.totalRefunds)}</td>
                          <td colSpan={2}></td>
                        </tr>
                      </tfoot>
                    </table>
                  )}
                </div>
              )}

              {activeTab === 'receivables' && (
                <div className="overflow-x-auto">
                  {manualReceivables.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground text-sm">
                      <User className="w-10 h-10 mx-auto mb-2 opacity-30" />
                      No manual receivables
                    </div>
                  ) : (
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-border">
                          <th className="text-left text-xs font-semibold text-muted-foreground px-3 py-2">Entry #</th>
                          <th className="text-left text-xs font-semibold text-muted-foreground px-3 py-2">Date</th>
                          <th className="text-left text-xs font-semibold text-muted-foreground px-3 py-2">Description</th>
                          <th className="text-right text-xs font-semibold text-muted-foreground px-3 py-2">Amount</th>
                          <th className="text-right text-xs font-semibold text-muted-foreground px-3 py-2">Paid</th>
                          <th className="text-right text-xs font-semibold text-muted-foreground px-3 py-2">Outstanding</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {manualReceivables.map(rec => (
                          <tr key={rec.id} className="hover:bg-muted/30">
                            <td className="px-3 py-2 text-sm font-semibold text-blue-600">{rec.entry_number}</td>
                            <td className="px-3 py-2 text-sm text-muted-foreground">{formatDate(rec.entry_date)}</td>
                            <td className="px-3 py-2 text-sm text-foreground">{rec.description}</td>
                            <td className="px-3 py-2 text-sm text-right font-semibold">{formatCurrency(rec.total_debit)}</td>
                            <td className="px-3 py-2 text-sm text-right text-green-600">{formatCurrency(rec.paid_amount)}</td>
                            <td className="px-3 py-2 text-sm text-right text-red-600 font-bold">{formatCurrency(rec.outstanding_balance)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}

              {activeTab === 'quotations' && (
                <div className="overflow-x-auto">
                  {quotations.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground text-sm">
                      <FileText className="w-10 h-10 mx-auto mb-2 opacity-30" />
                      No quotations yet
                    </div>
                  ) : (
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-border">
                          <th className="text-left text-xs font-semibold text-muted-foreground px-3 py-2">Quote #</th>
                          <th className="text-left text-xs font-semibold text-muted-foreground px-3 py-2">Date</th>
                          <th className="text-left text-xs font-semibold text-muted-foreground px-3 py-2">Expiry</th>
                          <th className="text-right text-xs font-semibold text-muted-foreground px-3 py-2">Amount</th>
                          <th className="text-left text-xs font-semibold text-muted-foreground px-3 py-2">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {quotations.map(quote => (
                          <tr key={quote.id} className="hover:bg-muted/30">
                            <td className="px-3 py-2 text-sm font-semibold text-blue-600">{quote.quote_number}</td>
                            <td className="px-3 py-2 text-sm text-muted-foreground">{formatDate(quote.issue_date)}</td>
                            <td className="px-3 py-2 text-sm text-muted-foreground">{quote.expiry_date ? formatDate(quote.expiry_date) : '-'}</td>
                            <td className="px-3 py-2 text-sm text-right font-semibold">{formatCurrency(quote.total_amount)}</td>
                            <td className="px-3 py-2">
                              <span className={`badge-status ${quote.status === 'accepted' ? 'bg-green-100 text-green-700' : quote.status === 'rejected' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}>
                                {quote.status}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}

              {activeTab === 'deliveries' && (
                <div className="overflow-x-auto">
                  {deliveries.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground text-sm">
                      <Truck className="w-10 h-10 mx-auto mb-2 opacity-30" />
                      No deliveries yet
                    </div>
                  ) : (
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-border">
                          <th className="text-left text-xs font-semibold text-muted-foreground px-3 py-2">Delivery #</th>
                          <th className="text-left text-xs font-semibold text-muted-foreground px-3 py-2">Date</th>
                          <th className="text-left text-xs font-semibold text-muted-foreground px-3 py-2">Address</th>
                          <th className="text-left text-xs font-semibold text-muted-foreground px-3 py-2">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {deliveries.map(del => (
                          <tr key={del.id} className="hover:bg-muted/30">
                            <td className="px-3 py-2 text-sm font-semibold text-blue-600">{del.delivery_number}</td>
                            <td className="px-3 py-2 text-sm text-muted-foreground">{del.delivery_date ? formatDate(del.delivery_date) : '-'}</td>
                            <td className="px-3 py-2 text-sm text-muted-foreground">{del.delivery_address || del.delivery_city || '-'}</td>
                            <td className="px-3 py-2">
                              <span className={`badge-status ${del.status === 'delivered' ? 'bg-green-100 text-green-700' : del.status === 'failed' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}>
                                {del.status.replace('_', ' ')}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
