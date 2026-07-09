'use client';

import { useEffect, useState, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { formatCurrency, formatDate } from '@/lib/format';
import { toast } from '@/hooks/use-toast';
import { DollarSign, CreditCard, TrendingUp, TrendingDown, ChartBar as BarChart3, Plus, X, ArrowUpRight, ArrowDownLeft, ExternalLink, User, Building2, HandCoins, CircleCheck as CheckCircle2, ChevronDown, Receipt } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import Link from 'next/link';
import type { Account } from '@/lib/types';

interface JournalLine {
  id: string;
  account_id: string;
  account?: { name: string; code: string; balance: number; account_type: string } | { name: string; code: string; balance: number; account_type: string }[];
  description: string;
  debit: number;
  credit: number;
}

interface JournalEntry {
  id: string;
  entry_number: string;
  entry_date: string;
  description: string;
  reference_type: string;
  total_debit: number;
  total_credit: number;
  lines?: JournalLine[];
}

interface ManualReceivablePayable {
  id: string;
  entry_number: string;
  entry_date: string;
  description: string;
  amount: number;
  paid_amount: number;
  outstanding_balance: number;
  party_name?: string;
  party_id?: string;
}

export default function AccountingPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [monthlyData, setMonthlyData] = useState<{ month: string; income: number; expense: number }[]>([]);
  const [recentEntries, setRecentEntries] = useState<JournalEntry[]>([]);
  const [manualReceivables, setManualReceivables] = useState<ManualReceivablePayable[]>([]);
  const [manualPayables, setManualPayables] = useState<ManualReceivablePayable[]>([]);
  const [showReceivablePayment, setShowReceivablePayment] = useState<ManualReceivablePayable | null>(null);
  const [showPayablePayment, setShowPayablePayment] = useState<ManualReceivablePayable | null>(null);
  const [modalType, setModalType] = useState<'expense' | 'receivable' | 'payable' | null>(null);

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    setLoading(true);

    // Step 1: Fetch accounts
    const { data: accountsData } = await supabase.from('accounts').select('*').eq('is_active', true).order('code');
    setAccounts(accountsData || []);

    // Step 2: Fetch recent journal entries for display
    const { data: entriesData } = await supabase.from('journal_entries')
      .select('id, entry_number, entry_date, description, reference_type, total_debit, total_credit, lines:journal_lines(id, account_id, description, debit, credit, account:accounts(name, code, balance, account_type))')
      .eq('is_posted', true)
      .order('created_at', { ascending: false })
      .limit(10);

    const entries = (entriesData as JournalEntry[]) || [];

    // Step 3: Fetch ALL posted journal entries in chronological order for balance history computation
    const { data: orderedEntries } = await supabase.from('journal_entries')
      .select('id')
      .eq('is_posted', true)
      .order('entry_date', { ascending: true })
      .order('created_at', { ascending: true });

    const orderedEntryIds = (orderedEntries || []).map(e => e.id);

    // Step 4: Fetch all journal lines for those entries
    let allLines: any[] = [];
    if (orderedEntryIds.length > 0) {
      // Fetch in batches to avoid URL length limits
      const batchSize = 100;
      for (let i = 0; i < orderedEntryIds.length; i += batchSize) {
        const batchIds = orderedEntryIds.slice(i, i + batchSize);
        const { data: batchLines } = await supabase.from('journal_lines')
          .select('journal_entry_id, account_id, debit, credit')
          .in('journal_entry_id', batchIds);
        if (batchLines) {
          // Sort lines by their entry's position in orderedEntryIds
          const lineSorter = (a: any, b: any) => {
            const idxA = orderedEntryIds.indexOf(a.journal_entry_id);
            const idxB = orderedEntryIds.indexOf(b.journal_entry_id);
            return idxA - idxB;
          };
          allLines = allLines.concat(batchLines);
        }
      }
    }

    // Sort all lines by their entry's chronological order
    const entryOrderIndex = new Map<string, number>();
    orderedEntryIds.forEach((id, idx) => entryOrderIndex.set(id, idx));
    allLines.sort((a, b) => (entryOrderIndex.get(a.journal_entry_id) ?? 0) - (entryOrderIndex.get(b.journal_entry_id) ?? 0));

    // Step 5: Group lines by entry
    const linesByEntry = new Map<string, any[]>();
    for (const l of allLines) {
      const jeId = l.journal_entry_id;
      if (!linesByEntry.has(jeId)) {
        linesByEntry.set(jeId, []);
      }
      linesByEntry.get(jeId)!.push(l);
    }

    // Step 6: Compute running balance per account going through entries chronologically
    const runningBalance = new Map<string, number>();
    const balanceBeforeEntry = new Map<string, Map<string, number>>(); // entryId -> (accountId -> balance before)
    const balanceAfterEntry = new Map<string, Map<string, number>>(); // entryId -> (accountId -> balance after)

    for (const jeId of orderedEntryIds) {
      // Snapshot balance before this entry
      const before = new Map<string, number>();
      for (const [accId, bal] of runningBalance) {
        before.set(accId, bal);
      }
      balanceBeforeEntry.set(jeId, before);

      // Apply this entry's lines to running balance
      const lines = linesByEntry.get(jeId) || [];
      for (const l of lines) {
        const accId = l.account_id;
        const debit = Number(l.debit || 0);
        const credit = Number(l.credit || 0);
        const current = runningBalance.get(accId) || 0;
        runningBalance.set(accId, current + debit - credit);
      }

      // Snapshot balance after this entry
      const after = new Map<string, number>();
      for (const [accId, bal] of runningBalance) {
        after.set(accId, bal);
      }
      balanceAfterEntry.set(jeId, after);
    }

    // Step 7: Attach computed balances to each recent entry's lines
    for (const entry of entries) {
      if (!entry.lines) continue;
      const afterMap = balanceAfterEntry.get(entry.id);
      const beforeMap = balanceBeforeEntry.get(entry.id);
      for (const line of entry.lines) {
        const acc = Array.isArray(line.account) ? line.account[0] : line.account;
        if (!acc) continue;
        const rawAfter = afterMap?.get(line.account_id) ?? 0;
        const rawBefore = beforeMap?.get(line.account_id) ?? 0;
        const isDebit = acc.account_type && ['asset', 'expense'].includes(acc.account_type);
        (line as any)._balanceBefore = isDebit ? rawBefore : -rawBefore;
        (line as any)._balanceAfter = isDebit ? rawAfter : -rawAfter;
      }
    }

    setRecentEntries(entries);

    // Load manual receivables
    const { data: receivableEntries } = await supabase.from('journal_entries')
      .select('id, entry_number, entry_date, description, total_debit')
      .eq('is_posted', true)
      .eq('reference_type', 'receivable')
      .order('entry_date', { ascending: false });

    const { data: receivablePayments } = await supabase.from('payments')
      .select('reference_id, amount')
      .eq('reference_type', 'receivable');

    const receivablePaymentsMap = new Map<string, number>();
    (receivablePayments || []).forEach(p => {
      const current = receivablePaymentsMap.get(p.reference_id) || 0;
      receivablePaymentsMap.set(p.reference_id, current + Number(p.amount));
    });

    const receivablesList: ManualReceivablePayable[] = [];
    for (const entry of (receivableEntries || [])) {
      const paidAmount = receivablePaymentsMap.get(entry.id) || 0;
      const outstanding = Number(entry.total_debit) - paidAmount;
      if (outstanding > 0) {
        // Get customer info from journal_lines -> related customer
        const { data: lineData } = await supabase.from('journal_lines')
          .select('description')
          .eq('journal_entry_id', entry.id)
          .eq('debit', 0)
          .maybeSingle();

        receivablesList.push({
          id: entry.id,
          entry_number: entry.entry_number,
          entry_date: entry.entry_date,
          description: entry.description,
          amount: Number(entry.total_debit),
          paid_amount: paidAmount,
          outstanding_balance: outstanding,
          party_name: lineData?.description?.replace('Receivable from ', '') || 'Customer',
        });
      }
    }
    setManualReceivables(receivablesList);

    // Load manual payables
    const { data: payableEntries } = await supabase.from('journal_entries')
      .select('id, entry_number, entry_date, description, total_credit')
      .eq('is_posted', true)
      .eq('reference_type', 'payable')
      .order('entry_date', { ascending: false });

    const { data: payablePayments } = await supabase.from('payments')
      .select('reference_id, amount')
      .eq('reference_type', 'payable');

    const payablePaymentsMap = new Map<string, number>();
    (payablePayments || []).forEach(p => {
      const current = payablePaymentsMap.get(p.reference_id) || 0;
      payablePaymentsMap.set(p.reference_id, current + Number(p.amount));
    });

    const payablesList: ManualReceivablePayable[] = [];
    for (const entry of (payableEntries || [])) {
      const paidAmount = payablePaymentsMap.get(entry.id) || 0;
      const outstanding = Number(entry.total_credit) - paidAmount;
      if (outstanding > 0) {
        const { data: lineData } = await supabase.from('journal_lines')
          .select('description')
          .eq('journal_entry_id', entry.id)
          .eq('credit', 0)
          .maybeSingle();

        payablesList.push({
          id: entry.id,
          entry_number: entry.entry_number,
          entry_date: entry.entry_date,
          description: entry.description,
          amount: Number(entry.total_credit),
          paid_amount: paidAmount,
          outstanding_balance: outstanding,
          party_name: lineData?.description?.replace('Payable to ', '') || 'Supplier',
        });
      }
    }
    setManualPayables(payablesList);

    setLoading(false);
  }

  const assets = accounts.filter(a => a.account_type === 'asset');
  const liabilities = accounts.filter(a => a.account_type === 'liability');
  const revenue = accounts.filter(a => a.account_type === 'revenue');
  const expenses = accounts.filter(a => a.account_type === 'expense');

  const totalAssets = assets.reduce((s, a) => s + Number(a.balance), 0);
  const totalLiabilities = liabilities.reduce((s, a) => s + Number(a.balance), 0);
  const totalRevenue = revenue.reduce((s, a) => s + Number(a.balance), 0);
  const totalExpenses = expenses.reduce((s, a) => s + Number(a.balance), 0);
  const netProfit = totalRevenue - totalExpenses;

  useEffect(() => {
    async function loadMonthlyData() {
      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5);
      sixMonthsAgo.setDate(1);

      const { data: entries } = await supabase
        .from('journal_entries')
        .select('entry_date, total_debit, total_credit, reference_type')
        .gte('entry_date', sixMonthsAgo.toISOString().split('T')[0])
        .order('entry_date');

      if (!entries) return;

      const monthMap = new Map<string, { income: number; expense: number }>();
      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

      entries.forEach((entry: any) => {
        const date = new Date(entry.entry_date);
        const monthKey = monthNames[date.getMonth()];

        if (!monthMap.has(monthKey)) {
          monthMap.set(monthKey, { income: 0, expense: 0 });
        }

        const monthData = monthMap.get(monthKey)!;
        if (entry.reference_type === 'invoice') {
          monthData.income += Number(entry.total_credit);
        }
      });

      if (monthMap.size === 0) {
        setMonthlyData([
          { month: 'Jan', income: 0, expense: 0 },
          { month: 'Feb', income: 0, expense: 0 },
          { month: 'Mar', income: 0, expense: 0 },
          { month: 'Apr', income: 0, expense: 0 },
          { month: 'May', income: 0, expense: 0 },
          { month: 'Jun', income: 0, expense: 0 },
        ]);
      } else {
        setMonthlyData(Array.from(monthMap.entries()).map(([month, data]) => ({
          month,
          income: data.income,
          expense: data.expense,
        })));
      }
    }
    loadMonthlyData();
  }, []);

  const typeColors: Record<string, string> = {
    asset: 'text-blue-600 bg-blue-50',
    liability: 'text-red-600 bg-red-50',
    equity: 'text-purple-600 bg-purple-50',
    revenue: 'text-green-600 bg-green-50',
    expense: 'text-orange-600 bg-orange-50',
  };

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Accounting</h1>
          <p className="text-muted-foreground text-sm mt-0.5">Financial overview with automated double-entry</p>
        </div>
        <div className="flex items-center gap-2">
          <RecordDropdown
            onExpense={() => setModalType('expense')}
            onReceivable={() => setModalType('receivable')}
            onPayable={() => setModalType('payable')}
          />
          {modalType === 'expense' && <QuickExpenseModal accounts={accounts} onSaved={loadData} onClose={() => setModalType(null)} />}
          {modalType === 'receivable' && <RecordReceivableModal accounts={accounts} onSaved={loadData} onClose={() => setModalType(null)} />}
          {modalType === 'payable' && <RecordPayableModal accounts={accounts} onSaved={loadData} onClose={() => setModalType(null)} />}
        </div>
      </div>

      {/* Financial Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Total Assets', value: totalAssets, icon: DollarSign, color: 'text-blue-500 bg-blue-50' },
          { label: 'Total Liabilities', value: totalLiabilities, icon: CreditCard, color: 'text-red-500 bg-red-50' },
          { label: 'Revenue', value: totalRevenue, icon: TrendingUp, color: 'text-green-500 bg-green-50' },
          { label: 'Net Profit', value: netProfit, icon: BarChart3, color: netProfit >= 0 ? 'text-purple-500 bg-purple-50' : 'text-red-500 bg-red-50' },
        ].map(s => (
          <div key={s.label} className="stat-card">
            <div className="flex items-center justify-between mb-2">
              <div className={`w-9 h-9 rounded-full flex items-center justify-center ${s.color}`}>
                <s.icon className="w-4.5 h-4.5" />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">{s.label}</p>
            <p className={`text-xl font-bold mt-0.5 ${Number(s.value) >= 0 ? 'text-foreground' : 'text-red-600'}`}>
              {formatCurrency(Math.abs(Number(s.value)))}
            </p>
          </div>
        ))}
      </div>

      {/* Income vs Expense Chart */}
      <div className="bg-white rounded-xl border border-border p-5 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-foreground">Revenue Overview</h3>
          <span className="text-xs text-muted-foreground">Last 6 months</span>
        </div>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={monthlyData} barSize={20} barGap={4}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} tickFormatter={v => v >= 1000 ? `${(v/1000).toFixed(0)}K` : v} />
            <Tooltip formatter={(v: number) => [formatCurrency(v), '']} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
            <Bar dataKey="income" fill="#10b981" radius={[4, 4, 0, 0]} name="Revenue" />
            <Bar dataKey="expense" fill="#ef4444" radius={[4, 4, 0, 0]} name="Expenses" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Chart of Accounts */}
      <div className="table-wrapper">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">Chart of Accounts</h3>
          <span className="text-xs text-muted-foreground">{accounts.length} active accounts</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-muted/40 border-b border-border">
                <th className="text-left text-xs font-semibold text-muted-foreground px-4 py-3">Code</th>
                <th className="text-left text-xs font-semibold text-muted-foreground px-4 py-3">Account Name</th>
                <th className="text-left text-xs font-semibold text-muted-foreground px-4 py-3">Type</th>
                <th className="text-right text-xs font-semibold text-muted-foreground px-4 py-3">Balance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i}>{Array.from({ length: 4 }).map((_, j) => <td key={j} className="px-4 py-3"><div className="h-4 bg-muted rounded animate-pulse" /></td>)}</tr>
                ))
              ) : accounts.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground text-sm">
                    No accounts configured. Accounts are created automatically when transactions occur.
                  </td>
                </tr>
              ) : (
                accounts.map(a => (
                  <tr key={a.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 text-sm font-mono text-muted-foreground">{a.code}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-foreground">{a.name}</span>
                        {a.is_cash && <span className="badge-status bg-green-50 text-green-600">Cash</span>}
                        {a.is_bank && <span className="badge-status bg-blue-50 text-blue-600">Bank</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`badge-status ${typeColors[a.account_type] || 'bg-gray-100 text-gray-600'} capitalize`}>
                        {a.account_type}
                      </span>
                    </td>
                    <td className={`px-4 py-3 text-right text-sm font-bold ${
                      a.account_type === 'expense' ? 'text-red-600' :
                      a.account_type === 'liability' ? 'text-red-600' :
                      'text-green-600'
                    }`}>
                      {formatCurrency(Math.abs(Number(a.balance)))}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Manual Receivables Management */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="bg-white rounded-xl border border-border shadow-sm">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <div className="flex items-center gap-2">
              <User className="w-4 h-4 text-green-600" />
              <h3 className="text-sm font-semibold text-foreground">Manual Receivables</h3>
            </div>
            <span className="text-xs text-muted-foreground">{manualReceivables.length} outstanding</span>
          </div>
          <div className="max-h-[300px] overflow-y-auto">
            {manualReceivables.length === 0 ? (
              <div className="p-6 text-center text-muted-foreground text-sm">
                <CheckCircle2 className="w-8 h-8 mx-auto mb-2 text-green-200" />
                No outstanding manual receivables
              </div>
            ) : (
              <div className="divide-y divide-border">
                {manualReceivables.map(r => (
                  <div key={r.id} className="p-3 hover:bg-muted/30 transition">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-mono text-muted-foreground">{r.entry_number}</span>
                      <span className="text-xs text-muted-foreground">{formatDate(r.entry_date)}</span>
                    </div>
                    <p className="text-sm text-foreground mb-1 truncate">{r.party_name}</p>
                    <div className="flex items-center justify-between">
                      <div className="text-xs">
                        <span className="text-muted-foreground">Outstanding: </span>
                        <span className="font-bold text-red-600">{formatCurrency(r.outstanding_balance)}</span>
                        <span className="text-muted-foreground ml-2">of {formatCurrency(r.amount)}</span>
                      </div>
                      <button
                        onClick={() => setShowReceivablePayment(r)}
                        className="text-xs px-2 py-1 bg-green-50 text-green-700 rounded hover:bg-green-100 transition font-medium"
                      >
                        Collect
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Manual Payables Management */}
        <div className="bg-white rounded-xl border border-border shadow-sm">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Building2 className="w-4 h-4 text-amber-600" />
              <h3 className="text-sm font-semibold text-foreground">Manual Payables</h3>
            </div>
            <span className="text-xs text-muted-foreground">{manualPayables.length} outstanding</span>
          </div>
          <div className="max-h-[300px] overflow-y-auto">
            {manualPayables.length === 0 ? (
              <div className="p-6 text-center text-muted-foreground text-sm">
                <CheckCircle2 className="w-8 h-8 mx-auto mb-2 text-amber-200" />
                No outstanding manual payables
              </div>
            ) : (
              <div className="divide-y divide-border">
                {manualPayables.map(p => (
                  <div key={p.id} className="p-3 hover:bg-muted/30 transition">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-mono text-muted-foreground">{p.entry_number}</span>
                      <span className="text-xs text-muted-foreground">{formatDate(p.entry_date)}</span>
                    </div>
                    <p className="text-sm text-foreground mb-1 truncate">{p.party_name}</p>
                    <div className="flex items-center justify-between">
                      <div className="text-xs">
                        <span className="text-muted-foreground">Outstanding: </span>
                        <span className="font-bold text-amber-600">{formatCurrency(p.outstanding_balance)}</span>
                        <span className="text-muted-foreground ml-2">of {formatCurrency(p.amount)}</span>
                      </div>
                      <button
                        onClick={() => setShowPayablePayment(p)}
                        className="text-xs px-2 py-1 bg-amber-50 text-amber-700 rounded hover:bg-amber-100 transition font-medium"
                      >
                        Pay
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Recent Transactions */}
      <div className="bg-white rounded-xl border border-border shadow-sm">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">Recent Journal Entries</h3>
          <Link href="/accounting/journal" className="text-xs text-blue-600 hover:underline flex items-center gap-1">
            View All <ExternalLink className="w-3 h-3" />
          </Link>
        </div>
        <div className="max-h-[400px] overflow-y-auto">
          {recentEntries.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground text-sm">No journal entries yet</div>
          ) : (
            <div className="divide-y divide-border">
              {recentEntries.map(entry => (
                <div key={entry.id} className="p-4 hover:bg-muted/30 transition">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono text-muted-foreground">{entry.entry_number}</span>
                      <span className="badge-status bg-gray-100 text-gray-600 text-[10px] capitalize">
                        {entry.reference_type?.replace('_', ' ') || 'manual'}
                      </span>
                    </div>
                    <span className="text-xs text-muted-foreground">{formatDate(entry.entry_date)}</span>
                  </div>
                  <p className="text-sm text-foreground mb-2">{entry.description || 'No description'}</p>
                  {entry.lines && entry.lines.length > 0 && (
                    <div className="space-y-1 text-xs">
                      {entry.lines.map((line, idx) => {
                        const account = Array.isArray(line.account) ? line.account[0] : line.account;
                        const previousBalance = (line as any)._balanceBefore ?? 0;
                        const currentBalance = (line as any)._balanceAfter ?? 0;

                        return (
                          <div key={line.id || idx} className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              {Number(line.debit) > 0 ? (
                                <ArrowUpRight className="w-3 h-3 text-green-600" />
                              ) : (
                                <ArrowDownLeft className="w-3 h-3 text-red-600" />
                              )}
                              <span className="text-muted-foreground">{account?.name || 'Account'}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-muted-foreground">
                                {formatCurrency(previousBalance)} → <span className="font-medium text-foreground">{formatCurrency(currentBalance)}</span>
                              </span>
                              <span className={Number(line.debit) > 0 ? 'text-green-600 font-medium' : 'text-red-600 font-medium'}>
                                {Number(line.debit) > 0 ? `Dr. ${formatCurrency(line.debit)}` : `Cr. ${formatCurrency(line.credit)}`}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {showReceivablePayment && (
        <RecordReceivablePaymentModal
          receivable={showReceivablePayment}
          accounts={accounts}
          onClose={() => setShowReceivablePayment(null)}
          onSaved={loadData}
        />
      )}

      {showPayablePayment && (
        <RecordPayablePaymentModal
          payable={showPayablePayment}
          accounts={accounts}
          onClose={() => setShowPayablePayment(null)}
          onSaved={loadData}
        />
      )}
    </div>
  );
}

function RecordDropdown({ onExpense, onReceivable, onPayable }: { onExpense: () => void; onReceivable: () => void; onPayable: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const options = [
    { label: 'Record Expense', desc: 'Rent, salary, utility, etc.', icon: Receipt, color: 'text-blue-600 bg-blue-50', onClick: onExpense },
    { label: 'Record Receivable', desc: 'Money owed by a customer', icon: User, color: 'text-green-600 bg-green-50', onClick: onReceivable },
    { label: 'Record Payable', desc: 'Money owed to a supplier', icon: Building2, color: 'text-amber-600 bg-amber-50', onClick: onPayable },
  ];

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-semibold transition"
      >
        <Plus className="w-4 h-4" />Record
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 bg-white border border-border rounded-xl shadow-lg z-50 w-64 overflow-hidden">
          {options.map((opt, i) => (
            <button
              key={i}
              onClick={() => { opt.onClick(); setOpen(false); }}
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/50 transition text-left border-b border-border/50 last:border-0"
            >
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${opt.color}`}>
                <opt.icon className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground">{opt.label}</p>
                <p className="text-xs text-muted-foreground truncate">{opt.desc}</p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function QuickExpenseModal({ accounts, onSaved, onClose }: { accounts: Account[]; onSaved: () => void; onClose: () => void }) {
  const [form, setForm] = useState({
    date: new Date().toISOString().split('T')[0],
    amount: '',
    expense_account: '',
    paid_from: '',
    description: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const expenseAccounts = accounts.filter(a => a.account_type === 'expense');
  const cashBankAccounts = accounts.filter(a => a.is_cash || a.is_bank || a.code === '1000' || a.code === '1010');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (!form.expense_account || !form.paid_from || !form.amount || parseFloat(form.amount) <= 0) {
      setError('Please fill all required fields');
      return;
    }

    setSaving(true);

    try {
      const amount = parseFloat(form.amount);
      const entryNumber = await supabase.rpc('get_next_journal_number');

      const { data: entry } = await supabase
        .from('journal_entries')
        .insert({
          entry_number: entryNumber.data || `JE-${Date.now().toString().slice(-6)}`,
          entry_date: form.date,
          description: form.description || 'Expense payment',
          reference_type: 'manual',
          total_debit: amount,
          total_credit: amount,
          is_posted: true,
        })
        .select()
        .single();

      if (!entry) throw new Error('Failed to create entry');

      // Create journal lines
      await supabase.from('journal_lines').insert([
        { journal_entry_id: entry.id, account_id: form.expense_account, description: form.description, debit: amount, credit: 0, sort_order: 0 },
        { journal_entry_id: entry.id, account_id: form.paid_from, description: form.description, debit: 0, credit: amount, sort_order: 1 },
      ]);

      // Update account balances
      const expenseAccount = accounts.find(a => a.id === form.expense_account);
      const cashAccount = accounts.find(a => a.id === form.paid_from);

      if (expenseAccount) {
        await supabase.from('accounts').update({ balance: (expenseAccount.balance || 0) + amount }).eq('id', form.expense_account);
      }
      if (cashAccount) {
        await supabase.from('accounts').update({ balance: (cashAccount.balance || 0) - amount }).eq('id', form.paid_from);
      }

      toast({ title: 'Success', description: 'Expense recorded successfully' });
      setForm({ date: new Date().toISOString().split('T')[0], amount: '', expense_account: '', paid_from: '', description: '' });
      onSaved();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to record expense');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-base font-bold">Quick Expense Entry</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
              {error && <div className="p-3 bg-red-50 text-red-600 rounded-lg text-sm">{error}</div>}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium mb-1">Date</label>
                  <input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} className="w-full border border-border rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Amount *</label>
                  <input type="number" required value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} placeholder="0" className="w-full border border-border rounded-lg px-3 py-2 text-sm" />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium mb-1">Expense Type *</label>
                <select required value={form.expense_account} onChange={e => setForm({ ...form, expense_account: e.target.value })} className="w-full border border-border rounded-lg px-3 py-2 text-sm">
                  <option value="">Select expense category</option>
                  {expenseAccounts.map(a => (
                    <option key={a.id} value={a.id}>{a.code} - {a.name}</option>
                  ))}
                  <option value="create_new">+ Add New Expense Account</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium mb-1">Paid From *</label>
                <select required value={form.paid_from} onChange={e => setForm({ ...form, paid_from: e.target.value })} className="w-full border border-border rounded-lg px-3 py-2 text-sm">
                  <option value="">Select cash/bank account</option>
                  {cashBankAccounts.map(a => (
                    <option key={a.id} value={a.id}>{a.code} - {a.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium mb-1">Description</label>
                <input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="e.g. Office supplies, Rent payment" className="w-full border border-border rounded-lg px-3 py-2 text-sm" />
              </div>

              <div className="flex gap-3 pt-2">
                <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border border-border rounded-lg text-sm hover:bg-muted transition">Cancel</button>
                <button type="submit" disabled={saving} className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold transition disabled:opacity-60">
                  {saving ? 'Saving...' : 'Record Expense'}
                </button>
              </div>
            </form>
          </div>
        </div>
  );
}

function RecordReceivableModal({ accounts, onSaved, onClose }: { accounts: Account[]; onSaved: () => void; onClose: () => void }) {
  const [customers, setCustomers] = useState<any[]>([]);
  const [form, setForm] = useState({
    customer_id: '',
    amount: '',
    description: '',
    due_date: '',
    date: new Date().toISOString().split('T')[0],
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const arAccount = accounts.find(a => a.code === '1100');

  useEffect(() => {
    supabase.from('customers').select('id, name, code, phone').eq('is_active', true).order('name')
      .then(({ data }) => setCustomers(data || []));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (!form.customer_id || !form.amount || parseFloat(form.amount) <= 0) {
      setError('Please select a customer and enter an amount');
      return;
    }

    setSaving(true);

    try {
      const amount = parseFloat(form.amount);
      const entryNumber = `JE-${Date.now().toString().slice(-6)}`;
      const customer = customers.find(c => c.id === form.customer_id);
      const desc = form.description || `Receivable from ${customer?.name || 'Customer'}`;

      const { data: entry, error: entryError } = await supabase
        .from('journal_entries')
        .insert({
          entry_number: entryNumber,
          entry_date: form.date,
          description: desc,
          reference_type: 'receivable',
          total_debit: amount,
          total_credit: amount,
          is_posted: true,
          customer_id: form.customer_id,
        })
        .select()
        .single();

      if (entryError) throw entryError;

      const revenueAccount = accounts.find(a => a.code === '4000');
      if (!arAccount || !revenueAccount) throw new Error('Required accounts (1100, 4000) not found');

      await supabase.from('journal_lines').insert([
        { journal_entry_id: entry.id, account_id: arAccount.id, description: desc, debit: amount, credit: 0, sort_order: 0 },
        { journal_entry_id: entry.id, account_id: revenueAccount.id, description: desc, debit: 0, credit: amount, sort_order: 1 },
      ]);

      await supabase.from('accounts').update({ balance: (arAccount.balance || 0) + amount }).eq('id', arAccount.id);
      await supabase.from('accounts').update({ balance: (revenueAccount.balance || 0) + amount }).eq('id', revenueAccount.id);

      if (customer) {
        await supabase.from('customers').update({
          outstanding_balance: (customer.outstanding_balance || 0) + amount,
          total_purchases: (customer.total_purchases || 0) + amount,
        }).eq('id', customer.id);
      }

      toast({ title: 'Success', description: `Receivable of ${formatCurrency(amount)} recorded` });
      setForm({ customer_id: '', amount: '', description: '', due_date: '', date: new Date().toISOString().split('T')[0] });
      onSaved();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to record receivable');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-base font-bold flex items-center gap-2"><User className="w-4 h-4" />Record Receivable</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
              {error && <div className="p-3 bg-red-50 text-red-600 rounded-lg text-sm">{error}</div>}

              <div>
                <label className="block text-xs font-medium mb-1">Customer *</label>
                <select required value={form.customer_id} onChange={e => setForm({ ...form, customer_id: e.target.value })} className="w-full border border-border rounded-lg px-3 py-2 text-sm">
                  <option value="">Select customer</option>
                  {customers.map(c => <option key={c.id} value={c.id}>{c.name} ({c.code})</option>)}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium mb-1">Amount *</label>
                  <input type="number" required min="0.01" step="0.01" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} placeholder="0.00" className="w-full border border-border rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Date</label>
                  <input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} className="w-full border border-border rounded-lg px-3 py-2 text-sm" />
                </div>
              </div>

              <div className="bg-muted/30 rounded-lg p-3 text-xs text-muted-foreground">
                Dr. Accounts Receivable ({arAccount?.code}) &rarr; Cr. Sales Revenue (4000)
              </div>

              <div>
                <label className="block text-xs font-medium mb-1">Description</label>
                <input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="e.g. Credit sale, Service billed..." className="w-full border border-border rounded-lg px-3 py-2 text-sm" />
              </div>

              <div className="flex gap-3 pt-2">
                <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border border-border rounded-lg text-sm hover:bg-muted transition">Cancel</button>
                <button type="submit" disabled={saving} className="flex-1 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-semibold transition disabled:opacity-60">
                  {saving ? 'Saving...' : 'Record'}
                </button>
              </div>
            </form>
      </div>
    </div>
  );
}

function RecordPayableModal({ accounts, onSaved, onClose }: { accounts: Account[]; onSaved: () => void; onClose: () => void }) {
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [form, setForm] = useState({
    supplier_id: '',
    amount: '',
    description: '',
    date: new Date().toISOString().split('T')[0],
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const apAccount = accounts.find(a => a.code === '2000');

  useEffect(() => {
    supabase.from('suppliers').select('id, name, code, phone').eq('is_active', true).order('name')
      .then(({ data }) => setSuppliers(data || []));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (!form.supplier_id || !form.amount || parseFloat(form.amount) <= 0) {
      setError('Please select a supplier and enter an amount');
      return;
    }

    setSaving(true);

    try {
      const amount = parseFloat(form.amount);
      const entryNumber = `JE-${Date.now().toString().slice(-6)}`;
      const supplier = suppliers.find(s => s.id === form.supplier_id);
      const desc = form.description || `Payable to ${supplier?.name || 'Supplier'}`;

      const { data: entry, error: entryError } = await supabase
        .from('journal_entries')
        .insert({
          entry_number: entryNumber,
          entry_date: form.date,
          description: desc,
          reference_type: 'payable',
          total_debit: amount,
          total_credit: amount,
          is_posted: true,
          supplier_id: form.supplier_id,
        })
        .select()
        .single();

      if (entryError) throw entryError;

      const inventoryAccount = accounts.find(a => a.code === '1200');
      if (!apAccount || !inventoryAccount) throw new Error('Required accounts (2000, 1200) not found');

      await supabase.from('journal_lines').insert([
        { journal_entry_id: entry.id, account_id: inventoryAccount.id, description: desc, debit: amount, credit: 0, sort_order: 0 },
        { journal_entry_id: entry.id, account_id: apAccount.id, description: desc, debit: 0, credit: amount, sort_order: 1 },
      ]);

      await supabase.from('accounts').update({ balance: (inventoryAccount.balance || 0) + amount }).eq('id', inventoryAccount.id);
      await supabase.from('accounts').update({ balance: (apAccount.balance || 0) + amount }).eq('id', apAccount.id);

      if (supplier) {
        const { data: current } = await supabase.from('suppliers').select('outstanding_balance').eq('id', supplier.id).maybeSingle();
        await supabase.from('suppliers').update({
          outstanding_balance: (current?.outstanding_balance || 0) + amount,
        }).eq('id', supplier.id);
      }

      toast({ title: 'Success', description: `Payable of ${formatCurrency(amount)} recorded` });
      setForm({ supplier_id: '', amount: '', description: '', date: new Date().toISOString().split('T')[0] });
      onSaved();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to record payable');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-base font-bold flex items-center gap-2"><Building2 className="w-4 h-4" />Record Payable</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
              {error && <div className="p-3 bg-red-50 text-red-600 rounded-lg text-sm">{error}</div>}

              <div>
                <label className="block text-xs font-medium mb-1">Supplier *</label>
                <select required value={form.supplier_id} onChange={e => setForm({ ...form, supplier_id: e.target.value })} className="w-full border border-border rounded-lg px-3 py-2 text-sm">
                  <option value="">Select supplier</option>
                  {suppliers.map(s => <option key={s.id} value={s.id}>{s.name} ({s.code})</option>)}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium mb-1">Amount *</label>
                  <input type="number" required min="0.01" step="0.01" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} placeholder="0.00" className="w-full border border-border rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Date</label>
                  <input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} className="w-full border border-border rounded-lg px-3 py-2 text-sm" />
                </div>
              </div>

              <div className="bg-muted/30 rounded-lg p-3 text-xs text-muted-foreground">
                Dr. Inventory Asset (1200) &rarr; Cr. Accounts Payable ({apAccount?.code})
              </div>

              <div>
                <label className="block text-xs font-medium mb-1">Description</label>
                <input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="e.g. Goods received on credit, Purchase invoice..." className="w-full border border-border rounded-lg px-3 py-2 text-sm" />
              </div>

              <div className="flex gap-3 pt-2">
                <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border border-border rounded-lg text-sm hover:bg-muted transition">Cancel</button>
                <button type="submit" disabled={saving} className="flex-1 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-sm font-semibold transition disabled:opacity-60">
                  {saving ? 'Saving...' : 'Record'}
                </button>
              </div>
            </form>
      </div>
    </div>
  );
}

function RecordReceivablePaymentModal({
  receivable,
  accounts,
  onClose,
  onSaved
}: {
  receivable: ManualReceivablePayable;
  accounts: Account[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    amount: receivable.outstanding_balance,
    payment_date: new Date().toISOString().split('T')[0],
    payment_method: 'cash',
    account_id: '',
    reference_number: '',
    notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const arAccount = accounts.find(a => a.code === '1100');
  const cashBankAccounts = accounts.filter(a => a.is_cash || a.is_bank || a.code === '1000' || a.code === '1010');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (!form.account_id || form.amount <= 0) {
      setError('Please select a cash/bank account and enter a valid amount');
      return;
    }

    if (form.amount > receivable.outstanding_balance) {
      setError(`Amount cannot exceed outstanding balance (${formatCurrency(receivable.outstanding_balance)})`);
      return;
    }

    setSaving(true);

    try {
      const paymentNumber = `PAY-${Date.now().toString().slice(-6)}`;
      const amount = form.amount;
      const desc = form.notes || `Payment received for ${receivable.entry_number}`;

      // 1. Create payment record
      const { error: payError } = await supabase.from('payments').insert({
        payment_number: paymentNumber,
        payment_type: 'received',
        reference_type: 'receivable',
        reference_id: receivable.id,
        amount: amount,
        payment_method: form.payment_method,
        payment_date: form.payment_date,
        reference_number: form.reference_number || null,
        notes: form.notes || null,
      });

      if (payError) throw payError;

      // 2. Create journal entry: DR Cash/Bank, CR Accounts Receivable
      const entryNumber = `JE-${Date.now().toString().slice(-6)}`;
      const { data: entry, error: entryError } = await supabase
        .from('journal_entries')
        .insert({
          entry_number: entryNumber,
          entry_date: form.payment_date,
          description: desc,
          reference_type: 'payment',
          total_debit: amount,
          total_credit: amount,
          is_posted: true,
        })
        .select()
        .single();

      if (entryError) throw entryError;

      if (!arAccount) throw new Error('Accounts Receivable account not found');

      await supabase.from('journal_lines').insert([
        { journal_entry_id: entry.id, account_id: form.account_id, description: desc, debit: amount, credit: 0, sort_order: 0 },
        { journal_entry_id: entry.id, account_id: arAccount.id, description: desc, debit: 0, credit: amount, sort_order: 1 },
      ]);

      // 3. Update account balances
      const cashAccount = accounts.find(a => a.id === form.account_id);
      if (cashAccount) {
        await supabase.from('accounts').update({ balance: (cashAccount.balance || 0) + amount }).eq('id', form.account_id);
      }
      await supabase.from('accounts').update({ balance: (arAccount.balance || 0) - amount }).eq('id', arAccount.id);

      toast({ title: 'Success', description: `Payment of ${formatCurrency(amount)} recorded` });
      onSaved();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to record payment');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-base font-bold flex items-center gap-2">
            <HandCoins className="w-4 h-4 text-green-600" />
            Collect Receivable Payment
          </h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && <div className="p-3 bg-red-50 text-red-600 rounded-lg text-sm">{error}</div>}

          <div className="bg-muted/30 rounded-lg p-3 space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Receivable:</span>
              <span className="font-mono">{receivable.entry_number}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Party:</span>
              <span className="font-medium">{receivable.party_name}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Outstanding:</span>
              <span className="font-bold text-red-600">{formatCurrency(receivable.outstanding_balance)}</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium mb-1">Amount *</label>
              <input
                type="number"
                required
                min="0.01"
                max={receivable.outstanding_balance}
                step="0.01"
                value={form.amount}
                onChange={e => setForm({ ...form, amount: parseFloat(e.target.value) || 0 })}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Date</label>
              <input
                type="date"
                value={form.payment_date}
                onChange={e => setForm({ ...form, payment_date: e.target.value })}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium mb-1">Method</label>
              <select
                value={form.payment_method}
                onChange={e => setForm({ ...form, payment_method: e.target.value })}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm"
              >
                <option value="cash">Cash</option>
                <option value="bank_transfer">Bank Transfer</option>
                <option value="card">Card</option>
                <option value="cheque">Cheque</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Receive Into *</label>
              <select
                required
                value={form.account_id}
                onChange={e => setForm({ ...form, account_id: e.target.value })}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm"
              >
                <option value="">Select account</option>
                {cashBankAccounts.map(a => (
                  <option key={a.id} value={a.id}>{a.code} - {a.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium mb-1">Reference Number</label>
            <input
              value={form.reference_number}
              onChange={e => setForm({ ...form, reference_number: e.target.value })}
              placeholder="Cheque no., Transaction ID..."
              className="w-full border border-border rounded-lg px-3 py-2 text-sm"
            />
          </div>

          <div className="bg-muted/30 rounded-lg p-3 text-xs text-muted-foreground">
            Dr. Cash/Bank &rarr; Cr. Accounts Receivable (1100)
          </div>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border border-border rounded-lg text-sm hover:bg-muted transition">Cancel</button>
            <button type="submit" disabled={saving} className="flex-1 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-semibold transition disabled:opacity-60">
              {saving ? 'Saving...' : 'Record Payment'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function RecordPayablePaymentModal({
  payable,
  accounts,
  onClose,
  onSaved
}: {
  payable: ManualReceivablePayable;
  accounts: Account[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    amount: payable.outstanding_balance,
    payment_date: new Date().toISOString().split('T')[0],
    payment_method: 'cash',
    account_id: '',
    reference_number: '',
    notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const apAccount = accounts.find(a => a.code === '2000');
  const cashBankAccounts = accounts.filter(a => a.is_cash || a.is_bank || a.code === '1000' || a.code === '1010');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (!form.account_id || form.amount <= 0) {
      setError('Please select a cash/bank account and enter a valid amount');
      return;
    }

    if (form.amount > payable.outstanding_balance) {
      setError(`Amount cannot exceed outstanding balance (${formatCurrency(payable.outstanding_balance)})`);
      return;
    }

    setSaving(true);

    try {
      const paymentNumber = `PAY-${Date.now().toString().slice(-6)}`;
      const amount = form.amount;
      const desc = form.notes || `Payment made for ${payable.entry_number}`;

      // 1. Create payment record
      const { error: payError } = await supabase.from('payments').insert({
        payment_number: paymentNumber,
        payment_type: 'made',
        reference_type: 'payable',
        reference_id: payable.id,
        amount: amount,
        payment_method: form.payment_method,
        payment_date: form.payment_date,
        reference_number: form.reference_number || null,
        notes: form.notes || null,
      });

      if (payError) throw payError;

      // 2. Create journal entry: DR Accounts Payable, CR Cash/Bank
      const entryNumber = `JE-${Date.now().toString().slice(-6)}`;
      const { data: entry, error: entryError } = await supabase
        .from('journal_entries')
        .insert({
          entry_number: entryNumber,
          entry_date: form.payment_date,
          description: desc,
          reference_type: 'payment',
          total_debit: amount,
          total_credit: amount,
          is_posted: true,
        })
        .select()
        .single();

      if (entryError) throw entryError;

      if (!apAccount) throw new Error('Accounts Payable account not found');

      await supabase.from('journal_lines').insert([
        { journal_entry_id: entry.id, account_id: apAccount.id, description: desc, debit: amount, credit: 0, sort_order: 0 },
        { journal_entry_id: entry.id, account_id: form.account_id, description: desc, debit: 0, credit: amount, sort_order: 1 },
      ]);

      // 3. Update account balances
      const cashAccount = accounts.find(a => a.id === form.account_id);
      if (cashAccount) {
        await supabase.from('accounts').update({ balance: (cashAccount.balance || 0) - amount }).eq('id', form.account_id);
      }
      await supabase.from('accounts').update({ balance: (apAccount.balance || 0) - amount }).eq('id', apAccount.id);

      toast({ title: 'Success', description: `Payment of ${formatCurrency(amount)} recorded` });
      onSaved();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to record payment');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-base font-bold flex items-center gap-2">
            <HandCoins className="w-4 h-4 text-amber-600" />
            Pay Payable
          </h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && <div className="p-3 bg-red-50 text-red-600 rounded-lg text-sm">{error}</div>}

          <div className="bg-muted/30 rounded-lg p-3 space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Payable:</span>
              <span className="font-mono">{payable.entry_number}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Party:</span>
              <span className="font-medium">{payable.party_name}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Outstanding:</span>
              <span className="font-bold text-amber-600">{formatCurrency(payable.outstanding_balance)}</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium mb-1">Amount *</label>
              <input
                type="number"
                required
                min="0.01"
                max={payable.outstanding_balance}
                step="0.01"
                value={form.amount}
                onChange={e => setForm({ ...form, amount: parseFloat(e.target.value) || 0 })}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Date</label>
              <input
                type="date"
                value={form.payment_date}
                onChange={e => setForm({ ...form, payment_date: e.target.value })}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium mb-1">Method</label>
              <select
                value={form.payment_method}
                onChange={e => setForm({ ...form, payment_method: e.target.value })}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm"
              >
                <option value="cash">Cash</option>
                <option value="bank_transfer">Bank Transfer</option>
                <option value="card">Card</option>
                <option value="cheque">Cheque</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Pay From *</label>
              <select
                required
                value={form.account_id}
                onChange={e => setForm({ ...form, account_id: e.target.value })}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm"
              >
                <option value="">Select account</option>
                {cashBankAccounts.map(a => (
                  <option key={a.id} value={a.id}>{a.code} - {a.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium mb-1">Reference Number</label>
            <input
              value={form.reference_number}
              onChange={e => setForm({ ...form, reference_number: e.target.value })}
              placeholder="Cheque no., Transaction ID..."
              className="w-full border border-border rounded-lg px-3 py-2 text-sm"
            />
          </div>

          <div className="bg-muted/30 rounded-lg p-3 text-xs text-muted-foreground">
            Dr. Accounts Payable (2000) &rarr; Cr. Cash/Bank
          </div>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border border-border rounded-lg text-sm hover:bg-muted transition">Cancel</button>
            <button type="submit" disabled={saving} className="flex-1 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-sm font-semibold transition disabled:opacity-60">
              {saving ? 'Saving...' : 'Record Payment'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
