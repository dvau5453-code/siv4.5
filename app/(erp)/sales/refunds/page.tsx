'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { formatCurrency } from '@/lib/format';
import { useToast } from '@/hooks/use-toast';
import { Search, RotateCcw, TrendingUp, Wallet, Banknote, CreditCard, Eye, X, ArrowRightLeft, Clock } from 'lucide-react';

interface RefundRecord {
  id: string;
  return_number: string;
  invoice_id: string;
  invoice_number: string;
  customer_id: string;
  customer_name: string;
  customer_code: string;
  total_refund_amount: number;
  refund_method: string;
  status: string;
  created_at: string;
  items_count: number;
  total_qty_returned: number;
  journal_entry_id: string | null;
  journal_entry_number: string | null;
}

export default function RefundsPage() {
  const { toast } = useToast();
  const [refunds, setRefunds] = useState<RefundRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [methodFilter, setMethodFilter] = useState('all');
  const [stats, setStats] = useState({ totalRefunded: 0, totalReturns: 0, storeCreditRefunds: 0, cashRefunds: 0 });
  const [detailRefund, setDetailRefund] = useState<RefundRecord | null>(null);
  const [detailItems, setDetailItems] = useState<any[]>([]);

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    setLoading(true);

    const { data: returnsData } = await supabase
      .from('sales_returns')
      .select(`
        id, return_number, invoice_id, customer_id, total_refund_amount, refund_method, status, created_at,
        journal_entry_id,
        invoice:invoices!inner(invoice_number),
        customer:customers!inner(name, code),
        items:sales_return_items(quantity_returned, unit_price, discount_percent, subtotal, product:products(name, sku))
      `)
      .order('created_at', { ascending: false });

    const refundsTyped: RefundRecord[] = (returnsData || []).map((r: any) => ({
      id: r.id,
      return_number: r.return_number,
      invoice_id: r.invoice_id,
      invoice_number: r.invoice?.invoice_number || '',
      customer_id: r.customer_id,
      customer_name: r.customer?.name || 'Unknown',
      customer_code: r.customer?.code || '',
      total_refund_amount: Number(r.total_refund_amount),
      refund_method: r.refund_method,
      status: r.status,
      created_at: r.created_at,
      items_count: r.items?.length || 0,
      total_qty_returned: (r.items || []).reduce((s: number, i: any) => s + Number(i.quantity_returned), 0),
      journal_entry_id: r.journal_entry_id,
      journal_entry_number: null,
    }));
    setRefunds(refundsTyped);

    // Fetch journal entry numbers
    const jeIds = refundsTyped.filter(r => r.journal_entry_id).map(r => r.journal_entry_id);
    if (jeIds.length > 0) {
      const { data: jeData } = await supabase
        .from('journal_entries')
        .select('id, entry_number')
        .in('id', jeIds as string[]);
      const jeMap = new Map((jeData || []).map((je: any) => [je.id, je.entry_number]));
      setRefunds(prev => prev.map(r => ({ ...r, journal_entry_number: r.journal_entry_id ? jeMap.get(r.journal_entry_id) || null : null })));
    }

    const totalRefunded = refundsTyped.reduce((s, r) => s + r.total_refund_amount, 0);
    const storeCreditRefunds = refundsTyped.filter(r => r.refund_method === 'store_credit').reduce((s, r) => s + r.total_refund_amount, 0);
    const cashRefunds = refundsTyped.filter(r => r.refund_method !== 'store_credit').reduce((s, r) => s + r.total_refund_amount, 0);
    setStats({ totalRefunded, totalReturns: refundsTyped.length, storeCreditRefunds, cashRefunds });

    setLoading(false);
  }

  async function viewDetail(refund: RefundRecord) {
    setDetailRefund(refund);
    const { data } = await supabase
      .from('sales_return_items')
      .select(`
        id, quantity_returned, unit_price, discount_percent, subtotal, cost_price,
        product:products(name, sku)
      `)
      .eq('sales_return_id', refund.id);
    setDetailItems(data || []);
  }

  const filteredRefunds = refunds.filter(r => {
    const matchesSearch = !search.trim()
      || r.return_number.toLowerCase().includes(search.trim().toLowerCase())
      || r.invoice_number.toLowerCase().includes(search.trim().toLowerCase())
      || r.customer_name.toLowerCase().includes(search.trim().toLowerCase())
      || r.customer_code.toLowerCase().includes(search.trim().toLowerCase());
    const matchesMethod = methodFilter === 'all' || r.refund_method === methodFilter;
    return matchesSearch && matchesMethod;
  });

  const methodIcon = (method: string) => {
    if (method === 'store_credit') return <Wallet className="w-3.5 h-3.5" />;
    if (method === 'cash') return <Banknote className="w-3.5 h-3.5" />;
    return <CreditCard className="w-3.5 h-3.5" />;
  };

  const methodLabel = (method: string) => {
    const labels: Record<string, string> = {
      store_credit: 'Store Credit',
      cash: 'Cash',
      bank_transfer: 'Bank Transfer',
      bkash: 'bKash',
      nagad: 'Nagad',
      rocket: 'Rocket',
      sslcommerz: 'SSLCommerz',
      cheque: 'Cheque',
      card: 'Card',
      other: 'Other',
    };
    return labels[method] || method;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Refunds</h1>
          <p className="text-sm text-muted-foreground mt-1">Track all sales return refunds across all payment methods</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Total Refunded', value: formatCurrency(stats.totalRefunded), icon: RotateCcw, color: 'text-red-500 bg-red-50' },
          { label: 'Total Returns', value: stats.totalReturns, icon: ArrowRightLeft, color: 'text-blue-500 bg-blue-50' },
          { label: 'Store Credit Issued', value: formatCurrency(stats.storeCreditRefunds), icon: Wallet, color: 'text-purple-500 bg-purple-50' },
          { label: 'Cash/Other Refunds', value: formatCurrency(stats.cashRefunds), icon: Banknote, color: 'text-green-500 bg-green-50' },
        ].map(s => (
          <div key={s.label} className="stat-card flex items-center gap-3">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center ${s.color}`}><s.icon className="w-5 h-5" /></div>
            <div><p className="text-xs text-muted-foreground">{s.label}</p><p className="text-lg font-bold text-foreground">{s.value}</p></div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by return number, invoice, or customer..."
            className="w-full pl-10 pr-4 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 bg-white"
          />
        </div>
        <select
          value={methodFilter}
          onChange={e => setMethodFilter(e.target.value)}
          className="px-3 py-2 text-sm border border-border rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20"
        >
          <option value="all">All Methods</option>
          <option value="store_credit">Store Credit</option>
          <option value="cash">Cash</option>
          <option value="bank_transfer">Bank Transfer</option>
          <option value="bkash">bKash</option>
          <option value="nagad">Nagad</option>
          <option value="card">Card</option>
          <option value="cheque">Cheque</option>
          <option value="other">Other</option>
        </select>
      </div>

      {/* Table */}
      {loading ? (
        <div className="text-center py-12 text-muted-foreground">Loading...</div>
      ) : (
        <div className="border border-border rounded-xl overflow-hidden bg-white">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">Return #</th>
                  <th className="px-4 py-3 text-left font-medium">Invoice</th>
                  <th className="px-4 py-3 text-left font-medium">Customer</th>
                  <th className="px-4 py-3 text-center font-medium">Items</th>
                  <th className="px-4 py-3 text-right font-medium">Refund Amount</th>
                  <th className="px-4 py-3 text-center font-medium">Method</th>
                  <th className="px-4 py-3 text-left font-medium">Journal Entry</th>
                  <th className="px-4 py-3 text-left font-medium">Date</th>
                  <th className="px-4 py-3 text-center font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredRefunds.length === 0 ? (
                  <tr><td colSpan={9} className="px-4 py-8 text-center text-sm text-muted-foreground">No refunds found</td></tr>
                ) : filteredRefunds.map(r => (
                  <tr key={r.id} className="hover:bg-muted/20 transition">
                    <td className="px-4 py-3 text-sm font-medium text-blue-600">{r.return_number}</td>
                    <td className="px-4 py-3 text-sm text-foreground">{r.invoice_number}</td>
                    <td className="px-4 py-3 text-sm">
                      <p className="font-medium text-foreground">{r.customer_name}</p>
                      <p className="text-xs text-muted-foreground">{r.customer_code}</p>
                    </td>
                    <td className="px-4 py-3 text-sm text-center text-muted-foreground">{r.total_qty_returned} pcs</td>
                    <td className="px-4 py-3 text-sm text-right font-bold text-red-600">-{formatCurrency(r.total_refund_amount)}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                        r.refund_method === 'store_credit' ? 'bg-purple-50 text-purple-700' :
                        r.refund_method === 'cash' ? 'bg-green-50 text-green-700' :
                        'bg-blue-50 text-blue-700'
                      }`}>
                        {methodIcon(r.refund_method)}
                        {methodLabel(r.refund_method)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">{r.journal_entry_number || '-'}</td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">{new Date(r.created_at).toLocaleDateString()}</td>
                    <td className="px-4 py-3 text-center">
                      <button onClick={() => viewDetail(r)} className="p-1.5 hover:bg-blue-50 rounded text-blue-600" title="View details">
                        <Eye className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Detail Modal */}
      {detailRefund && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setDetailRefund(null)}>
          <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-border">
              <div>
                <h3 className="font-bold text-foreground">{detailRefund.return_number}</h3>
                <p className="text-sm text-muted-foreground">Invoice {detailRefund.invoice_number} - {detailRefund.customer_name}</p>
              </div>
              <button onClick={() => setDetailRefund(null)} className="p-1 hover:bg-muted rounded"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-4 space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div className="p-3 bg-red-50 rounded-lg">
                  <p className="text-xs text-muted-foreground">Refund Amount</p>
                  <p className="text-lg font-bold text-red-600">{formatCurrency(detailRefund.total_refund_amount)}</p>
                </div>
                <div className="p-3 bg-purple-50 rounded-lg">
                  <p className="text-xs text-muted-foreground">Method</p>
                  <p className="text-sm font-bold text-purple-600 flex items-center gap-1 mt-1">{methodIcon(detailRefund.refund_method)}{methodLabel(detailRefund.refund_method)}</p>
                </div>
                <div className="p-3 bg-blue-50 rounded-lg">
                  <p className="text-xs text-muted-foreground">Journal Entry</p>
                  <p className="text-sm font-bold text-blue-600">{detailRefund.journal_entry_number || 'N/A'}</p>
                </div>
              </div>

              <div>
                <p className="text-sm font-medium text-foreground mb-2">Returned Items</p>
                <div className="border border-border rounded-lg overflow-hidden">
                  <table className="w-full">
                    <thead className="bg-muted/30 text-xs text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium">Product</th>
                        <th className="px-3 py-2 text-center font-medium">Qty</th>
                        <th className="px-3 py-2 text-right font-medium">Unit Price</th>
                        <th className="px-3 py-2 text-center font-medium">Disc%</th>
                        <th className="px-3 py-2 text-right font-medium">Subtotal</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {detailItems.map((item: any) => (
                        <tr key={item.id}>
                          <td className="px-3 py-2 text-sm">
                            <p className="font-medium text-foreground">{item.product?.name || 'Unknown'}</p>
                            <p className="text-xs text-muted-foreground">{item.product?.sku || ''}</p>
                          </td>
                          <td className="px-3 py-2 text-sm text-center">{item.quantity_returned}</td>
                          <td className="px-3 py-2 text-sm text-right">{formatCurrency(Number(item.unit_price))}</td>
                          <td className="px-3 py-2 text-sm text-center">{Number(item.discount_percent) > 0 ? `${item.discount_percent}%` : '-'}</td>
                          <td className="px-3 py-2 text-sm text-right font-medium">{formatCurrency(Number(item.subtotal))}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-muted/30">
                      <tr>
                        <td colSpan={4} className="px-3 py-2 text-sm font-bold text-right">Total Refund</td>
                        <td className="px-3 py-2 text-sm text-right font-bold text-red-600">{formatCurrency(detailRefund.total_refund_amount)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>

              <div className="space-y-1 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Return Date</span><span className="font-medium">{new Date(detailRefund.created_at).toLocaleDateString()}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Customer</span><span className="font-medium">{detailRefund.customer_name} ({detailRefund.customer_code})</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Invoice</span><span className="font-medium">{detailRefund.invoice_number}</span></div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
