'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { formatCurrency } from '@/lib/format';
import { useToast } from '@/hooks/use-toast';
import { Search, Wallet, CircleArrowDown as ArrowDownCircle, CircleArrowUp as ArrowUpCircle, Eye, X, TrendingUp, Clock, CircleCheck as CheckCircle2, CircleAlert as AlertCircle } from 'lucide-react';

interface StoreCredit {
  id: string;
  credit_number: string;
  customer_id: string;
  customer_name: string;
  customer_code: string;
  amount: number;
  balance: number;
  status: string;
  notes: string;
  expires_at: string | null;
  created_at: string;
  sales_return_id: string | null;
  return_number: string | null;
}

interface Redemption {
  id: string;
  store_credit_id: string;
  credit_number: string;
  customer_id: string;
  customer_name: string;
  invoice_id: string | null;
  invoice_number: string | null;
  amount: number;
  notes: string;
  created_at: string;
}

export default function StoreCreditPage() {
  const { toast } = useToast();
  const [credits, setCredits] = useState<StoreCredit[]>([]);
  const [redemptions, setRedemptions] = useState<Redemption[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'credits' | 'redemptions'>('credits');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [stats, setStats] = useState({ totalIssued: 0, totalRedeemed: 0, activeBalance: 0, expiredCount: 0 });
  const [detailCredit, setDetailCredit] = useState<StoreCredit | null>(null);
  const [detailRedemptions, setDetailRedemptions] = useState<Redemption[]>([]);

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    setLoading(true);

    const { data: creditData } = await supabase
      .from('customer_store_credits')
      .select(`
        id, credit_number, customer_id, amount, balance, status, notes, expires_at, created_at,
        sales_return_id,
        customer:customers!inner(name, code),
        sales_return:sales_returns(return_number)
      `)
      .order('created_at', { ascending: false });

    const creditsTyped: StoreCredit[] = (creditData || []).map((c: any) => ({
      id: c.id,
      credit_number: c.credit_number,
      customer_id: c.customer_id,
      customer_name: c.customer?.name || 'Unknown',
      customer_code: c.customer?.code || '',
      amount: Number(c.amount),
      balance: Number(c.balance),
      status: c.status,
      notes: c.notes || '',
      expires_at: c.expires_at,
      created_at: c.created_at,
      sales_return_id: c.sales_return_id,
      return_number: c.sales_return?.return_number || null,
    }));
    setCredits(creditsTyped);

    const { data: redemptionData } = await supabase
      .from('store_credit_redemptions')
      .select(`
        id, store_credit_id, customer_id, amount, notes, created_at,
        invoice_id,
        credit:customer_store_credits(credit_number),
        customer:customers!inner(name),
        invoice:invoices(invoice_number)
      `)
      .order('created_at', { ascending: false });

    const redemptionsTyped: Redemption[] = (redemptionData || []).map((r: any) => ({
      id: r.id,
      store_credit_id: r.store_credit_id,
      credit_number: r.credit?.credit_number || '',
      customer_id: r.customer_id,
      customer_name: r.customer?.name || 'Unknown',
      invoice_id: r.invoice_id,
      invoice_number: r.invoice?.invoice_number || null,
      amount: Number(r.amount),
      notes: r.notes || '',
      created_at: r.created_at,
    }));
    setRedemptions(redemptionsTyped);

    const totalIssued = creditsTyped.reduce((s, c) => s + c.amount, 0);
    const totalRedeemed = redemptionsTyped.reduce((s, r) => s + r.amount, 0);
    const activeBalance = creditsTyped.filter(c => c.status === 'active').reduce((s, c) => s + c.balance, 0);
    const expiredCount = creditsTyped.filter(c => c.status === 'expired').length;
    setStats({ totalIssued, totalRedeemed, activeBalance, expiredCount });

    setLoading(false);
  }

  async function viewDetail(credit: StoreCredit) {
    setDetailCredit(credit);
    const { data } = await supabase
      .from('store_credit_redemptions')
      .select(`
        id, amount, notes, created_at,
        invoice:invoices(invoice_number)
      `)
      .eq('store_credit_id', credit.id)
      .order('created_at', { ascending: false });
    setDetailRedemptions((data || []).map((r: any) => ({
      id: r.id,
      store_credit_id: credit.id,
      credit_number: credit.credit_number,
      customer_id: credit.customer_id,
      customer_name: credit.customer_name,
      invoice_id: null,
      invoice_number: r.invoice?.invoice_number || null,
      amount: Number(r.amount),
      notes: r.notes || '',
      created_at: r.created_at,
    })));
  }

  async function expireCredit(creditId: string) {
    const { error } = await supabase
      .from('customer_store_credits')
      .update({ status: 'expired', updated_at: new Date().toISOString() })
      .eq('id', creditId);
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Store credit expired', description: 'The credit has been marked as expired.' });
      loadData();
    }
  }

  const filteredCredits = credits.filter(c => {
    const matchesSearch = !search.trim()
      || c.credit_number.toLowerCase().includes(search.trim().toLowerCase())
      || c.customer_name.toLowerCase().includes(search.trim().toLowerCase())
      || c.customer_code.toLowerCase().includes(search.trim().toLowerCase());
    const matchesStatus = statusFilter === 'all' || c.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const filteredRedemptions = redemptions.filter(r => {
    if (!search.trim()) return true;
    return r.credit_number.toLowerCase().includes(search.trim().toLowerCase())
      || r.customer_name.toLowerCase().includes(search.trim().toLowerCase())
      || (r.invoice_number || '').toLowerCase().includes(search.trim().toLowerCase());
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Store Credit</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage customer store credit balances, issuances, and redemptions</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Total Issued', value: formatCurrency(stats.totalIssued), icon: TrendingUp, color: 'text-blue-500 bg-blue-50' },
          { label: 'Total Redeemed', value: formatCurrency(stats.totalRedeemed), icon: ArrowUpCircle, color: 'text-green-500 bg-green-50' },
          { label: 'Active Balance', value: formatCurrency(stats.activeBalance), icon: Wallet, color: 'text-purple-500 bg-purple-50' },
          { label: 'Expired', value: stats.expiredCount, icon: AlertCircle, color: 'text-red-500 bg-red-50' },
        ].map(s => (
          <div key={s.label} className="stat-card flex items-center gap-3">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center ${s.color}`}><s.icon className="w-5 h-5" /></div>
            <div><p className="text-xs text-muted-foreground">{s.label}</p><p className="text-lg font-bold text-foreground">{s.value}</p></div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-border">
        <button
          onClick={() => setTab('credits')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition ${tab === 'credits' ? 'border-blue-500 text-blue-600' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
        >
          Credit Issuances
        </button>
        <button
          onClick={() => setTab('redemptions')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition ${tab === 'redemptions' ? 'border-blue-500 text-blue-600' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
        >
          Redemptions
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={tab === 'credits' ? 'Search by credit number, customer name or code...' : 'Search by credit number, customer, or invoice...'}
            className="w-full pl-10 pr-4 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 bg-white"
          />
        </div>
        {tab === 'credits' && (
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="px-3 py-2 text-sm border border-border rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          >
            <option value="all">All Statuses</option>
            <option value="active">Active</option>
            <option value="redeemed">Fully Redeemed</option>
            <option value="expired">Expired</option>
          </select>
        )}
      </div>

      {/* Table */}
      {loading ? (
        <div className="text-center py-12 text-muted-foreground">Loading...</div>
      ) : tab === 'credits' ? (
        <div className="border border-border rounded-xl overflow-hidden bg-white">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">Credit #</th>
                  <th className="px-4 py-3 text-left font-medium">Customer</th>
                  <th className="px-4 py-3 text-left font-medium">Source</th>
                  <th className="px-4 py-3 text-right font-medium">Amount Issued</th>
                  <th className="px-4 py-3 text-right font-medium">Balance</th>
                  <th className="px-4 py-3 text-center font-medium">Status</th>
                  <th className="px-4 py-3 text-left font-medium">Date</th>
                  <th className="px-4 py-3 text-center font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredCredits.length === 0 ? (
                  <tr><td colSpan={8} className="px-4 py-8 text-center text-sm text-muted-foreground">No store credits found</td></tr>
                ) : filteredCredits.map(c => (
                  <tr key={c.id} className="hover:bg-muted/20 transition">
                    <td className="px-4 py-3 text-sm font-medium text-blue-600">{c.credit_number}</td>
                    <td className="px-4 py-3 text-sm">
                      <p className="font-medium text-foreground">{c.customer_name}</p>
                      <p className="text-xs text-muted-foreground">{c.customer_code}</p>
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">
                      {c.return_number ? <span className="text-blue-600">{c.return_number}</span> : <span className="text-xs">Manual / Migrated</span>}
                    </td>
                    <td className="px-4 py-3 text-sm text-right font-medium">{formatCurrency(c.amount)}</td>
                    <td className="px-4 py-3 text-sm text-right font-bold text-purple-600">{formatCurrency(c.balance)}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                        c.status === 'active' ? 'bg-green-50 text-green-700' :
                        c.status === 'redeemed' ? 'bg-blue-50 text-blue-700' :
                        'bg-red-50 text-red-700'
                      }`}>
                        {c.status === 'active' && <CheckCircle2 className="w-3 h-3" />}
                        {c.status === 'redeemed' && <CheckCircle2 className="w-3 h-3" />}
                        {c.status === 'expired' && <AlertCircle className="w-3 h-3" />}
                        {c.status.charAt(0).toUpperCase() + c.status.slice(1)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">{new Date(c.created_at).toLocaleDateString()}</td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={() => viewDetail(c)} className="p-1.5 hover:bg-blue-50 rounded text-blue-600" title="View details">
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                        {c.status === 'active' && (
                          <button
                            onClick={() => expireCredit(c.id)}
                            className="p-1.5 hover:bg-red-50 rounded text-red-500 text-xs font-medium"
                            title="Expire credit"
                          >
                            Expire
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="border border-border rounded-xl overflow-hidden bg-white">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">Credit #</th>
                  <th className="px-4 py-3 text-left font-medium">Customer</th>
                  <th className="px-4 py-3 text-left font-medium">Invoice</th>
                  <th className="px-4 py-3 text-right font-medium">Amount Redeemed</th>
                  <th className="px-4 py-3 text-left font-medium">Date</th>
                  <th className="px-4 py-3 text-left font-medium">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredRedemptions.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-muted-foreground">No redemptions found</td></tr>
                ) : filteredRedemptions.map(r => (
                  <tr key={r.id} className="hover:bg-muted/20 transition">
                    <td className="px-4 py-3 text-sm font-medium text-blue-600">{r.credit_number}</td>
                    <td className="px-4 py-3 text-sm text-foreground">{r.customer_name}</td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">{r.invoice_number || '-'}</td>
                    <td className="px-4 py-3 text-sm text-right font-bold text-green-600">{formatCurrency(r.amount)}</td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">{new Date(r.created_at).toLocaleDateString()}</td>
                    <td className="px-4 py-3 text-sm text-muted-foreground max-w-xs truncate">{r.notes || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Detail Modal */}
      {detailCredit && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setDetailCredit(null)}>
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-border">
              <div>
                <h3 className="font-bold text-foreground">{detailCredit.credit_number}</h3>
                <p className="text-sm text-muted-foreground">{detailCredit.customer_name} ({detailCredit.customer_code})</p>
              </div>
              <button onClick={() => setDetailCredit(null)} className="p-1 hover:bg-muted rounded"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-4 space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div className="p-3 bg-blue-50 rounded-lg">
                  <p className="text-xs text-muted-foreground">Amount Issued</p>
                  <p className="text-lg font-bold text-blue-600">{formatCurrency(detailCredit.amount)}</p>
                </div>
                <div className="p-3 bg-purple-50 rounded-lg">
                  <p className="text-xs text-muted-foreground">Balance</p>
                  <p className="text-lg font-bold text-purple-600">{formatCurrency(detailCredit.balance)}</p>
                </div>
                <div className="p-3 bg-green-50 rounded-lg">
                  <p className="text-xs text-muted-foreground">Redeemed</p>
                  <p className="text-lg font-bold text-green-600">{formatCurrency(detailCredit.amount - detailCredit.balance)}</p>
                </div>
              </div>
              <div className="space-y-1 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Status</span><span className="font-medium capitalize">{detailCredit.status}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Source</span><span className="font-medium">{detailCredit.return_number || 'Manual / Migrated'}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Issued Date</span><span className="font-medium">{new Date(detailCredit.created_at).toLocaleDateString()}</span></div>
                {detailCredit.expires_at && <div className="flex justify-between"><span className="text-muted-foreground">Expires</span><span className="font-medium">{new Date(detailCredit.expires_at).toLocaleDateString()}</span></div>}
              </div>
              {detailCredit.notes && (
                <div className="p-3 bg-muted/30 rounded-lg">
                  <p className="text-xs text-muted-foreground mb-1">Notes</p>
                  <p className="text-sm text-foreground">{detailCredit.notes}</p>
                </div>
              )}
              {detailRedemptions.length > 0 && (
                <div>
                  <p className="text-sm font-medium text-foreground mb-2">Redemption History</p>
                  <div className="space-y-2">
                    {detailRedemptions.map(r => (
                      <div key={r.id} className="flex items-center justify-between p-2 bg-muted/20 rounded-lg text-sm">
                        <div>
                          <p className="font-medium text-foreground">{formatCurrency(r.amount)}</p>
                          <p className="text-xs text-muted-foreground">{r.invoice_number || 'No invoice'} - {new Date(r.created_at).toLocaleDateString()}</p>
                        </div>
                        {r.notes && <p className="text-xs text-muted-foreground truncate max-w-[200px]">{r.notes}</p>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
