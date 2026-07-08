'use client';

import { useEffect, useState, use } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { formatCurrency } from '@/lib/format';
import { useToast } from '@/hooks/use-toast';
import { ArrowLeft, Package, TrendingUp, TrendingDown, ShoppingCart, ShoppingBag, Truck, RotateCcw, Boxes, DollarSign, ChartBar as BarChart3, Warehouse, Calendar, CircleAlert as AlertCircle, CircleArrowUp as ArrowUpCircle, CircleArrowDown as ArrowDownCircle, Eye, FileText } from 'lucide-react';

export default function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [product, setProduct] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'sales' | 'purchases' | 'stock' | 'finance'>('overview');
  const [salesData, setSalesData] = useState<any[]>([]);
  const [purchaseData, setPurchaseData] = useState<any[]>([]);
  const [stockData, setStockData] = useState<any[]>([]);
  const [movementData, setMovementData] = useState<any[]>([]);
  const [returnData, setReturnData] = useState<any[]>([]);
  const [deliveryData, setDeliveryData] = useState<any[]>([]);
  const [financeStats, setFinanceStats] = useState({
    totalRevenue: 0, totalCOGS: 0, grossProfit: 0, margin: 0,
    totalPurchased: 0, totalPurchaseCost: 0, avgSellPrice: 0, avgCostPrice: 0,
  });
  const [salesStats, setSalesStats] = useState({ totalQty: 0, totalRevenue: 0, invoiceCount: 0, avgOrderValue: 0 });
  const [stockStats, setStockStats] = useState({ totalStock: 0, stockValue: 0, warehouses: 0, lowStock: false });

  useEffect(() => {
    if (id) loadData();
  }, [id]);

  async function loadData() {
    setLoading(true);

    // Load product with category, brand, units, inventory
    const [prodRes, invRes, unitsRes] = await Promise.all([
      supabase.from('products').select(`
        *, category:categories(name), brand:brands(name)
      `).eq('id', id).maybeSingle(),
      supabase.from('inventory_items').select(`
        quantity_on_hand, quantity_reserved, quantity_incoming,
        warehouse:warehouses(name, code)
      `).eq('product_id', id),
      supabase.from('product_units').select('*').eq('product_id', id).order('sort_order', { ascending: true }),
    ]);

    if (prodRes.error || !prodRes.data) {
      toast({ title: 'Product not found', variant: 'destructive' });
      setLoading(false);
      return;
    }

    const prod = prodRes.data;
    prod.units = unitsRes.data || [];
    prod.inventory = invRes.data || [];
    setProduct(prod);

    const totalStock = (invRes.data || []).reduce((s: number, i: any) => s + Number(i.quantity_on_hand), 0);
    const stockValue = totalStock * Number(prod.cost_price);
    setStockStats({
      totalStock,
      stockValue,
      warehouses: (invRes.data || []).filter((i: any) => Number(i.quantity_on_hand) > 0).length,
      lowStock: totalStock <= (prod.min_stock_level || 0),
    });

    // Load sales data (invoice_items with invoice and customer info)
    const { data: salesItems } = await supabase
      .from('invoice_items')
      .select(`
        id, quantity, unit_price, discount_percent, subtotal, cost_price, base_quantity, unit_name,
        created_at,
        invoice:invoices!inner(invoice_number, invoice_date, status, customer:customers(name))
      `)
      .eq('product_id', id)
      .order('created_at', { ascending: false })
      .limit(50);

    setSalesData(salesItems || []);

    const totalQty = (salesItems || []).reduce((s: number, i: any) => s + Number(i.quantity), 0);
    const totalRevenue = (salesItems || []).reduce((s: number, i: any) => s + Number(i.subtotal), 0);
    const totalCOGS = (salesItems || []).reduce((s: number, i: any) => s + Number(i.cost_price) * Number(i.quantity), 0);
    setSalesStats({
      totalQty,
      totalRevenue,
      invoiceCount: new Set((salesItems || []).map((i: any) => i.invoice?.invoice_number)).size,
      avgOrderValue: (salesItems || []).length > 0 ? totalRevenue / (salesItems || []).length : 0,
    });
    setFinanceStats(prev => ({
      ...prev,
      totalRevenue,
      totalCOGS,
      grossProfit: totalRevenue - totalCOGS,
      margin: totalRevenue > 0 ? ((totalRevenue - totalCOGS) / totalRevenue) * 100 : 0,
      avgSellPrice: (salesItems || []).length > 0 ? totalRevenue / (salesItems || []).reduce((s: number, i: any) => s + Number(i.quantity), 0) : 0,
    }));

    // Load purchase data
    const { data: purchaseItems } = await supabase
      .from('purchase_order_items')
      .select(`
        id, quantity, received_quantity, unit_cost, subtotal, unit_name,
        purchase_order:purchase_orders!inner(po_number, order_date, status, supplier:suppliers(name))
      `)
      .eq('product_id', id)
      .order('created_at', { ascending: false })
      .limit(50);

    setPurchaseData(purchaseItems || []);
    const totalPurchased = (purchaseItems || []).reduce((s: number, i: any) => s + Number(i.received_quantity || i.quantity), 0);
    const totalPurchaseCost = (purchaseItems || []).reduce((s: number, i: any) => s + Number(i.subtotal), 0);
    setFinanceStats(prev => ({
      ...prev,
      totalPurchased,
      totalPurchaseCost,
      avgCostPrice: totalPurchased > 0 ? totalPurchaseCost / totalPurchased : Number(prod.cost_price),
    }));

    // Load stock movements
    const { data: movements } = await supabase
      .from('stock_movements')
      .select(`
        id, movement_type, quantity, unit_cost, reference_number, notes, created_at,
        warehouse:warehouses(name)
      `)
      .eq('product_id', id)
      .order('created_at', { ascending: false })
      .limit(50);
    setMovementData(movements || []);

    // Load return data
    const { data: returnItems } = await supabase
      .from('sales_return_items')
      .select(`
        id, quantity_returned, unit_price, discount_percent, subtotal, reason, created_at,
        sales_return:sales_returns!inner(return_number, refund_method, customer:customers(name))
      `)
      .eq('product_id', id)
      .order('created_at', { ascending: false })
      .limit(50);
    setReturnData(returnItems || []);

    // Load delivery data
    const { data: deliveryItems } = await supabase
      .from('delivery_items')
      .select(`
        id, quantity, delivered_quantity, unit_name,
        delivery:deliveries!inner(delivery_number, delivery_date, status, customer:customers(name))
      `)
      .eq('product_id', id)
      .order('created_at', { ascending: false })
      .limit(50);
    setDeliveryData(deliveryItems || []);

    setLoading(false);
  }

  if (loading) {
    return <div className="flex items-center justify-center h-96 text-muted-foreground">Loading product...</div>;
  }

  if (!product) {
    return <div className="flex items-center justify-center h-96 text-muted-foreground">Product not found</div>;
  }

  const tabs = [
    { id: 'overview', label: 'Overview', icon: Package },
    { id: 'sales', label: 'Sales History', icon: ShoppingCart },
    { id: 'purchases', label: 'Purchase History', icon: ShoppingBag },
    { id: 'stock', label: 'Stock & Movements', icon: Boxes },
    { id: 'finance', label: 'Finance', icon: DollarSign },
  ] as const;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start gap-4">
        <button onClick={() => router.back()} className="p-2 hover:bg-muted rounded-lg transition mt-1">
          <ArrowLeft className="w-5 h-5 text-muted-foreground" />
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-muted rounded-xl overflow-hidden shrink-0">
              {product.image_url ? (
                <img src={product.image_url} alt={product.name} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center"><Package className="w-6 h-6 text-muted-foreground" /></div>
              )}
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground">{product.name}</h1>
              <p className="text-sm text-muted-foreground">SKU: {product.sku} {product.barcode && `- Barcode: ${product.barcode}`}</p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {product.is_active ? (
            <span className="px-2 py-1 bg-green-50 text-green-700 text-xs font-medium rounded-full">Active</span>
          ) : (
            <span className="px-2 py-1 bg-red-50 text-red-700 text-xs font-medium rounded-full">Inactive</span>
          )}
          {stockStats.lowStock && (
            <span className="px-2 py-1 bg-amber-50 text-amber-700 text-xs font-medium rounded-full flex items-center gap-1">
              <AlertCircle className="w-3 h-3" /> Low Stock
            </span>
          )}
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Total Stock', value: `${stockStats.totalStock} ${product.base_unit || product.unit || 'pcs'}`, icon: Boxes, color: 'text-blue-500 bg-blue-50' },
          { label: 'Stock Value', value: formatCurrency(stockStats.stockValue), icon: DollarSign, color: 'text-teal-500 bg-teal-50' },
          { label: 'Total Sold', value: `${salesStats.totalQty} ${product.base_unit || product.unit || 'pcs'}`, icon: TrendingUp, color: 'text-green-500 bg-green-50' },
          { label: 'Gross Profit', value: formatCurrency(financeStats.grossProfit), icon: BarChart3, color: financeStats.grossProfit >= 0 ? 'text-green-500 bg-green-50' : 'text-red-500 bg-red-50' },
        ].map(s => (
          <div key={s.label} className="stat-card flex items-center gap-3">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center ${s.color}`}><s.icon className="w-5 h-5" /></div>
            <div><p className="text-xs text-muted-foreground">{s.label}</p><p className="text-lg font-bold text-foreground">{s.value}</p></div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-border overflow-x-auto">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition whitespace-nowrap ${
              activeTab === t.id ? 'border-blue-500 text-blue-600' : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <t.icon className="w-4 h-4" />
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Product Info */}
          <div className="border border-border rounded-xl p-4 bg-white space-y-3">
            <h3 className="font-semibold text-foreground mb-2">Product Information</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Category</span><span className="font-medium text-foreground">{product.category?.name || '—'}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Brand</span><span className="font-medium text-foreground">{product.brand?.name || '—'}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Base Unit</span><span className="font-medium text-foreground">{product.base_unit || product.unit || 'pcs'}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Multi-Unit</span><span className="font-medium text-foreground">{product.enable_multi_unit ? 'Yes' : 'No'}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Tax Rate</span><span className="font-medium text-foreground">{Number(product.tax_rate)}%</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Warranty</span><span className="font-medium text-foreground">{product.warranty_months > 0 ? `${product.warranty_months} months` : 'None'}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Min Stock Level</span><span className="font-medium text-foreground">{product.min_stock_level} {product.base_unit || product.unit || 'pcs'}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Created</span><span className="font-medium text-foreground">{new Date(product.created_at).toLocaleDateString()}</span></div>
            </div>
            {product.description && (
              <div className="pt-2 border-t border-border">
                <p className="text-xs text-muted-foreground mb-1">Description</p>
                <p className="text-sm text-foreground">{product.description}</p>
              </div>
            )}
          </div>

          {/* Pricing */}
          <div className="border border-border rounded-xl p-4 bg-white space-y-3">
            <h3 className="font-semibold text-foreground mb-2">Pricing</h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 bg-blue-50 rounded-lg">
                <p className="text-xs text-muted-foreground">Cost Price</p>
                <p className="text-lg font-bold text-blue-600">{formatCurrency(product.cost_price)}</p>
              </div>
              <div className="p-3 bg-green-50 rounded-lg">
                <p className="text-xs text-muted-foreground">Sale Price</p>
                <p className="text-lg font-bold text-green-600">{formatCurrency(product.sale_price)}</p>
              </div>
              {product.mrp && (
                <div className="p-3 bg-purple-50 rounded-lg">
                  <p className="text-xs text-muted-foreground">MRP</p>
                  <p className="text-lg font-bold text-purple-600">{formatCurrency(product.mrp)}</p>
                </div>
              )}
              <div className="p-3 bg-teal-50 rounded-lg">
                <p className="text-xs text-muted-foreground">Margin</p>
                <p className="text-lg font-bold text-teal-600">
                  {Number(product.sale_price) > 0
                    ? (((Number(product.sale_price) - Number(product.cost_price)) / Number(product.sale_price)) * 100).toFixed(1)
                    : 0}%
                </p>
              </div>
            </div>
            {product.units && product.units.length > 0 && (
              <div className="pt-2 border-t border-border">
                <p className="text-xs text-muted-foreground mb-2">Unit Options</p>
                <div className="space-y-1">
                  {product.units.map((u: any) => (
                    <div key={u.id} className="flex items-center justify-between text-sm">
                      <span className="text-foreground">{u.unit_name} ({u.unit_short}) - 1 = {u.conversion_factor} {product.base_unit || 'base'}</span>
                      <span className="text-muted-foreground">{formatCurrency(u.price)} {u.is_sale_unit && <span className="text-green-600 text-xs ml-1">(sale unit)</span>}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Stock by Warehouse */}
          <div className="border border-border rounded-xl p-4 bg-white space-y-3">
            <h3 className="font-semibold text-foreground mb-2 flex items-center gap-2"><Warehouse className="w-4 h-4 text-muted-foreground" />Stock by Warehouse</h3>
            {product.inventory && product.inventory.length > 0 ? (
              <div className="space-y-2">
                {product.inventory.map((inv: any, i: number) => (
                  <div key={i} className="flex items-center justify-between p-2 bg-muted/20 rounded-lg text-sm">
                    <div>
                      <p className="font-medium text-foreground">{inv.warehouse?.name || 'Unknown'}</p>
                      <p className="text-xs text-muted-foreground">{inv.warehouse?.code || ''}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-foreground">{Number(inv.quantity_on_hand)} {product.base_unit || product.unit || 'pcs'}</p>
                      {Number(inv.quantity_reserved) > 0 && <p className="text-xs text-amber-600">Reserved: {inv.quantity_reserved}</p>}
                      {Number(inv.quantity_incoming) > 0 && <p className="text-xs text-blue-600">Incoming: {inv.quantity_incoming}</p>}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No stock records found</p>
            )}
          </div>

          {/* Quick Stats */}
          <div className="border border-border rounded-xl p-4 bg-white space-y-3">
            <h3 className="font-semibold text-foreground mb-2">Quick Stats</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Total Sales (revenue)</span><span className="font-medium text-green-600">{formatCurrency(salesStats.totalRevenue)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Invoices</span><span className="font-medium text-foreground">{salesStats.invoiceCount}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Total Purchased</span><span className="font-medium text-foreground">{financeStats.totalPurchased} {product.base_unit || product.unit || 'pcs'}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Purchase Cost</span><span className="font-medium text-blue-600">{formatCurrency(financeStats.totalPurchaseCost)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Returns</span><span className="font-medium text-red-600">{returnData.length} ({returnData.reduce((s, r) => s + Number(r.quantity_returned), 0)} {product.base_unit || product.unit || 'pcs'})</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Deliveries</span><span className="font-medium text-foreground">{deliveryData.length}</span></div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'sales' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="p-3 bg-green-50 rounded-lg"><p className="text-xs text-muted-foreground">Total Qty Sold</p><p className="text-lg font-bold text-green-600">{salesStats.totalQty} {product.base_unit || product.unit || 'pcs'}</p></div>
            <div className="p-3 bg-blue-50 rounded-lg"><p className="text-xs text-muted-foreground">Total Revenue</p><p className="text-lg font-bold text-blue-600">{formatCurrency(salesStats.totalRevenue)}</p></div>
            <div className="p-3 bg-teal-50 rounded-lg"><p className="text-xs text-muted-foreground">Invoices</p><p className="text-lg font-bold text-teal-600">{salesStats.invoiceCount}</p></div>
            <div className="p-3 bg-purple-50 rounded-lg"><p className="text-xs text-muted-foreground">Avg Order Value</p><p className="text-lg font-bold text-purple-600">{formatCurrency(salesStats.avgOrderValue)}</p></div>
          </div>
          <div className="border border-border rounded-xl overflow-hidden bg-white">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium">Invoice</th>
                    <th className="px-4 py-3 text-left font-medium">Date</th>
                    <th className="px-4 py-3 text-left font-medium">Customer</th>
                    <th className="px-4 py-3 text-center font-medium">Qty</th>
                    <th className="px-4 py-3 text-right font-medium">Unit Price</th>
                    <th className="px-4 py-3 text-center font-medium">Disc%</th>
                    <th className="px-4 py-3 text-right font-medium">Subtotal</th>
                    <th className="px-4 py-3 text-center font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {salesData.length === 0 ? (
                    <tr><td colSpan={8} className="px-4 py-8 text-center text-sm text-muted-foreground">No sales recorded for this product</td></tr>
                  ) : salesData.map((item: any) => (
                    <tr key={item.id} className="hover:bg-muted/20 transition">
                      <td className="px-4 py-3 text-sm font-medium text-blue-600">{item.invoice?.invoice_number || '—'}</td>
                      <td className="px-4 py-3 text-sm text-muted-foreground">{item.invoice?.invoice_date ? new Date(item.invoice.invoice_date).toLocaleDateString() : '—'}</td>
                      <td className="px-4 py-3 text-sm text-foreground">{item.invoice?.customer?.name || '—'}</td>
                      <td className="px-4 py-3 text-sm text-center">{item.quantity} {item.unit_name || product.base_unit || product.unit || ''}</td>
                      <td className="px-4 py-3 text-sm text-right">{formatCurrency(Number(item.unit_price))}</td>
                      <td className="px-4 py-3 text-sm text-center">{Number(item.discount_percent) > 0 ? `${item.discount_percent}%` : '—'}</td>
                      <td className="px-4 py-3 text-sm text-right font-medium">{formatCurrency(Number(item.subtotal))}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                          item.invoice?.status === 'paid' ? 'bg-green-50 text-green-700' :
                          item.invoice?.status === 'partial' ? 'bg-amber-50 text-amber-700' :
                          item.invoice?.status === 'overdue' ? 'bg-red-50 text-red-700' :
                          'bg-muted text-muted-foreground'
                        }`}>{item.invoice?.status || '—'}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'purchases' && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="p-3 bg-blue-50 rounded-lg"><p className="text-xs text-muted-foreground">Total Purchased</p><p className="text-lg font-bold text-blue-600">{financeStats.totalPurchased} {product.base_unit || product.unit || 'pcs'}</p></div>
            <div className="p-3 bg-teal-50 rounded-lg"><p className="text-xs text-muted-foreground">Total Cost</p><p className="text-lg font-bold text-teal-600">{formatCurrency(financeStats.totalPurchaseCost)}</p></div>
            <div className="p-3 bg-purple-50 rounded-lg"><p className="text-xs text-muted-foreground">Avg Unit Cost</p><p className="text-lg font-bold text-purple-600">{formatCurrency(financeStats.avgCostPrice)}</p></div>
          </div>
          <div className="border border-border rounded-xl overflow-hidden bg-white">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium">PO Number</th>
                    <th className="px-4 py-3 text-left font-medium">Date</th>
                    <th className="px-4 py-3 text-left font-medium">Supplier</th>
                    <th className="px-4 py-3 text-center font-medium">Ordered</th>
                    <th className="px-4 py-3 text-center font-medium">Received</th>
                    <th className="px-4 py-3 text-right font-medium">Unit Cost</th>
                    <th className="px-4 py-3 text-right font-medium">Subtotal</th>
                    <th className="px-4 py-3 text-center font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {purchaseData.length === 0 ? (
                    <tr><td colSpan={8} className="px-4 py-8 text-center text-sm text-muted-foreground">No purchases recorded for this product</td></tr>
                  ) : purchaseData.map((item: any) => (
                    <tr key={item.id} className="hover:bg-muted/20 transition">
                      <td className="px-4 py-3 text-sm font-medium text-blue-600">{item.purchase_order?.po_number || '—'}</td>
                      <td className="px-4 py-3 text-sm text-muted-foreground">{item.purchase_order?.order_date ? new Date(item.purchase_order.order_date).toLocaleDateString() : '—'}</td>
                      <td className="px-4 py-3 text-sm text-foreground">{item.purchase_order?.supplier?.name || '—'}</td>
                      <td className="px-4 py-3 text-sm text-center">{item.quantity} {item.unit_name || ''}</td>
                      <td className="px-4 py-3 text-sm text-center text-green-600 font-medium">{item.received_quantity || 0}</td>
                      <td className="px-4 py-3 text-sm text-right">{formatCurrency(Number(item.unit_cost))}</td>
                      <td className="px-4 py-3 text-sm text-right font-medium">{formatCurrency(Number(item.subtotal))}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                          item.purchase_order?.status === 'received' ? 'bg-green-50 text-green-700' :
                          item.purchase_order?.status === 'partially_received' ? 'bg-amber-50 text-amber-700' :
                          item.purchase_order?.status === 'approved' ? 'bg-blue-50 text-blue-700' :
                          'bg-muted text-muted-foreground'
                        }`}>{item.purchase_order?.status || '—'}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'stock' && (
        <div className="space-y-4">
          {/* Stock by Warehouse */}
          <div className="border border-border rounded-xl overflow-hidden bg-white">
            <div className="p-4 border-b border-border">
              <h3 className="font-semibold text-foreground">Current Stock by Warehouse</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium">Warehouse</th>
                    <th className="px-4 py-3 text-right font-medium">On Hand</th>
                    <th className="px-4 py-3 text-right font-medium">Reserved</th>
                    <th className="px-4 py-3 text-right font-medium">Incoming</th>
                    <th className="px-4 py-3 text-right font-medium">Available</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {product.inventory && product.inventory.length > 0 ? product.inventory.map((inv: any, i: number) => (
                    <tr key={i} className="hover:bg-muted/20">
                      <td className="px-4 py-3 text-sm font-medium text-foreground">{inv.warehouse?.name || 'Unknown'}</td>
                      <td className="px-4 py-3 text-sm text-right font-bold">{Number(inv.quantity_on_hand)}</td>
                      <td className="px-4 py-3 text-sm text-right text-amber-600">{Number(inv.quantity_reserved)}</td>
                      <td className="px-4 py-3 text-sm text-right text-blue-600">{Number(inv.quantity_incoming)}</td>
                      <td className="px-4 py-3 text-sm text-right font-bold text-green-600">{Number(inv.quantity_on_hand) - Number(inv.quantity_reserved)}</td>
                    </tr>
                  )) : (
                    <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-muted-foreground">No stock records</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Stock Movements */}
          <div className="border border-border rounded-xl overflow-hidden bg-white">
            <div className="p-4 border-b border-border">
              <h3 className="font-semibold text-foreground">Stock Movement History</h3>
            </div>
            <div className="overflow-x-auto max-h-96">
              <table className="w-full">
                <thead className="bg-muted/40 text-xs text-muted-foreground sticky top-0">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium">Date</th>
                    <th className="px-4 py-3 text-left font-medium">Type</th>
                    <th className="px-4 py-3 text-left font-medium">Warehouse</th>
                    <th className="px-4 py-3 text-right font-medium">Quantity</th>
                    <th className="px-4 py-3 text-right font-medium">Unit Cost</th>
                    <th className="px-4 py-3 text-left font-medium">Reference</th>
                    <th className="px-4 py-3 text-left font-medium">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {movementData.length === 0 ? (
                    <tr><td colSpan={7} className="px-4 py-8 text-center text-sm text-muted-foreground">No stock movements recorded</td></tr>
                  ) : movementData.map((m: any) => (
                    <tr key={m.id} className="hover:bg-muted/20">
                      <td className="px-4 py-3 text-sm text-muted-foreground">{new Date(m.created_at).toLocaleDateString()}</td>
                      <td className="px-4 py-3 text-sm">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                          m.movement_type === 'purchase' || m.movement_type === 'transfer_in' || m.movement_type === 'return_in' || m.movement_type === 'opening' ? 'bg-green-50 text-green-700' :
                          m.movement_type === 'sale' || m.movement_type === 'transfer_out' || m.movement_type === 'return_out' ? 'bg-red-50 text-red-700' :
                          'bg-amber-50 text-amber-700'
                        }`}>{m.movement_type.replace(/_/g, ' ')}</span>
                      </td>
                      <td className="px-4 py-3 text-sm text-foreground">{m.warehouse?.name || '—'}</td>
                      <td className={`px-4 py-3 text-sm text-right font-medium ${['purchase', 'transfer_in', 'return_in', 'opening'].includes(m.movement_type) ? 'text-green-600' : 'text-red-600'}`}>
                        {['purchase', 'transfer_in', 'return_in', 'opening'].includes(m.movement_type) ? '+' : '-'}{Number(m.quantity)}
                      </td>
                      <td className="px-4 py-3 text-sm text-right text-muted-foreground">{m.unit_cost ? formatCurrency(Number(m.unit_cost)) : '—'}</td>
                      <td className="px-4 py-3 text-sm text-blue-600">{m.reference_number || '—'}</td>
                      <td className="px-4 py-3 text-sm text-muted-foreground max-w-xs truncate">{m.notes || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'finance' && (
        <div className="space-y-4">
          {/* Profitability */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="p-4 bg-green-50 rounded-xl border border-green-100">
              <p className="text-xs text-muted-foreground mb-1">Total Revenue</p>
              <p className="text-xl font-bold text-green-600">{formatCurrency(financeStats.totalRevenue)}</p>
            </div>
            <div className="p-4 bg-red-50 rounded-xl border border-red-100">
              <p className="text-xs text-muted-foreground mb-1">Total COGS</p>
              <p className="text-xl font-bold text-red-600">{formatCurrency(financeStats.totalCOGS)}</p>
            </div>
            <div className="p-4 bg-teal-50 rounded-xl border border-teal-100">
              <p className="text-xs text-muted-foreground mb-1">Gross Profit</p>
              <p className={`text-xl font-bold ${financeStats.grossProfit >= 0 ? 'text-teal-600' : 'text-red-600'}`}>{formatCurrency(financeStats.grossProfit)}</p>
            </div>
            <div className="p-4 bg-blue-50 rounded-xl border border-blue-100">
              <p className="text-xs text-muted-foreground mb-1">Profit Margin</p>
              <p className={`text-xl font-bold ${financeStats.margin >= 0 ? 'text-blue-600' : 'text-red-600'}`}>{financeStats.margin.toFixed(1)}%</p>
            </div>
          </div>

          {/* Returns */}
          <div className="border border-border rounded-xl overflow-hidden bg-white">
            <div className="p-4 border-b border-border">
              <h3 className="font-semibold text-foreground flex items-center gap-2"><RotateCcw className="w-4 h-4 text-purple-500" />Return History</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium">Return #</th>
                    <th className="px-4 py-3 text-left font-medium">Date</th>
                    <th className="px-4 py-3 text-left font-medium">Customer</th>
                    <th className="px-4 py-3 text-center font-medium">Qty</th>
                    <th className="px-4 py-3 text-right font-medium">Unit Price</th>
                    <th className="px-4 py-3 text-right font-medium">Subtotal</th>
                    <th className="px-4 py-3 text-center font-medium">Method</th>
                    <th className="px-4 py-3 text-left font-medium">Reason</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {returnData.length === 0 ? (
                    <tr><td colSpan={8} className="px-4 py-8 text-center text-sm text-muted-foreground">No returns recorded for this product</td></tr>
                  ) : returnData.map((item: any) => (
                    <tr key={item.id} className="hover:bg-muted/20">
                      <td className="px-4 py-3 text-sm font-medium text-blue-600">{item.sales_return?.return_number || '—'}</td>
                      <td className="px-4 py-3 text-sm text-muted-foreground">{new Date(item.created_at).toLocaleDateString()}</td>
                      <td className="px-4 py-3 text-sm text-foreground">{item.sales_return?.customer?.name || '—'}</td>
                      <td className="px-4 py-3 text-sm text-center">{item.quantity_returned}</td>
                      <td className="px-4 py-3 text-sm text-right">{formatCurrency(Number(item.unit_price))}</td>
                      <td className="px-4 py-3 text-sm text-right font-medium text-red-600">-{formatCurrency(Number(item.subtotal))}</td>
                      <td className="px-4 py-3 text-center text-sm">{item.sales_return?.refund_method || '—'}</td>
                      <td className="px-4 py-3 text-sm text-muted-foreground max-w-xs truncate">{item.reason || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Deliveries */}
          <div className="border border-border rounded-xl overflow-hidden bg-white">
            <div className="p-4 border-b border-border">
              <h3 className="font-semibold text-foreground flex items-center gap-2"><Truck className="w-4 h-4 text-blue-500" />Delivery History</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium">Delivery #</th>
                    <th className="px-4 py-3 text-left font-medium">Date</th>
                    <th className="px-4 py-3 text-left font-medium">Customer</th>
                    <th className="px-4 py-3 text-center font-medium">Qty</th>
                    <th className="px-4 py-3 text-center font-medium">Delivered</th>
                    <th className="px-4 py-3 text-center font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {deliveryData.length === 0 ? (
                    <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-muted-foreground">No deliveries recorded for this product</td></tr>
                  ) : deliveryData.map((item: any) => (
                    <tr key={item.id} className="hover:bg-muted/20">
                      <td className="px-4 py-3 text-sm font-medium text-blue-600">{item.delivery?.delivery_number || '—'}</td>
                      <td className="px-4 py-3 text-sm text-muted-foreground">{item.delivery?.delivery_date ? new Date(item.delivery.delivery_date).toLocaleDateString() : '—'}</td>
                      <td className="px-4 py-3 text-sm text-foreground">{item.delivery?.customer?.name || '—'}</td>
                      <td className="px-4 py-3 text-sm text-center">{item.quantity}</td>
                      <td className="px-4 py-3 text-sm text-center text-green-600 font-medium">{item.delivered_quantity || 0}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                          item.delivery?.status === 'delivered' ? 'bg-green-50 text-green-700' :
                          item.delivery?.status === 'in_transit' ? 'bg-blue-50 text-blue-700' :
                          item.delivery?.status === 'pending' ? 'bg-amber-50 text-amber-700' :
                          'bg-muted text-muted-foreground'
                        }`}>{item.delivery?.status || '—'}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
