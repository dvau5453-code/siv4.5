'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { formatCurrency } from '@/lib/format';
import { Calendar, Download, Printer, RefreshCw, Building2 } from 'lucide-react';

interface PnLData {
  salesRevenue: number;
  salesReturns: number;
  netSalesRevenue: number;
  serviceRevenue: number;
  totalRevenue: number;
  costOfGoodsSold: number;
  grossProfit: number;
  operatingExpenses: { name: string; amount: number }[];
  totalOperatingExpenses: number;
  operatingProfit: number;
  netProfit: number;
}

export default function PLPage() {
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<'month' | 'quarter' | 'year'>('month');
  const [periodLabel, setPeriodLabel] = useState('');

  const [data, setData] = useState<PnLData>({
    salesRevenue: 0,
    salesReturns: 0,
    netSalesRevenue: 0,
    serviceRevenue: 0,
    totalRevenue: 0,
    costOfGoodsSold: 0,
    grossProfit: 0,
    operatingExpenses: [],
    totalOperatingExpenses: 0,
    operatingProfit: 0,
    netProfit: 0,
  });

  const [companySettings, setCompanySettings] = useState({ name: 'SI Building Solutions.', address: '' });

  useEffect(() => { loadData(); loadSettings(); }, [period]);

  async function loadSettings() {
    const { data } = await supabase.from('app_settings').select('setting_value').eq('setting_key', 'company').maybeSingle();
    if (data?.setting_value) setCompanySettings(prev => ({ ...prev, ...data.setting_value }));
  }

  async function loadData() {
    setLoading(true);

    const now = new Date();
    let startDate: string;
    let endDate: string;
    let label: string;

    if (period === 'month') {
      startDate = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
      endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];
      label = `For the Month Ended ${new Date(now.getFullYear(), now.getMonth() + 1, 0).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`;
    } else if (period === 'quarter') {
      const qs = Math.floor(now.getMonth() / 3) * 3;
      startDate = new Date(now.getFullYear(), qs, 1).toISOString().split('T')[0];
      endDate = new Date(now.getFullYear(), qs + 3, 0).toISOString().split('T')[0];
      label = `For the Quarter Ended ${new Date(now.getFullYear(), qs + 3, 0).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`;
    } else {
      startDate = new Date(now.getFullYear(), 0, 1).toISOString().split('T')[0];
      endDate = new Date(now.getFullYear(), 11, 31).toISOString().split('T')[0];
      label = `For the Year Ended December 31, ${now.getFullYear()}`;
    }

    setPeriodLabel(label);

    const [invoicesRes, accountsRes] = await Promise.all([
      supabase.from('invoices').select('total_amount').gte('invoice_date', startDate).lte('invoice_date', endDate).neq('status', 'cancelled'),
      supabase.from('accounts').select('id, code, name, account_type'),
    ]);

    // Gross sales revenue from non-cancelled invoices
    const salesRevenue = (invoicesRes.data || []).reduce((s, inv) => s + Number(inv.total_amount), 0);

    // Helper: sum journal lines for an account within period
    async function periodNetDebit(accountId: string): Promise<number> {
      const { data: lines } = await supabase
        .from('journal_lines')
        .select('debit, credit, journal_entry:journal_entries!inner(entry_date)')
        .eq('account_id', accountId);
      return (lines || [])
        .filter((l: any) => { const d = l.journal_entry?.entry_date; return d && d >= startDate && d <= endDate; })
        .reduce((s: number, l: any) => s + Number(l.debit || 0) - Number(l.credit || 0), 0);
    }

    async function periodNetCredit(accountId: string): Promise<number> {
      const { data: lines } = await supabase
        .from('journal_lines')
        .select('debit, credit, journal_entry:journal_entries!inner(entry_date)')
        .eq('account_id', accountId);
      return (lines || [])
        .filter((l: any) => { const d = l.journal_entry?.entry_date; return d && d >= startDate && d <= endDate; })
        .reduce((s: number, l: any) => s + Number(l.credit || 0) - Number(l.debit || 0), 0);
    }

    const allAccounts = accountsRes.data || [];

    // Sales Returns & Allowances (contra-revenue, code 4050) — deduct from revenue
    const returnsAccount = allAccounts.find(a => a.code === '4050');
    const salesReturns = returnsAccount ? Math.max(0, await periodNetDebit(returnsAccount.id)) : 0;

    // COGS (code 5000) — expense account, positive balance = cost incurred
    const cogsAccount = allAccounts.find(a => a.code === '5000');
    const costOfGoodsSold = cogsAccount ? Math.max(0, await periodNetDebit(cogsAccount.id)) : 0;

    // Service revenue (revenue accounts other than 4000 and 4100 if desired)
    let serviceRevenue = 0;
    const serviceRevenueAccounts = allAccounts.filter(a => a.account_type === 'revenue' && a.code !== '4000');
    for (const acc of serviceRevenueAccounts) {
      const net = await periodNetCredit(acc.id);
      if (net > 0) serviceRevenue += net;
    }

    const netSalesRevenue = salesRevenue - salesReturns;
    const totalRevenue = netSalesRevenue + serviceRevenue;
    const grossProfit = totalRevenue - costOfGoodsSold;

    // Operating expenses: all expense accounts except COGS (5000), Sales Returns (4050), Discount Given (4200)
    const EXCLUDED_CODES = new Set(['5000', '4050', '4200']);
    const expenseAccounts = allAccounts.filter(a =>
      a.account_type === 'expense' && !EXCLUDED_CODES.has(a.code)
    );
    const operatingExpenses: { name: string; amount: number }[] = [];
    let totalOperatingExpenses = 0;
    for (const acc of expenseAccounts) {
      const netDebit = await periodNetDebit(acc.id);
      if (netDebit > 0) {
        operatingExpenses.push({ name: acc.name, amount: netDebit });
        totalOperatingExpenses += netDebit;
      }
    }

    const operatingProfit = grossProfit - totalOperatingExpenses;
    const netProfit = operatingProfit;

    setData({
      salesRevenue,
      salesReturns,
      netSalesRevenue,
      serviceRevenue,
      totalRevenue,
      costOfGoodsSold,
      grossProfit,
      operatingExpenses,
      totalOperatingExpenses,
      operatingProfit,
      netProfit,
    });

    setLoading(false);
  }

  function exportToCSV() {
    const rows = [
      ['PROFIT & LOSS STATEMENT'],
      [periodLabel],
      [''],
      ['REVENUE'],
      ['Gross Sales Revenue', data.salesRevenue],
      ['Less: Sales Returns & Allowances', -data.salesReturns],
      ['Net Sales Revenue', data.netSalesRevenue],
      ['Service Revenue', data.serviceRevenue],
      ['Total Net Revenue', data.totalRevenue],
      [''],
      ['COST OF GOODS SOLD'],
      ['Cost of Goods Sold', data.costOfGoodsSold],
      [''],
      ['GROSS PROFIT', data.grossProfit],
      [''],
      ['OPERATING EXPENSES'],
      ...data.operatingExpenses.map(e => [e.name, e.amount]),
      ['Total Operating Expenses', data.totalOperatingExpenses],
      [''],
      ['OPERATING PROFIT / NET PROFIT', data.netProfit],
    ];
    const csv = rows.map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'profit_loss_statement.csv'; a.click();
    URL.revokeObjectURL(url);
  }

  function formatMoney(amount: number): string {
    if (amount < 0) return `(${formatCurrency(Math.abs(amount))})`;
    return formatCurrency(amount);
  }

  return (
    <div className="space-y-5 animate-fade-in">
      {/* P&L Explanation Panel */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-5 print:hidden">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center flex-shrink-0 mt-0.5">
            <Building2 className="w-4 h-4 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-bold text-blue-900 mb-2">How the Profit &amp; Loss Statement Works</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs text-blue-800">
              <div className="space-y-2">
                <div>
                  <span className="font-semibold block">Sales Revenue</span>
                  Sum of all non-cancelled invoices in the period (by invoice date).
                </div>
                <div>
                  <span className="font-semibold block">Sales Returns &amp; Allowances</span>
                  Net debit balance on account code 4050 from journal entries in the period. Deducted from gross revenue.
                </div>
                <div>
                  <span className="font-semibold block">Cost of Goods Sold (COGS)</span>
                  Net debit balance on account code 5000. Automatically posted when each invoice is created via the accounting trigger — records the cost of inventory items sold.
                </div>
              </div>
              <div className="space-y-2">
                <div>
                  <span className="font-semibold block">Gross Profit = Net Revenue − COGS</span>
                  Profit before operating expenses. Shows whether your core selling activity is profitable.
                </div>
                <div>
                  <span className="font-semibold block">Operating Expenses</span>
                  Net debit on all expense accounts (except COGS 5000, Sales Returns 4050, Discount Given 4200) during the period. Includes salaries, rent, utilities, etc. logged in the Journal.
                </div>
                <div>
                  <span className="font-semibold block">Net Profit = Gross Profit − Operating Expenses</span>
                  The bottom line. Negative values mean a net loss for the period.
                </div>
              </div>
            </div>
            <p className="text-xs text-blue-600 mt-3 border-t border-blue-200 pt-2">
              <strong>Period:</strong> Switch between This Month, This Quarter, or This Year using the selector above. All figures are filtered by the journal entry date and invoice date within the selected window.
            </p>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between flex-wrap gap-3 print:hidden">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Profit &amp; Loss Statement</h1>
          <p className="text-muted-foreground text-sm mt-0.5">Standard accounting format</p>
        </div>
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-muted-foreground" />
          <select value={period} onChange={e => setPeriod(e.target.value as 'month' | 'quarter' | 'year')} className="border border-border rounded-lg px-3 py-2 text-sm focus:outline-none bg-white">
            <option value="month">This Month</option>
            <option value="quarter">This Quarter</option>
            <option value="year">This Year</option>
          </select>
          <button onClick={loadData} className="flex items-center gap-1.5 border border-border px-3 py-2 rounded-lg text-sm hover:bg-muted transition">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => window.print()} className="flex items-center gap-1.5 border border-border px-3 py-2 rounded-lg text-sm hover:bg-muted transition">
            <Printer className="w-3.5 h-3.5" />
          </button>
          <button onClick={exportToCSV} className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition">
            <Download className="w-4 h-4" />Export
          </button>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 shadow-sm max-w-3xl mx-auto print:shadow-none print:border-none">
        <div className="text-center py-6 border-b border-gray-200">
          <div className="flex items-center justify-center gap-2 mb-2">
            <Building2 className="w-5 h-5 text-gray-600" />
            <h2 className="text-lg font-bold text-gray-900 tracking-wide">{companySettings.name}</h2>
          </div>
          <h3 className="text-base font-semibold text-gray-800 mt-2">PROFIT &amp; LOSS STATEMENT</h3>
          <p className="text-sm text-gray-500 mt-1">{periodLabel}</p>
        </div>

        {loading ? (
          <div className="px-8 py-12 text-center text-gray-400">Loading financial data...</div>
        ) : (
          <div className="px-6 py-4">
            {/* REVENUE */}
            <SectionHeader title="REVENUE" />
            <table className="w-full text-sm">
              <tbody>
                <StatementRow label="Gross Sales Revenue" amount={data.salesRevenue} />
                {data.salesReturns > 0 && (
                  <StatementRow label="Less: Sales Returns &amp; Allowances" amount={-data.salesReturns} isDeduction />
                )}
                <StatementRow label="Net Sales Revenue" amount={data.netSalesRevenue} isBold />
                {data.serviceRevenue > 0 && <StatementRow label="Service Revenue" amount={data.serviceRevenue} />}
                <TotalRow label="Total Net Revenue" amount={data.totalRevenue} variant="blue" />
              </tbody>
            </table>

            {/* COGS */}
            <SectionHeader title="COST OF GOODS SOLD" className="mt-4" />
            <table className="w-full text-sm">
              <tbody>
                <StatementRow label="Cost of Goods Sold" amount={data.costOfGoodsSold} />
                <TotalRow label="Total COGS" amount={data.costOfGoodsSold} variant="orange" />
              </tbody>
            </table>

            <ProfitRow label="GROSS PROFIT" amount={data.grossProfit} />

            {/* OPERATING EXPENSES */}
            <SectionHeader title="OPERATING EXPENSES" className="mt-4" />
            <table className="w-full text-sm">
              <tbody>
                {data.operatingExpenses.length > 0 ? (
                  data.operatingExpenses.map((exp, i) => (
                    <StatementRow key={i} label={exp.name} amount={exp.amount} />
                  ))
                ) : (
                  <StatementRow label="No operating expenses recorded this period" amount={0} />
                )}
                <TotalRow label="Total Operating Expenses" amount={data.totalOperatingExpenses} variant="orange" />
              </tbody>
            </table>

            <div className={`flex justify-between items-center py-4 px-4 mt-4 rounded-lg ${data.netProfit >= 0 ? 'bg-green-600' : 'bg-red-600'}`}>
              <span className="text-base font-bold text-white tracking-wide">NET PROFIT / (LOSS)</span>
              <span className="text-xl font-bold text-white">{formatMoney(data.netProfit)}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SectionHeader({ title, className = '' }: { title: string; className?: string }) {
  return (
    <div className={`py-2 px-4 bg-blue-50 border-b border-t border-gray-200 ${className}`}>
      <h4 className="text-xs font-bold text-blue-700 tracking-wide">{title}</h4>
    </div>
  );
}

function StatementRow({ label, amount, isDeduction = false, isBold = false }: { label: string; amount: number; isDeduction?: boolean; isBold?: boolean }) {
  const isNeg = amount < 0 || isDeduction;
  const abs = Math.abs(amount);
  return (
    <tr className="border-b border-gray-100 hover:bg-gray-50/50">
      <td className={`py-2.5 pl-4 text-gray-700 ${isBold ? 'font-semibold' : ''}`}>{label}</td>
      <td className="py-2.5 pr-4 text-right font-medium tabular-nums">
        {isNeg ? (
          <span className="text-red-600">({formatCurrency(abs)})</span>
        ) : (
          <span className={isBold ? 'text-gray-900 font-bold' : 'text-gray-800'}>{formatCurrency(abs)}</span>
        )}
      </td>
    </tr>
  );
}

function TotalRow({ label, amount, variant }: { label: string; amount: number; variant: 'blue' | 'orange' }) {
  const bgClass = variant === 'blue' ? 'bg-blue-100' : 'bg-orange-50';
  const textClass = variant === 'blue' ? 'text-blue-800' : 'text-orange-800';
  return (
    <tr className={`${bgClass} border-b border-gray-200`}>
      <td className="py-2.5 pl-4 font-semibold text-gray-800">{label}</td>
      <td className="py-2.5 pr-4 text-right font-bold tabular-nums">
        <span className={textClass}>{formatCurrency(amount)}</span>
      </td>
    </tr>
  );
}

function ProfitRow({ label, amount }: { label: string; amount: number }) {
  const isPositive = amount >= 0;
  return (
    <div className={`flex justify-between items-center py-3 px-4 mt-3 rounded-lg ${isPositive ? 'bg-green-100 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
      <span className="text-sm font-bold text-gray-800 tracking-wide">{label}</span>
      <span className={`text-lg font-bold tabular-nums ${isPositive ? 'text-green-700' : 'text-red-700'}`}>{formatCurrency(amount)}</span>
    </div>
  );
}
