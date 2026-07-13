'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { formatCurrency, formatRelativeTime } from '@/lib/format';
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';
import { ShoppingCart, TrendingUp, Package, Truck, Receipt, CreditCard, FileText, FolderKanban, ArrowUpRight, Clock, CircleCheck as CheckCircle2, Circle as XCircle, Users, ShoppingBag } from 'lucide-react';
import type { Customer } from '@/lib/types';

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#6b7280'];

const deliveryStatusConfig = {
  pending: { label: 'Pending', color: 'text-orange-500', bg: 'bg-orange-50', icon: Clock },
  in_transit: { label: 'In Transit', color: 'text-blue-500', bg: 'bg-blue-50', icon: Truck },
  delivered: { label: 'Delivered', color: 'text-green-600', bg: 'bg-green-50', icon: CheckCircle2 },
  failed: { label: 'Failed', color: 'text-red-500', bg: 'bg-red-50', icon: XCircle },
};

const activityIcons: Record<string, { icon: React.ElementType; color: string }> = {
  invoice: { icon: Receipt, color: 'text-blue-600 bg-blue-50' },
  payment_received: { icon: CheckCircle2, color: 'text-green-600 bg-green-50' },
  purchase_order: { icon: ShoppingBag, color: 'text-orange-600 bg-orange-50' },
  delivery: { icon: Truck, color: 'text-purple-600 bg-purple-50' },
  product: { icon: Package, color: 'text-teal-600 bg-teal-50' },
  quotation: { icon: FileText, color: 'text-indigo-600 bg-indigo-50' },
  project: { icon: FolderKanban, color: 'text-pink-600 bg-pink-50' },
  online_order: { icon: ShoppingCart, color: 'text-yellow-600 bg-yellow-50' },
};

export default function DashboardPage() {
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    todaySales: 0,
    monthlySales: 0,
    inventoryValue: 0,
    inventoryItems: 0,
    receivables: 0,
    payables: 0,
    quotationTotal: 0,
    quotationAwaiting: 0,
    projectTotal: 0,
    projectActive: 0,
    deliveryPending: 0,
    deliveryInTransit: 0,
    deliveryDelivered: 0,
    deliveryFailed: 0,
    onlineOrders: 0,
    onlineRevenue: 0,
  });
  const [salesChartData, setSalesChartData] = useState<{ month: string; sales: number; profit: number }[]>([]);
  const [categoryData, setCategoryData] = useState<{ name: string; value: number; color: string }[]>([]);
  const [topCustomers, setTopCustomers] = useState<Customer[]>([]);
  const [outstandingDues, setOutstandingDues] = useState<Customer[]>([]);
  const [lowStockItems, setLowStockItems] = useState<any[]>([]);
  const [activeProjects, setActiveProjects] = useState<any[]>([]);
  const [recentActivities, setRecentActivities] = useState<any[]>([]);

  useEffect(() => {
    loadDashboardData();
  }, []);

  async function loadDashboardData() {
    setLoading(true);
    const today = new Date().toISOString().split('T')[0];
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];

    const [
      todayInvRes, monthlyInvRes, customersRes, suppliersRes,
      quotRes, projRes, dlvRes, onlineOrdersRes, topCustRes, duesRes,
      lowStockRes, activeProjRes, actRes
    ] = await Promise.all([
      supabase.from('invoices').select('total_amount').eq('invoice_date', today).neq('status', 'cancelled'),
      supabase.from('invoices').select('total_amount, created_at').gte('invoice_date', monthStart).neq('status', 'cancelled'),
      supabase.from('customers').select('outstanding_balance'),
      supabase.from('suppliers').select('outstanding_balance'),
      supabase.from('quotations').select('id, status'),
      supabase.from('projects').select('id, status'),
      supabase.from('deliveries').select('status'),
      supabase.from('online_orders').select('total_amount, status').gte('created_at', monthStart),
      supabase.from('customers').select('*').order('total_purchases', { ascending: false }).limit(5),
      supabase.from('customers').select('*').gt('outstanding_balance', 0).order('outstanding_balance', { ascending: false }).limit(5),
      supabase.from('inventory_items').select('quantity_on_hand, product:products(id, name, sku, min_stock_level, image_url)').lt('quantity_on_hand', 20).limit(5),
      supabase.from('projects').select('*').eq('status', 'active').order('progress_percent', { ascending: false }).limit(4),
      supabase.from('activity_logs').select('*').order('created_at', { ascending: false }).limit(5),
    ]);

    // Paginate inventory_items to avoid the 1000-row Supabase default cap
    let allInvItems: any[] = [];
    {
      let pg = 0;
      while (true) {
        const { data: pageData } = await supabase
          .from('inventory_items')
          .select('quantity_on_hand, product:products(cost_price)')
          .range(pg * 1000, (pg + 1) * 1000 - 1);
        allInvItems = allInvItems.concat(pageData || []);
        if (!pageData || pageData.length < 1000) break;
        pg++;
      }
    }

    const todaySales = (todayInvRes.data || []).reduce((s: number, i: any) => s + Number(i.total_amount), 0);
    const monthlySales = (monthlyInvRes.data || []).reduce((s: number, i: any) => s + Number(i.total_amount), 0);
    const receivables = (customersRes.data || []).reduce((s: number, c: any) => s + Number(c.outstanding_balance), 0);
    const payables = (suppliersRes.data || []).reduce((s: number, s2: any) => s + Number(s2.outstanding_balance), 0);
    const invValue = allInvItems.reduce((s: number, item: any) => s + (Number(item.quantity_on_hand) * Number(item.product?.cost_price || 0)), 0);

    const quotations = quotRes.data || [];
    const projects = projRes.data || [];
    const deliveries = dlvRes.data || [];
    const onlineOrders = onlineOrdersRes.data || [];

    const deliveryStats: Record<string, number> = { pending: 0, in_transit: 0, delivered: 0, failed: 0 };
    deliveries.forEach((d: any) => { if (deliveryStats[d.status] !== undefined) deliveryStats[d.status]++; });

    setStats({
      todaySales,
      monthlySales,
      inventoryValue: invValue,
      inventoryItems: allInvItems.length,
      receivables,
      payables,
      quotationTotal: quotations.length,
      quotationAwaiting: quotations.filter((q: any) => ['sent', 'viewed'].includes(q.status)).length,
      projectTotal: projects.length,
      projectActive: projects.filter((p: any) => p.status === 'active').length,
      deliveryPending: deliveryStats.pending,
      deliveryInTransit: deliveryStats.in_transit,
      deliveryDelivered: deliveryStats.delivered,
      deliveryFailed: deliveryStats.failed,
      onlineOrders: onlineOrders.filter((o: any) => o.status !== 'cancelled').length,
      onlineRevenue: onlineOrders.filter((o: any) => o.status !== 'cancelled').reduce((s: number, o: any) => s + Number(o.total_amount), 0),
    });

    const lowStock = (lowStockRes.data || []).filter((i: any) => i.product && i.quantity_on_hand < (i.product.min_stock_level || 20));
    setLowStockItems(lowStock.slice(0, 3));
    setTopCustomers(topCustRes.data || []);
    setOutstandingDues(duesRes.data || []);
    setActiveProjects(activeProjRes.data || []);
    setRecentActivities(actRes.data || []);

    const chartData = await getSalesChartData();
    setSalesChartData(chartData);

    const catData = await getCategoryData();
    setCategoryData(catData);

    setLoading(false);
  }

  async function getSalesChartData() {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'];
    const result: { month: string; sales: number; profit: number }[] = [];

    for (let i = 0; i < 6; i++) {
      const startDate = new Date(new Date().getFullYear(), i, 1).toISOString().split('T')[0];
      const endDate = new Date(new Date().getFullYear(), i + 1, 0).toISOString().split('T')[0];

      const { data: invoices } = await supabase
        .from('invoices')
        .select('total_amount, subtotal')
        .gte('invoice_date', startDate)
        .lt('invoice_date', endDate)
        .neq('status', 'cancelled');

      const totalSales = (invoices || []).reduce((s: number, inv: any) => s + Number(inv.total_amount), 0);
      const estimatedProfit = totalSales * 0.35;

      result.push({ month: months[i], sales: totalSales, profit: estimatedProfit });
    }

    return result;
  }

  async function getCategoryData() {
    const { data: products } = await supabase
      .from('products')
      .select('sale_price, category:categories(name), inventory_items(quantity_on_hand)');

    const categoryTotals: Record<string, number> = {};
    (products || []).forEach((p: any) => {
      const catName = p.category?.name || 'Others';
      const stockValue = (p.inventory_items || []).reduce((s: number, i: any) => s + Number(i.quantity_on_hand), 0);
      categoryTotals[catName] = (categoryTotals[catName] || 0) + (stockValue * Number(p.sale_price));
    });

    const total = Object.values(categoryTotals).reduce((a, b) => a + b, 0) || 1;

    return Object.entries(categoryTotals)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([name, value], i) => ({
        name,
        value: Math.round((value / total) * 100),
        color: COLORS[i]
      }));
  }

  const kpis = [
    { label: "Today's Sales", value: formatCurrency(stats.todaySales), icon: ShoppingCart, bg: 'bg-blue-50', color: 'text-blue-500' },
    { label: 'Monthly Revenue', value: formatCurrency(stats.monthlySales), icon: TrendingUp, bg: 'bg-green-50', color: 'text-green-500' },
    { label: 'Inventory Value', value: formatCurrency(stats.inventoryValue), icon: Package, bg: 'bg-purple-50', color: 'text-purple-500' },
    { label: 'Pending Deliveries', value: String(stats.deliveryPending + stats.deliveryInTransit), icon: Truck, bg: 'bg-orange-50', color: 'text-orange-500' },
    { label: 'Receivables', value: formatCurrency(stats.receivables), icon: Receipt, bg: 'bg-red-50', color: 'text-red-500' },
    { label: 'Payables', value: formatCurrency(stats.payables), icon: CreditCard, bg: 'bg-amber-50', color: 'text-amber-500' },
    { label: 'Quotations', value: String(stats.quotationTotal), icon: FileText, bg: 'bg-cyan-50', color: 'text-cyan-500' },
    { label: 'Active Projects', value: String(stats.projectActive), icon: FolderKanban, bg: 'bg-emerald-50', color: 'text-emerald-500' },
  ];

  return (
    <div className="space-y-5 max-w-[1400px] mx-auto">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
          <p className="text-muted-foreground text-sm mt-0.5">Welcome back, Admin!</p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {kpis.map((kpi) => (
          <div key={kpi.label} className="stat-card group cursor-default">
            <div className="flex items-start justify-between mb-2">
              <div>
                <p className="text-xs text-muted-foreground font-medium">{kpi.label}</p>
                <p className="text-xl font-bold text-foreground mt-0.5">{kpi.value}</p>
              </div>
              <div className={`w-10 h-10 ${kpi.bg} rounded-full flex items-center justify-center shrink-0`}>
                <kpi.icon className={`w-5 h-5 ${kpi.color}`} />
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <div className="lg:col-span-3 bg-white rounded-xl border border-border p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-foreground">Sales Overview</h3>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={salesChartData} margin={{ top: 5, right: 5, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="salesGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.15} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} tickFormatter={(v) => `৳${(v/100000).toFixed(0)}L`} />
              <Tooltip contentStyle={{ fontSize: 12, border: '1px solid #e2e8f0', borderRadius: 8 }} formatter={(v: number) => [formatCurrency(v), '']} />
              <Area type="monotone" dataKey="sales" stroke="#3b82f6" strokeWidth={2.5} fill="url(#salesGrad)" dot={{ r: 4, fill: '#3b82f6', strokeWidth: 2, stroke: '#fff' }} name="Sales" />
              <Area type="monotone" dataKey="profit" stroke="#10b981" strokeWidth={2} fill="none" dot={{ r: 3, fill: '#10b981', strokeWidth: 2, stroke: '#fff' }} name="Profit" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="lg:col-span-2 bg-white rounded-xl border border-border p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-foreground mb-4">Inventory by Category</h3>
          {categoryData.length > 0 ? (
            <div className="flex items-center gap-4">
              <ResponsiveContainer width={140} height={140}>
                <PieChart>
                  <Pie data={categoryData} cx="50%" cy="50%" innerRadius={42} outerRadius={65} paddingAngle={2} dataKey="value">
                    {categoryData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                  </Pie>
                  <Tooltip formatter={(v: number) => [`${v}%`, '']} contentStyle={{ fontSize: 11, borderRadius: 8 }} />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex-1 space-y-1.5">
                {categoryData.map((cat) => (
                  <div key={cat.name} className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: cat.color }} />
                      <span className="text-[11px] text-muted-foreground truncate">{cat.name}</span>
                    </div>
                    <span className="text-[11px] font-semibold text-foreground shrink-0">{cat.value}%</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="text-center text-muted-foreground py-8">No category data</div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-border p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-foreground">Delivery Status</h3>
            <Link href="/delivery" className="text-xs text-blue-600 hover:underline font-medium">View all</Link>
          </div>
          <div className="space-y-2.5">
            {Object.entries(deliveryStatusConfig).map(([key, cfg]) => (
              <div key={key} className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className={`w-7 h-7 ${cfg.bg} rounded-lg flex items-center justify-center`}>
                    <cfg.icon className={`w-3.5 h-3.5 ${cfg.color}`} />
                  </div>
                  <span className="text-sm text-foreground">{cfg.label}</span>
                </div>
                <span className={`text-sm font-bold ${cfg.color}`}>
                  {stats[`delivery${key.charAt(0).toUpperCase() + key.slice(1)}` as keyof typeof stats] || 0}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-border p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-foreground">Top Customers</h3>
            <Link href="/crm" className="text-xs text-blue-600 hover:underline font-medium">View all</Link>
          </div>
          <div className="space-y-2.5">
            {(topCustomers.length > 0 ? topCustomers : []).slice(0, 5).map((c) => (
              <div key={c.id} className="flex items-center justify-between">
                <Link href={`/crm/${c.id}`} className="flex items-center gap-2 hover:opacity-80 transition">
                  <div className="w-6 h-6 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 text-xs font-bold">
                    {c.name[0]}
                  </div>
                  <span className="text-sm text-foreground truncate max-w-[110px]">{c.name}</span>
                </Link>
                <span className="text-sm font-semibold text-foreground">{formatCurrency(c.total_purchases)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-border p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-foreground">Outstanding Dues</h3>
            <Link href="/crm" className="text-xs text-blue-600 hover:underline font-medium">View all</Link>
          </div>
          <div className="space-y-2.5">
            {(outstandingDues.length > 0 ? outstandingDues : []).slice(0, 5).map((c) => (
              <div key={c.id} className="flex items-center justify-between">
                <Link href={`/crm/${c.id}`} className="text-sm text-foreground truncate max-w-[130px] hover:text-blue-600 transition">{c.name}</Link>
                <span className="text-sm font-semibold text-red-600">{formatCurrency(c.outstanding_balance)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-border p-5 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-foreground">Low Stock Alert</h3>
            <Link href="/inventory" className="text-xs text-blue-600 hover:underline font-medium">View all</Link>
          </div>
          <div className="space-y-3">
            {(lowStockItems.length > 0 ? lowStockItems : []).map((item: any, i: number) => (
              <div key={i} className="flex items-center gap-3">
                <div className="w-9 h-9 bg-slate-100 rounded-lg flex items-center justify-center shrink-0">
                  <Package className="w-4 h-4 text-slate-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-foreground truncate">{item.product?.name}</p>
                  <p className="text-[10px] text-muted-foreground">SKU: {item.product?.sku}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-xs font-bold text-red-500">{item.quantity_on_hand} pcs</p>
                  <p className="text-[10px] text-muted-foreground">Min: {item.product?.min_stock_level}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-border p-5 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-foreground">Active Projects</h3>
            <Link href="/projects" className="text-xs text-blue-600 hover:underline font-medium">View all</Link>
          </div>
          <div className="space-y-3">
            {(activeProjects.length > 0 ? activeProjects : []).map((p: any) => (
              <div key={p.id} className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-lg overflow-hidden bg-slate-100 shrink-0">
                  {p.image_url ? (
                    <img src={p.image_url} alt={p.name} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center"><FolderKanban className="w-4 h-4 text-slate-400" /></div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-foreground truncate">{p.name}</p>
                  <div className="mt-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${p.progress_percent === 100 ? 'bg-green-500' : p.progress_percent >= 70 ? 'bg-blue-500' : p.progress_percent >= 40 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${p.progress_percent}%` }} />
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{p.progress_percent}%</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-border p-5 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-foreground">Recent Activities</h3>
            <Link href="/reports/activity" className="text-xs text-blue-600 hover:underline font-medium">View all</Link>
          </div>
          <div className="space-y-3">
            {recentActivities.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-6 text-center">
                <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center mb-2">
                  <Clock className="w-4 h-4 text-muted-foreground" />
                </div>
                <p className="text-xs text-muted-foreground">No recent activity yet</p>
                <p className="text-[10px] text-muted-foreground/70 mt-0.5">Activity will appear as you use the system</p>
              </div>
            ) : recentActivities.slice(0, 5).map((log: any, i: number) => {
              const cfg = activityIcons[log.entity_type] || activityIcons.invoice;
              return (
                <div key={i} className="flex items-start gap-2.5">
                  <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${cfg.color}`}>
                    <cfg.icon className="w-3.5 h-3.5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] text-foreground leading-snug font-medium">{log.entity_label}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{formatRelativeTime(log.created_at)}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-border p-5 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-foreground">Online Store Overview</h3>
          <Link href="/online-store" className="text-xs text-blue-600 hover:underline font-medium">View Dashboard</Link>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-muted/40 rounded-xl p-4 text-center">
            <p className="text-xs text-muted-foreground mb-1">Orders This Month</p>
            <p className="text-lg font-bold text-foreground">{stats.onlineOrders}</p>
          </div>
          <div className="bg-muted/40 rounded-xl p-4 text-center">
            <p className="text-xs text-muted-foreground mb-1">Revenue This Month</p>
            <p className="text-lg font-bold text-foreground">{formatCurrency(stats.onlineRevenue)}</p>
          </div>
          <div className="bg-muted/40 rounded-xl p-4 text-center">
            <p className="text-xs text-muted-foreground mb-1">Pending Deliveries</p>
            <p className="text-lg font-bold text-foreground">{stats.deliveryPending + stats.deliveryInTransit}</p>
          </div>
          <div className="bg-muted/40 rounded-xl p-4 text-center">
            <p className="text-xs text-muted-foreground mb-1">Active Projects</p>
            <p className="text-lg font-bold text-foreground">{stats.projectActive}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
