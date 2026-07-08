'use client';

import { useEffect, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { supabase } from '@/lib/supabase';
import { formatCurrency } from '@/lib/format';
import { toast } from '@/hooks/use-toast';
import { useRouter } from 'next/navigation';
import JsBarcode from 'jsbarcode';
import { Package, Plus, Search, CreditCard as Edit, Trash2, TriangleAlert as AlertTriangle, ChartBar as BarChart3, Boxes, TrendingDown, RefreshCw, X, Warehouse, Palette, Ruler, ChevronDown, ChevronUp, ChevronRight, Info, Settings, Barcode, Camera, Printer, Download, Upload, CircleCheck as CheckCircle2 } from 'lucide-react';
import type { Product, Category, Brand, Warehouse as WarehouseType, ProductColor, ProductSize, ProductUnit } from '@/lib/types';

function StockByWarehouse({ productId, warehouses, inventoryByWarehouse, unit }: { productId: string; warehouses: WarehouseType[]; inventoryByWarehouse: Record<string, Record<string, number>>; unit?: string }) {
  const stockByWh = inventoryByWarehouse[productId] || {};
  const displayUnit = unit || 'pcs';
  return (
    <div className="text-xs space-y-0.5">
      {warehouses.map(w => {
        const qty = stockByWh[w.id] || 0;
        return (
          <div key={w.id} className="flex justify-between gap-2">
            <span className="text-muted-foreground">{w.name}:</span>
            <span className={qty > 0 ? 'text-foreground font-medium' : 'text-muted-foreground'}>{qty} {displayUnit}</span>
          </div>
        );
      })}
    </div>
  );
}

interface ProductWithStock extends Omit<Product, 'category' | 'brand'> {
  total_stock?: number;
  category?: { name: string };
  brand?: { name: string };
  product_colors?: { id: string; name: string; hex_code: string }[];
  product_sizes?: { id: string; name: string }[];
  stock_by_warehouse?: { warehouse_id: string; quantity: number }[];
}

export default function InventoryPage() {
  const router = useRouter();
  const [products, setProducts] = useState<ProductWithStock[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseType[]>([]);
  const [inventoryByWarehouse, setInventoryByWarehouse] = useState<Record<string, Record<string, number>>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterBrand, setFilterBrand] = useState('');
  const [filterWarehouse, setFilterWarehouse] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterColor, setFilterColor] = useState('');
  const [filterSize, setFilterSize] = useState('');
  const [filterUnit, setFilterUnit] = useState('');
  const [allColors, setAllColors] = useState<{ id: string; name: string; hex_code: string }[]>([]);
  const [allSizes, setAllSizes] = useState<{ id: string; name: string }[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState<ProductWithStock | null>(null);
  const [deletingProduct, setDeletingProduct] = useState<ProductWithStock | null>(null);
  const [barcodeProduct, setBarcodeProduct] = useState<ProductWithStock | null>(null);
  const [showManageModal, setShowManageModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [stats, setStats] = useState({ total: 0, lowStock: 0, outOfStock: 0, value: 0 });
  const [unitTypes, setUnitTypes] = useState<{ id: string; unit_name: string; unit_short: string }[]>([]);

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    setLoading(true);

    // Supabase caps queries at 1000 rows by default. Paginate to fetch all products.
    let allProds: any[] = [];
    let page = 0;
    const PAGE = 1000;
    while (true) {
      const { data, error } = await supabase
        .from('products')
        .select('*, category:categories(name), brand:brands(name), product_colors(id, name, hex_code), product_sizes(id, name)')
        .order('created_at', { ascending: false })
        .range(page * PAGE, (page + 1) * PAGE - 1);
      if (error) break;
      allProds = allProds.concat(data || []);
      if (!data || data.length < PAGE) break;
      page++;
    }

    const [catRes, brandRes, invRes, whRes, colorRes, sizeRes, unitTypeRes] = await Promise.all([
      supabase.from('categories').select('*').eq('is_active', true),
      supabase.from('brands').select('*').eq('is_active', true),
      supabase.from('inventory_items').select('product_id, warehouse_id, quantity_on_hand'),
      supabase.from('warehouses').select('*').eq('is_active', true).order('is_default', { ascending: false }),
      supabase.from('product_colors').select('id, name, hex_code').order('name'),
      supabase.from('product_sizes').select('id, name').order('name'),
      supabase.from('unit_types').select('id, unit_name, unit_short').eq('is_active', true).order('unit_name'),
    ]);

    const stockMap: Record<string, number> = {};
    const byWarehouse: Record<string, Record<string, number>> = {};
    (invRes.data || []).forEach((i: any) => {
      stockMap[i.product_id] = (stockMap[i.product_id] || 0) + Number(i.quantity_on_hand);
      if (!byWarehouse[i.product_id]) byWarehouse[i.product_id] = {};
      byWarehouse[i.product_id][i.warehouse_id] = Number(i.quantity_on_hand);
    });

    const prods = allProds.map((p: any) => ({
      ...p,
      total_stock: stockMap[p.id] || 0,
      stock_by_warehouse: Object.entries(byWarehouse[p.id] || {}).map(([warehouse_id, quantity]) => ({
        warehouse_id,
        quantity,
      })),
    }));

    setProducts(prods);
    setCategories(catRes.data || []);
    setBrands(brandRes.data || []);
    setWarehouses(whRes.data || []);
    setInventoryByWarehouse(byWarehouse);

    const seenColors = new Set<string>();
    const uniqueColors = (colorRes.data || []).filter((c: any) => {
      if (seenColors.has(c.name)) return false;
      seenColors.add(c.name);
      return true;
    });
    setAllColors(uniqueColors);

    const seenSizes = new Set<string>();
    const uniqueSizes = (sizeRes.data || []).filter((s: any) => {
      if (seenSizes.has(s.name)) return false;
      seenSizes.add(s.name);
      return true;
    });
    setAllSizes(uniqueSizes);
    setUnitTypes(unitTypeRes.data || []);

    const activeProds = prods.filter((p: any) => p.is_active);
    const lowStock = activeProds.filter((p: any) => (p.total_stock || 0) > 0 && (p.total_stock || 0) <= p.min_stock_level).length;
    const outOfStock = activeProds.filter((p: any) => (p.total_stock || 0) === 0).length;
    const value = activeProds.reduce((sum: number, p: any) => sum + (p.total_stock || 0) * p.cost_price, 0);

    setStats({ total: activeProds.length, lowStock, outOfStock, value });
    setLoading(false);
  }

  const filtered = products.filter(p => {
    const matchSearch = !search || p.name.toLowerCase().includes(search.toLowerCase()) || p.sku.toLowerCase().includes(search.toLowerCase());
    const matchCat = !filterCategory || p.category_id === filterCategory;
    const matchBrand = !filterBrand || p.brand_id === filterBrand;
    const matchWarehouse = !filterWarehouse || (inventoryByWarehouse[p.id]?.[filterWarehouse] || 0) > 0;
    const matchStatus = !filterStatus || (
      filterStatus === 'low' ? (p.total_stock || 0) <= p.min_stock_level && (p.total_stock || 0) > 0 :
      filterStatus === 'out' ? (p.total_stock || 0) === 0 :
      filterStatus === 'ok' ? (p.total_stock || 0) > p.min_stock_level :
      filterStatus === 'has_stock' ? (p.total_stock || 0) > 0 : true
    );
    const matchColor = !filterColor || p.product_colors?.some(c => c.name === filterColor);
    const matchSize = !filterSize || p.product_sizes?.some(s => s.name === filterSize);
    const matchUnit = !filterUnit || (p.unit && p.unit.toLowerCase() === filterUnit.toLowerCase());
    return matchSearch && matchCat && matchBrand && matchWarehouse && matchStatus && matchColor && matchSize && matchUnit;
  });

  function getStockBadge(qty: number, min: number) {
    if (qty === 0) return <span className="badge-status bg-red-50 text-red-600">Out of Stock</span>;
    if (qty <= min) return <span className="badge-status bg-amber-50 text-amber-600">Low Stock</span>;
    return <span className="badge-status bg-green-50 text-green-600">In Stock</span>;
  }

  function exportProducts() {
    const rows = filtered.map((p, i) => ({
      '#': i + 1,
      Name: p.name,
      SKU: p.sku,
      Category: (p as any).category?.name || '',
      Brand: (p as any).brand?.name || '',
      Unit: p.unit || '',
      'Cost Price': p.cost_price,
      'Sale Price': p.sale_price,
      'Min Stock Level': p.min_stock_level,
      'Current Stock': p.total_stock || 0,
      Description: (p as any).description || '',
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Products');
    XLSX.writeFile(wb, `inventory-${new Date().toISOString().split('T')[0]}.xlsx`);
    toast({ title: 'Exported', description: `${rows.length} products exported to Excel` });
  }

  async function handleDelete() {
    if (!deletingProduct) return;
    const { error } = await supabase.from('products').update({ is_active: false }).eq('id', deletingProduct.id);
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Success', description: 'Product deleted successfully' });
      loadData();
    }
    setDeletingProduct(null);
  }

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Inventory</h1>
          <p className="text-muted-foreground text-sm mt-0.5">Manage products and stock levels</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setShowManageModal(true)}
            className="flex items-center gap-2 border border-border hover:bg-muted text-foreground px-3 py-2 rounded-lg text-sm font-semibold transition"
          >
            <Settings className="w-4 h-4" />
            Manage
          </button>
          <button
            onClick={exportProducts}
            className="flex items-center gap-2 border border-border hover:bg-muted text-foreground px-3 py-2 rounded-lg text-sm font-semibold transition"
          >
            <Download className="w-4 h-4" />
            Export
          </button>
          <button
            onClick={() => setShowImportModal(true)}
            className="flex items-center gap-2 border border-border hover:bg-muted text-foreground px-3 py-2 rounded-lg text-sm font-semibold transition"
          >
            <Upload className="w-4 h-4" />
            Import
          </button>
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-semibold transition"
          >
            <Plus className="w-4 h-4" />
            Add Product
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Total Products', value: stats.total, icon: Boxes, color: 'text-blue-500 bg-blue-50' },
          { label: 'Low Stock', value: stats.lowStock, icon: AlertTriangle, color: 'text-amber-500 bg-amber-50' },
          { label: 'Out of Stock', value: stats.outOfStock, icon: TrendingDown, color: 'text-red-500 bg-red-50' },
          { label: 'Inventory Value', value: formatCurrency(stats.value), icon: BarChart3, color: 'text-green-500 bg-green-50' },
        ].map((s) => (
          <div key={s.label} className="stat-card flex items-center gap-3">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center ${s.color}`}>
              <s.icon className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className="text-lg font-bold text-foreground">{s.value}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-border p-4 shadow-sm flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by name or SKU..."
            className="w-full pl-8 pr-4 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          />
        </div>
        <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)} className="border border-border rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20">
          <option value="">All Categories</option>
          {categories.filter(c => !c.parent_id).map(c => (
            <optgroup key={c.id} label={c.name}>
              <option key={c.id} value={c.id}>{c.name}</option>
              {categories.filter(sc => sc.parent_id === c.id).map(sc => (
                <option key={sc.id} value={sc.id}>&nbsp;&nbsp;{sc.name}</option>
              ))}
            </optgroup>
          ))}
        </select>
        <select value={filterBrand} onChange={e => setFilterBrand(e.target.value)} className="border border-border rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20">
          <option value="">All Brands</option>
          {brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <select value={filterWarehouse} onChange={e => setFilterWarehouse(e.target.value)} className="border border-border rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20">
          <option value="">All Warehouses</option>
          {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="border border-border rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20">
          <option value="">All Status</option>
          <option value="ok">In Stock</option>
          <option value="low">Low Stock</option>
          <option value="has_stock">Has Stock</option>
          <option value="out">Out of Stock</option>
        </select>
        {allColors.length > 0 && (
          <select value={filterColor} onChange={e => setFilterColor(e.target.value)} className="border border-border rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20">
            <option value="">All Colors</option>
            {allColors.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
          </select>
        )}
        {allSizes.length > 0 && (
          <select value={filterSize} onChange={e => setFilterSize(e.target.value)} className="border border-border rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20">
            <option value="">All Sizes</option>
            {allSizes.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
          </select>
        )}
        {unitTypes.length > 0 && (
          <select value={filterUnit} onChange={e => setFilterUnit(e.target.value)} className="border border-border rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20">
            <option value="">All Units</option>
            {unitTypes.map(u => <option key={u.id} value={u.unit_name}>{u.unit_name}</option>)}
          </select>
        )}
        <button onClick={loadData} className="flex items-center gap-2 border border-border rounded-lg px-3 py-2 text-sm hover:bg-muted transition">
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh
        </button>
      </div>

      {!loading && (
        <div className="flex items-center gap-4 flex-wrap text-sm">
          <span className="inline-flex items-center gap-2 px-3 py-1.5 bg-blue-50 text-blue-700 rounded-lg font-medium">
            <Boxes className="w-4 h-4" />
            Showing {filtered.length} of {products.filter(p => p.is_active).length} products
          </span>
          <span className="inline-flex items-center gap-2 px-3 py-1.5 bg-green-50 text-green-700 rounded-lg font-medium">
            <Package className="w-4 h-4" />
            Total stock: {filtered.reduce((sum, p) => sum + (p.total_stock || 0), 0).toLocaleString()} items
          </span>
          <span className="inline-flex items-center gap-2 px-3 py-1.5 bg-amber-50 text-amber-700 rounded-lg font-medium">
            <AlertTriangle className="w-4 h-4" />
            Low stock: {filtered.filter(p => (p.total_stock || 0) > 0 && (p.total_stock || 0) <= p.min_stock_level).length}
          </span>
          <span className="inline-flex items-center gap-2 px-3 py-1.5 bg-red-50 text-red-700 rounded-lg font-medium">
            <TrendingDown className="w-4 h-4" />
            Out of stock: {filtered.filter(p => (p.total_stock || 0) === 0).length}
          </span>
          <span className="inline-flex items-center gap-2 px-3 py-1.5 bg-muted text-muted-foreground rounded-lg font-medium">
            <BarChart3 className="w-4 h-4" />
            Filtered value: {formatCurrency(filtered.reduce((sum, p) => sum + (p.total_stock || 0) * p.cost_price, 0))}
          </span>
        </div>
      )}

      <div className="table-wrapper">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-muted/40 border-b border-border">
                <th className="text-left text-xs font-semibold text-muted-foreground px-4 py-3">Product</th>
                <th className="text-left text-xs font-semibold text-muted-foreground px-4 py-3">SKU</th>
                <th className="text-left text-xs font-semibold text-muted-foreground px-4 py-3">Category</th>
                <th className="text-left text-xs font-semibold text-muted-foreground px-4 py-3">Brand</th>
                <th className="text-right text-xs font-semibold text-muted-foreground px-4 py-3">Stock</th>
                <th className="text-right text-xs font-semibold text-muted-foreground px-4 py-3">Cost</th>
                <th className="text-right text-xs font-semibold text-muted-foreground px-4 py-3">Sale Price</th>
                <th className="text-left text-xs font-semibold text-muted-foreground px-4 py-3">Status</th>
                <th className="text-right text-xs font-semibold text-muted-foreground px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 9 }).map((_, j) => (
                      <td key={j} className="px-4 py-3"><div className="h-4 bg-muted rounded animate-pulse" /></td>
                    ))}
                  </tr>
                ))
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center text-muted-foreground text-sm">No products found</td>
                </tr>
              ) : (
                filtered.map((p) => (
                  <tr key={p.id} className={`hover:bg-muted/30 transition-colors ${!p.is_active ? 'opacity-50' : ''}`}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 bg-muted rounded-lg overflow-hidden shrink-0">
                          {p.image_url ? (
                            <img src={p.image_url} alt={p.name} className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center"><Package className="w-4 h-4 text-muted-foreground" /></div>
                          )}
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-foreground hover:text-blue-600 hover:underline cursor-pointer" onClick={() => router.push(`/inventory/${p.id}`)}>{p.name}</p>
                          <p className="text-xs text-muted-foreground">{p.enable_multi_unit ? <span className="text-blue-600">Multi-unit</span> : p.unit}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground font-mono">{p.sku}</td>
                    <td className="px-4 py-3 text-sm text-foreground">{p.category?.name || '—'}</td>
                    <td className="px-4 py-3 text-sm text-foreground">{p.brand?.name || '—'}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="group relative">
                        <span className={`text-sm font-bold cursor-help ${(p.total_stock || 0) === 0 ? 'text-red-500' : (p.total_stock || 0) <= p.min_stock_level ? 'text-amber-500' : 'text-foreground'}`}>
                          {p.total_stock || 0}
                        </span>
                        <div className="absolute right-0 top-full mt-1 bg-white border border-border rounded-lg shadow-lg p-3 z-10 hidden group-hover:block min-w-[180px]">
                          <p className="text-xs font-semibold mb-2 text-foreground">Stock by Location:</p>
                          <StockByWarehouse productId={p.id} warehouses={warehouses} inventoryByWarehouse={inventoryByWarehouse} unit={p.unit || 'pcs'} />
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-right text-foreground">{formatCurrency(p.cost_price)}</td>
                    <td className="px-4 py-3 text-sm text-right font-semibold text-foreground">{formatCurrency(p.sale_price)}</td>
                    <td className="px-4 py-3">{getStockBadge(p.total_stock || 0, p.min_stock_level)}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => setBarcodeProduct(p)} title="View Barcode" className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-green-50 text-muted-foreground hover:text-green-600 transition">
                          <Barcode className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => setEditingProduct(p)} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-blue-50 text-muted-foreground hover:text-blue-600 transition">
                          <Edit className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => setDeletingProduct(p)} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-red-50 text-muted-foreground hover:text-red-600 transition">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showAddModal && (
        <ProductModal categories={categories} brands={brands} warehouses={warehouses} unitTypes={unitTypes} onClose={() => setShowAddModal(false)} onSaved={loadData} />
      )}
      {editingProduct && (
        <ProductModal categories={categories} brands={brands} warehouses={warehouses} unitTypes={unitTypes} product={editingProduct} onClose={() => setEditingProduct(null)} onSaved={loadData} />
      )}
      {deletingProduct && (
        <DeleteConfirmModal product={deletingProduct} onClose={() => setDeletingProduct(null)} onConfirm={handleDelete} />
      )}
      {barcodeProduct && (
        <BarcodeModal product={barcodeProduct} onClose={() => setBarcodeProduct(null)} />
      )}
      {showManageModal && (
        <ManageCatalogModal categories={categories} brands={brands} unitTypes={unitTypes} onClose={() => setShowManageModal(false)} onSaved={loadData} />
      )}
      {showImportModal && (
        <ImportModal
          categories={categories}
          brands={brands}
          warehouses={warehouses}
          existingSkus={products.map(p => p.sku)}
          onClose={() => setShowImportModal(false)}
          onImported={loadData}
        />
      )}
    </div>
  );
}

function ProductModal({ categories, brands, warehouses, unitTypes, product, onClose, onSaved }: {
  categories: Category[];
  brands: Brand[];
  warehouses: WarehouseType[];
  unitTypes: { id: string; unit_name: string; unit_short: string }[];
  product?: ProductWithStock | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!product;
  const [form, setForm] = useState({
    name: product?.name || '',
    sku: product?.sku || '',
    unit: product?.unit || 'pcs',
    cost_price: product?.cost_price?.toString() || '',
    sale_price: product?.sale_price?.toString() || '',
    category_id: product?.category_id || '',
    brand_id: product?.brand_id || '',
    min_stock_level: product?.min_stock_level?.toString() || '0',
    description: product?.description || '',
    is_active: product?.is_active ?? true,
    enable_multi_unit: product?.enable_multi_unit ?? false,
    enable_colors: product?.enable_colors ?? false,
    enable_sizes: product?.enable_sizes ?? false,
  });
  const [stockByWarehouse, setStockByWarehouse] = useState<Record<string, string>>(
    warehouses.reduce((acc, w) => ({ ...acc, [w.id]: '0' }), {})
  );
  const [colors, setColors] = useState<ProductColor[]>([]);
  const [sizes, setSizes] = useState<ProductSize[]>([]);
  const [units, setUnits] = useState<ProductUnit[]>([]);
  const [showUnits, setShowUnits] = useState(true);
  const [showColors, setShowColors] = useState(true);
  const [showSizes, setShowSizes] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (product?.id) {
      loadProductVariants(product.id);
    }
  }, [product?.id]);

  async function loadProductVariants(productId: string) {
    const [colorRes, sizeRes, unitRes, invRes] = await Promise.all([
      supabase.from('product_colors').select('*').eq('product_id', productId).order('sort_order'),
      supabase.from('product_sizes').select('*').eq('product_id', productId).order('sort_order'),
      supabase.from('product_units').select('*').eq('product_id', productId).order('sort_order'),
      supabase.from('inventory_items').select('warehouse_id, quantity_on_hand').eq('product_id', productId),
    ]);
    setColors((colorRes.data || []) as ProductColor[]);
    setSizes((sizeRes.data || []) as ProductSize[]);
    setUnits((unitRes.data || []) as ProductUnit[]);

    // Load current stock by warehouse
    const stockMap: Record<string, string> = {};
    warehouses.forEach(w => { stockMap[w.id] = '0'; });
    (invRes.data || []).forEach(inv => {
      stockMap[inv.warehouse_id] = String(inv.quantity_on_hand);
    });
    setStockByWarehouse(stockMap);
  }

  function addColor() {
    setColors([...colors, {
      id: `temp-${Date.now()}`,
      product_id: product?.id || '',
      name: '',
      hex_code: '#000000',
      is_default: colors.length === 0,
      sort_order: colors.length,
      created_at: new Date().toISOString(),
    }]);
  }

  function addSize() {
    setSizes([...sizes, {
      id: `temp-${Date.now()}`,
      product_id: product?.id || '',
      name: '',
      dimensions: '',
      is_default: sizes.length === 0,
      sort_order: sizes.length,
      created_at: new Date().toISOString(),
    }]);
  }

  function addUnit() {
    const hasBaseUnit = units.some(u => u.is_base_unit);
    setUnits([...units, {
      id: `temp-${Date.now()}`,
      product_id: product?.id || '',
      unit_name: '',
      unit_short: '',
      conversion_factor: 1,
      is_base_unit: !hasBaseUnit,
      is_sale_unit: units.length === 0,
      price: 0,
      cost_price: 0,
      sort_order: units.length,
      is_active: true,
      created_at: new Date().toISOString(),
    }]);
  }

  function updateColor(index: number, field: keyof ProductColor, value: any) {
    const updated = [...colors];
    (updated[index] as any)[field] = value;
    if (field === 'is_default' && value === true) {
      updated.forEach((c, i) => { if (i !== index) c.is_default = false; });
    }
    setColors(updated);
  }

  function updateSize(index: number, field: keyof ProductSize, value: any) {
    const updated = [...sizes];
    (updated[index] as any)[field] = value;
    if (field === 'is_default' && value === true) {
      updated.forEach((s, i) => { if (i !== index) s.is_default = false; });
    }
    setSizes(updated);
  }

  function updateUnit(index: number, field: keyof ProductUnit, value: any) {
    const updated = [...units];
    (updated[index] as any)[field] = value;
    if (field === 'is_base_unit' && value === true) {
      updated.forEach((u, i) => { if (i !== index) u.is_base_unit = false; });
    }
    if (field === 'is_sale_unit' && value === true) {
      updated.forEach((u, i) => { if (i !== index) u.is_sale_unit = false; });
    }
    setUnits(updated);
  }

  function removeColor(index: number) {
    setColors(colors.filter((_, i) => i !== index));
  }

  function removeSize(index: number) {
    setSizes(sizes.filter((_, i) => i !== index));
  }

  function removeUnit(index: number) {
    setUnits(units.filter((_, i) => i !== index));
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();

    if (form.enable_multi_unit) {
      if (units.length === 0) {
        setError('Please add at least one unit when multi-unit is enabled');
        return;
      }
      if (!units.some(u => u.is_base_unit)) {
        setError('Please mark one unit as the base unit');
        return;
      }
    }

    setSaving(true);
    setError('');

    const baseUnit = form.enable_multi_unit ? units.find(u => u.is_base_unit)?.unit_name || form.unit : form.unit;

    const data: any = {
      name: form.name,
      sku: form.sku,
      unit: form.unit,
      base_unit: baseUnit,
      enable_multi_unit: form.enable_multi_unit,
      enable_colors: form.enable_colors,
      enable_sizes: form.enable_sizes,
      cost_price: Number(form.cost_price),
      sale_price: Number(form.sale_price),
      category_id: form.category_id || null,
      brand_id: form.brand_id || null,
      min_stock_level: Number(form.min_stock_level),
      description: form.description || null,
      is_active: form.is_active,
    };

    let productId = product?.id;

    try {
      if (isEdit) {
        const { error } = await supabase.from('products').update(data).eq('id', product!.id);
        if (error) throw error;
      } else {
        const { data: newProduct, error } = await supabase.from('products').insert(data).select('id').single();
        if (error) throw error;
        productId = newProduct.id;
      }

      if (productId) {
        if (form.enable_colors && colors.length > 0) {
          await supabase.from('product_colors').delete().eq('product_id', productId);
          const validColors = colors.filter(c => c.name.trim());
          for (const color of validColors) {
            await supabase.from('product_colors').insert({
              product_id: productId,
              name: color.name,
              hex_code: color.hex_code,
              image_url: color.image_url || null,
              is_default: color.is_default,
              sort_order: color.sort_order,
            });
          }
        }

        if (form.enable_sizes && sizes.length > 0) {
          await supabase.from('product_sizes').delete().eq('product_id', productId);
          const validSizes = sizes.filter(s => s.name.trim());
          for (const size of validSizes) {
            await supabase.from('product_sizes').insert({
              product_id: productId,
              name: size.name,
              dimensions: size.dimensions || null,
              is_default: size.is_default,
              sort_order: size.sort_order,
            });
          }
        }

        if (form.enable_multi_unit && units.length > 0) {
          await supabase.from('product_units').delete().eq('product_id', productId);
          const validUnits = units.filter(u => u.unit_name.trim());
          for (const unit of validUnits) {
            await supabase.from('product_units').insert({
              product_id: productId,
              unit_name: unit.unit_name,
              unit_short: unit.unit_short || null,
              conversion_factor: unit.conversion_factor,
              is_base_unit: unit.is_base_unit,
              is_sale_unit: unit.is_sale_unit,
              price: unit.price,
              cost_price: unit.cost_price,
              barcode: unit.barcode || null,
              sort_order: unit.sort_order,
              is_active: unit.is_active,
            });
          }
        }

        if (!isEdit) {
          for (const [warehouseId, qty] of Object.entries(stockByWarehouse)) {
            const quantity = Number(qty);
            if (quantity > 0) {
              await supabase.from('inventory_items').insert({
                tenant_id: '00000000-0000-0000-0000-000000000001',
                product_id: productId,
                warehouse_id: warehouseId,
                quantity_on_hand: quantity,
              });

              await supabase.from('stock_movements').insert({
                tenant_id: '00000000-0000-0000-0000-000000000001',
                product_id: productId,
                warehouse_id: warehouseId,
                movement_type: 'opening',
                quantity: quantity,
                unit_cost: Number(form.cost_price),
                reference_type: 'product_creation',
                reference_id: productId,
                notes: 'Initial stock on product creation',
              });
            }
          }
        } else {
          // Handle stock adjustments for existing products
          for (const [warehouseId, newQtyStr] of Object.entries(stockByWarehouse)) {
            const newQty = Number(newQtyStr);
            const currentQty = product?.stock_by_warehouse?.find(s => s.warehouse_id === warehouseId)?.quantity || 0;
            const diff = newQty - currentQty;

            if (diff !== 0) {
              // Try update first; if no row exists, insert
              const { data: existingInv } = await supabase
                .from('inventory_items')
                .select('id')
                .eq('product_id', productId!)
                .eq('warehouse_id', warehouseId)
                .maybeSingle();

              if (existingInv) {
                await supabase.from('inventory_items')
                  .update({ quantity_on_hand: newQty, updated_at: new Date().toISOString() })
                  .eq('id', existingInv.id);
              } else {
                await supabase.from('inventory_items').insert({
                  tenant_id: '00000000-0000-0000-0000-000000000001',
                  product_id: productId,
                  warehouse_id: warehouseId,
                  quantity_on_hand: newQty,
                });
              }

              // Record movement
              await supabase.from('stock_movements').insert({
                tenant_id: '00000000-0000-0000-0000-000000000001',
                product_id: productId,
                warehouse_id: warehouseId,
                movement_type: 'adjustment',
                quantity: Math.abs(diff),
                unit_cost: Number(form.cost_price) || 0,
                reference_type: 'stock_adjustment',
                reference_id: productId,
                notes: diff > 0 ? 'Stock increase adjustment' : 'Stock decrease adjustment',
              });
            }
          }
        }
      }

      toast({ title: 'Success', description: isEdit ? 'Product updated successfully' : 'Product created successfully' });
      onSaved();
      onClose();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-3xl shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border sticky top-0 bg-white z-10">
          <h2 className="text-base font-bold">{isEdit ? 'Edit Product' : 'Add New Product'}</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSave} className="p-6 space-y-4">
          {error && <div className="p-3 bg-red-50 text-red-600 rounded-lg text-sm">{error}</div>}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium mb-1">Product Name *</label>
              <input required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">SKU *</label>
              <input required value={form.sku} onChange={e => setForm({ ...form, sku: e.target.value })} className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium mb-1">Category</label>
              <select value={form.category_id} onChange={e => setForm({ ...form, category_id: e.target.value })} className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none">
                <option value="">Select category</option>
                {categories.filter(c => !c.parent_id).map(c => (
                  <optgroup key={c.id} label={c.name}>
                    <option key={c.id} value={c.id}>{c.name}</option>
                    {categories.filter(sc => sc.parent_id === c.id).map(sc => (
                      <option key={sc.id} value={sc.id}>&nbsp;&nbsp;&nbsp;{sc.name}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Brand</label>
              <select value={form.brand_id} onChange={e => setForm({ ...form, brand_id: e.target.value })} className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none">
                <option value="">Select brand</option>
                {brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
          </div>

          <div className="flex flex-wrap gap-4 p-3 bg-muted/30 rounded-lg">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.enable_multi_unit} onChange={e => setForm({ ...form, enable_multi_unit: e.target.checked })} className="rounded" />
              <span className="text-sm flex items-center gap-1"><Package className="w-3.5 h-3.5" /> Multi-Unit Pricing</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.enable_colors} onChange={e => setForm({ ...form, enable_colors: e.target.checked })} className="rounded" />
              <span className="text-sm flex items-center gap-1"><Palette className="w-3.5 h-3.5" /> Color Variants</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.enable_sizes} onChange={e => setForm({ ...form, enable_sizes: e.target.checked })} className="rounded" />
              <span className="text-sm flex items-center gap-1"><Ruler className="w-3.5 h-3.5" /> Size Variants</span>
            </label>
          </div>

          {!form.enable_multi_unit && (
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium mb-1">Unit</label>
                <select value={form.unit} onChange={e => setForm({ ...form, unit: e.target.value })} className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none">
                  {['pcs', 'sqft', 'bag', 'tin', 'set', 'box', 'kg', 'ltr', 'meter', 'coil', 'roll', 'carton'].map(u => <option key={u}>{u}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Cost Price *</label>
                <input type="number" required min="0" step="0.01" value={form.cost_price} onChange={e => setForm({ ...form, cost_price: e.target.value })} className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Sale Price *</label>
                <input type="number" required min="0" step="0.01" value={form.sale_price} onChange={e => setForm({ ...form, sale_price: e.target.value })} className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
              </div>
            </div>
          )}

          {form.enable_multi_unit && (
            <div className="border border-border rounded-lg overflow-hidden">
              <button type="button" onClick={() => setShowUnits(!showUnits)} className="w-full flex items-center justify-between px-4 py-3 bg-blue-50 text-blue-700 hover:bg-blue-100 transition">
                <span className="font-medium text-sm flex items-center gap-2"><Package className="w-4 h-4" /> Units & Pricing ({units.length})</span>
                {showUnits ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>
              {showUnits && (
                <div className="p-4 space-y-3 bg-white">
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-3">
                    <p className="text-xs text-blue-800 flex items-start gap-2">
                      <Info className="w-4 h-4 shrink-0 mt-0.5" />
                      <span>
                        <strong>How Multi-Unit Works:</strong> The <strong>Base Unit</strong> is your smallest tracked unit (conversion = 1). Each other unit's <strong>Conv.</strong> value says how many base units it contains.
                        <br /><strong>Example for tiles:</strong>
                      </span>
                    </p>
                    <div className="mt-2 grid grid-cols-6 gap-1 text-[11px] font-medium text-blue-700 px-6">
                      <span>Unit</span><span>Short</span><span>Conv.</span><span>Sale ৳</span><span>Cost ৳</span><span>Flag</span>
                    </div>
                    <div className="mt-0.5 grid grid-cols-6 gap-1 text-[11px] text-blue-800 bg-blue-100 rounded px-6 py-1">
                      <span>Piece</span><span>pcs</span><span>1</span><span>45.00</span><span>32.00</span><span className="text-green-700 font-bold">Base</span>
                    </div>
                    <div className="mt-0.5 grid grid-cols-6 gap-1 text-[11px] text-blue-800 bg-blue-100 rounded px-6 py-1">
                      <span>Box</span><span>box</span><span>50</span><span>2000.00</span><span>1500.00</span><span className="text-blue-700 font-bold">Sale</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-12 gap-1.5 px-2 py-1.5 bg-muted/50 rounded text-xs font-semibold text-muted-foreground">
                    <div className="col-span-3">Unit Name</div>
                    <div className="col-span-2">Short</div>
                    <div className="col-span-1 text-right">Conv.</div>
                    <div className="col-span-2 text-right">Sale ৳</div>
                    <div className="col-span-2 text-right">Cost ৳</div>
                    <div className="col-span-1 text-center">Base</div>
                    <div className="col-span-1 text-center">Sale</div>
                  </div>

                  {units.map((unit, index) => (
                    <div key={unit.id} className="grid grid-cols-12 gap-1.5 p-2 bg-muted/30 rounded-lg items-center">
                      <div className="col-span-3">
                        <input
                          list={`unit-list-${index}`}
                          placeholder="Type or pick unit..."
                          value={unit.unit_name}
                          onChange={e => {
                            const val = e.target.value;
                            const match = unitTypes.find(u => u.unit_name.toLowerCase() === val.toLowerCase());
                            updateUnit(index, 'unit_name', val);
                            if (match && !unit.unit_short) updateUnit(index, 'unit_short', match.unit_short);
                          }}
                          className="w-full border border-border rounded px-2 py-1 text-sm"
                        />
                        <datalist id={`unit-list-${index}`}>
                          {unitTypes.map(u => <option key={u.id} value={u.unit_name}>{u.unit_short}</option>)}
                        </datalist>
                      </div>
                      <div className="col-span-2">
                        <input
                          placeholder="e.g. box"
                          value={unit.unit_short || ''}
                          onChange={e => updateUnit(index, 'unit_short', e.target.value)}
                          className="w-full border border-border rounded px-2 py-1 text-sm"
                        />
                      </div>
                      <div className="col-span-1">
                        <input type="number" min="1" placeholder="1" value={unit.conversion_factor} onChange={e => updateUnit(index, 'conversion_factor', parseFloat(e.target.value) || 1)} className="w-full border border-border rounded px-2 py-1 text-sm text-right" />
                      </div>
                      <div className="col-span-2">
                        <input type="number" min="0" step="0.01" placeholder="0.00" value={unit.price} onChange={e => updateUnit(index, 'price', parseFloat(e.target.value) || 0)} className="w-full border border-border rounded px-2 py-1 text-sm text-right" />
                      </div>
                      <div className="col-span-2">
                        <input type="number" min="0" step="0.01" placeholder="0.00" value={unit.cost_price} onChange={e => updateUnit(index, 'cost_price', parseFloat(e.target.value) || 0)} className="w-full border border-border rounded px-2 py-1 text-sm text-right" />
                      </div>
                      <div className="col-span-1 flex justify-center">
                        <button type="button" onClick={() => updateUnit(index, 'is_base_unit', !unit.is_base_unit)} className={`w-full px-1 py-1 rounded text-[10px] font-medium transition ${unit.is_base_unit ? 'bg-green-500 text-white' : 'bg-muted text-muted-foreground hover:bg-green-100 hover:text-green-700'}`} title="Base unit — stock tracked in this unit">B</button>
                      </div>
                      <div className="col-span-1 flex justify-center items-center gap-1">
                        <button type="button" onClick={() => updateUnit(index, 'is_sale_unit', !unit.is_sale_unit)} className={`w-6 px-1 py-1 rounded text-[10px] font-medium transition ${unit.is_sale_unit ? 'bg-blue-500 text-white' : 'bg-muted text-muted-foreground hover:bg-blue-100 hover:text-blue-700'}`} title="Default unit in sales/POS">S</button>
                        <button type="button" onClick={() => removeUnit(index)} className="text-red-400 hover:text-red-600"><Trash2 className="w-3.5 h-3.5" /></button>
                      </div>
                    </div>
                  ))}
                  <button type="button" onClick={addUnit} className="w-full py-2 border-2 border-dashed border-blue-300 rounded-lg text-blue-600 hover:bg-blue-50 transition text-sm font-medium">
                    <Plus className="w-4 h-4 inline mr-1" /> Add Unit
                  </button>
                </div>
              )}
            </div>
          )}

          {form.enable_colors && (
            <div className="border border-border rounded-lg overflow-hidden">
              <button type="button" onClick={() => setShowColors(!showColors)} className="w-full flex items-center justify-between px-4 py-3 bg-pink-50 text-pink-700 hover:bg-pink-100 transition">
                <span className="font-medium text-sm flex items-center gap-2"><Palette className="w-4 h-4" /> Color Variants ({colors.length})</span>
                {showColors ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>
              {showColors && (
                <div className="p-4 space-y-3 bg-white">
                  <div className="bg-pink-50 border border-pink-200 rounded-lg p-3 mb-3">
                    <p className="text-xs text-pink-800 flex items-start gap-2">
                      <Info className="w-4 h-4 shrink-0 mt-0.5" />
                      <span>
                        <strong>Color Variants:</strong> Use this when the product comes in different colors (e.g., a faucet in Chrome, Matte Black, Gold). Each color can have its own image. Set one as <strong>Default</strong> to show it first in catalogs.
                      </span>
                    </p>
                  </div>
                  <div className="grid grid-cols-5 gap-2 px-2 py-1.5 bg-muted/50 rounded text-xs font-semibold text-muted-foreground">
                    <div className="col-span-1">Color</div>
                    <div className="col-span-2">Color Name</div>
                    <div className="col-span-1 text-center">Default</div>
                    <div className="col-span-1"></div>
                  </div>
                  {colors.map((color, index) => (
                    <div key={color.id} className="grid grid-cols-5 gap-2 p-2 bg-muted/30 rounded-lg items-center">
                      <div className="col-span-1">
                        <input type="color" value={color.hex_code || '#000000'} onChange={e => updateColor(index, 'hex_code', e.target.value)} className="w-8 h-8 rounded cursor-pointer border border-border" title="Pick color" />
                      </div>
                      <div className="col-span-2">
                        <input placeholder="e.g. Matte Black" value={color.name} onChange={e => updateColor(index, 'name', e.target.value)} className="w-full border border-border rounded px-2 py-1 text-sm" />
                      </div>
                      <div className="col-span-1 flex justify-center">
                        <button type="button" onClick={() => updateColor(index, 'is_default', !color.is_default)} className={`px-2 py-1 rounded text-[10px] font-medium transition ${color.is_default ? 'bg-pink-500 text-white' : 'bg-muted text-muted-foreground hover:bg-pink-100 hover:text-pink-700'}`} title="Set as default color">Default</button>
                      </div>
                      <div className="col-span-1 flex justify-end">
                        <button type="button" onClick={() => removeColor(index)} className="text-red-500 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
                      </div>
                    </div>
                  ))}
                  <button type="button" onClick={addColor} className="w-full py-2 border-2 border-dashed border-pink-300 rounded-lg text-pink-600 hover:bg-pink-50 transition text-sm font-medium">
                    <Plus className="w-4 h-4 inline mr-1" /> Add Color Variant
                  </button>
                </div>
              )}
            </div>
          )}

          {form.enable_sizes && (
            <div className="border border-border rounded-lg overflow-hidden">
              <button type="button" onClick={() => setShowSizes(!showSizes)} className="w-full flex items-center justify-between px-4 py-3 bg-purple-50 text-purple-700 hover:bg-purple-100 transition">
                <span className="font-medium text-sm flex items-center gap-2"><Ruler className="w-4 h-4" /> Size Variants ({sizes.length})</span>
                {showSizes ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>
              {showSizes && (
                <div className="p-4 space-y-3 bg-white">
                  <div className="bg-purple-50 border border-purple-200 rounded-lg p-3 mb-3">
                    <p className="text-xs text-purple-800 flex items-start gap-2">
                      <Info className="w-4 h-4 shrink-0 mt-0.5" />
                      <span>
                        <strong>Size Variants:</strong> Use for products sold in different sizes (e.g., towels in S/M/L, tiles in 12x12 or 24x24). The <strong>Dimensions</strong> field can store measurements like "60x60 cm".
                      </span>
                    </p>
                  </div>
                  <div className="grid grid-cols-5 gap-2 px-2 py-1.5 bg-muted/50 rounded text-xs font-semibold text-muted-foreground">
                    <div className="col-span-2">Size Name</div>
                    <div className="col-span-1">Dimensions</div>
                    <div className="col-span-1 text-center">Default</div>
                    <div className="col-span-1"></div>
                  </div>
                  {sizes.map((size, index) => (
                    <div key={size.id} className="grid grid-cols-5 gap-2 p-2 bg-muted/30 rounded-lg items-center">
                      <div className="col-span-2">
                        <input placeholder="e.g. Small, 12x12" value={size.name} onChange={e => updateSize(index, 'name', e.target.value)} className="w-full border border-border rounded px-2 py-1 text-sm" />
                      </div>
                      <div className="col-span-1">
                        <input placeholder="e.g. 60x60" value={size.dimensions || ''} onChange={e => updateSize(index, 'dimensions', e.target.value)} className="w-full border border-border rounded px-2 py-1 text-sm" />
                      </div>
                      <div className="col-span-1 flex justify-center">
                        <button type="button" onClick={() => updateSize(index, 'is_default', !size.is_default)} className={`px-2 py-1 rounded text-[10px] font-medium transition ${size.is_default ? 'bg-purple-500 text-white' : 'bg-muted text-muted-foreground hover:bg-purple-100 hover:text-purple-700'}`} title="Set as default size">Default</button>
                      </div>
                      <div className="col-span-1 flex justify-end">
                        <button type="button" onClick={() => removeSize(index)} className="text-red-500 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
                      </div>
                    </div>
                  ))}
                  <button type="button" onClick={addSize} className="w-full py-2 border-2 border-dashed border-purple-300 rounded-lg text-purple-600 hover:bg-purple-50 transition text-sm font-medium">
                    <Plus className="w-4 h-4 inline mr-1" /> Add Size Variant
                  </button>
                </div>
              )}
            </div>
          )}

          <div>
            <label className="block text-xs font-medium mb-1">Min Stock Level</label>
            <input type="number" min="0" value={form.min_stock_level} onChange={e => setForm({ ...form, min_stock_level: e.target.value })} className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
          </div>

          {!isEdit && (
            <div className="border-t border-border pt-4 mt-4">
              <div className="flex items-center gap-2 mb-3">
                <Warehouse className="w-4 h-4 text-muted-foreground" />
                <label className="text-xs font-medium">Initial Stock by Warehouse</label>
              </div>
              <div className="space-y-2">
                {warehouses.map(wh => (
                  <div key={wh.id} className="flex items-center justify-between p-2 bg-muted/30 rounded-lg">
                    <span className="text-sm">{wh.name} {wh.is_default && <span className="text-xs text-blue-600">(Default)</span>}</span>
                    <input
                      type="number"
                      min="0"
                      value={stockByWarehouse[wh.id] || '0'}
                      onChange={e => setStockByWarehouse({ ...stockByWarehouse, [wh.id]: e.target.value })}
                      className="w-24 border border-border rounded px-2 py-1 text-sm text-right focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                      placeholder="0"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {isEdit && (
            <div className="border-t border-border pt-4 mt-4">
              <div className="flex items-center gap-2 mb-3">
                <Warehouse className="w-4 h-4 text-muted-foreground" />
                <label className="text-xs font-medium">Stock Adjustment by Warehouse</label>
              </div>
              <div className="space-y-2">
                {warehouses.map(wh => {
                  const currentQty = product?.stock_by_warehouse?.find(s => s.warehouse_id === wh.id)?.quantity || 0;
                  const newQty = Number(stockByWarehouse[wh.id] || 0);
                  const diff = newQty - currentQty;
                  return (
                    <div key={wh.id} className="flex items-center justify-between p-2 bg-muted/30 rounded-lg">
                      <div className="flex-1">
                        <span className="text-sm">{wh.name}</span>
                        <span className="text-xs text-muted-foreground ml-2">(Current: {currentQty})</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          min="0"
                          value={stockByWarehouse[wh.id] || '0'}
                          onChange={e => setStockByWarehouse({ ...stockByWarehouse, [wh.id]: e.target.value })}
                          className="w-24 border border-border rounded px-2 py-1 text-sm text-right focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                          placeholder="0"
                        />
                        {diff !== 0 && (
                          <span className={`text-xs font-medium px-2 py-0.5 rounded ${diff > 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                            {diff > 0 ? `+${diff}` : diff}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground mt-2">Changes will be recorded as stock adjustments.</p>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium mb-1">Description</label>
            <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} rows={2} className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
          </div>
          {isEdit && (
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={form.is_active} onChange={e => setForm({ ...form, is_active: e.target.checked })} className="rounded" />
              <span className="text-sm">Active</span>
            </label>
          )}
          <div className="flex items-center justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 border border-border rounded-lg text-sm hover:bg-muted transition">Cancel</button>
            <button type="submit" disabled={saving} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold transition disabled:opacity-60">
              {saving ? 'Saving...' : isEdit ? 'Update Product' : 'Save Product'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function DeleteConfirmModal({ product, onClose, onConfirm }: { product: ProductWithStock; onClose: () => void; onConfirm: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl">
        <div className="p-6">
          <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <Trash2 className="w-6 h-6 text-red-600" />
          </div>
          <h2 className="text-lg font-bold text-center mb-2">Delete Product?</h2>
          <p className="text-sm text-muted-foreground text-center mb-6">
            Are you sure you want to delete <span className="font-semibold text-foreground">{product.name}</span>? This action cannot be undone.
          </p>
          <div className="flex gap-3">
            <button onClick={onClose} className="flex-1 px-4 py-2 border border-border rounded-lg text-sm hover:bg-muted transition">Cancel</button>
            <button onClick={onConfirm} className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-semibold transition">Delete</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ImportModal({ categories, brands, warehouses, existingSkus, onClose, onImported }: {
  categories: Category[];
  brands: Brand[];
  warehouses: WarehouseType[];
  existingSkus: string[];
  onClose: () => void;
  onImported: () => void;
}) {
  const [activeTab, setActiveTab] = useState<'upload' | 'paste' | 'guide'>('upload');
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0, stage: '' });
  const [results, setResults] = useState<{ success: number; skipped: number; errors: string[] } | null>(null);
  const [pasteText, setPasteText] = useState('');
  const [importMode, setImportMode] = useState<'simple' | 'variants' | 'multiunit'>('simple');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const demoTemplate = `Name,SKU,Category,Brand,Unit,Cost Price,Sale Price,Min Stock Level,Current Stock,Color,Size,Multi-Unit Name,Multi-Unit Conversion,Multi-Unit Sale Price
Widget A,WID-001,Electronics,TechCorp,pieces,100,150,10,50,Red,Small,,,
Widget A,WID-002,Electronics,TechCorp,pieces,100,150,10,30,Blue,Small,,,
Cable Pack,CAB-010,Electrical,PowerCo,box,500,750,5,20,,,,Box,100,50000
Tiles Premium,TIL-050,Flooring,CeramicCo,sqft,25,45,100,500,,,Carton,20,800`;

  function downloadTemplate() {
    const blob = new Blob([demoTemplate], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'product_import_template.csv';
    link.click();
    URL.revokeObjectURL(link.href);
  }

  async function handleFileUpload(file: File) {
    setImporting(true);
    setResults(null);
    setProgress({ current: 0, total: 0, stage: 'Reading file...' });

    try {
      const data = await file.arrayBuffer();
      const wb = XLSX.read(data, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows: any[] = XLSX.utils.sheet_to_json(ws);

      if (rows.length === 0) {
        setResults({ success: 0, skipped: 0, errors: ['No data rows found in file'] });
        setImporting(false);
        return;
      }

      await processImport(rows);
    } catch (err: any) {
      setResults({ success: 0, skipped: 0, errors: [err.message || 'Failed to read file'] });
    }
    setImporting(false);
  }

  async function handlePasteImport() {
    if (!pasteText.trim()) return;

    setImporting(true);
    setResults(null);
    setProgress({ current: 0, total: 0, stage: 'Parsing pasted data...' });

    try {
      const lines = pasteText.trim().split('\n');
      const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
      const rows = lines.slice(1).map(line => {
        const values = line.split(',');
        const row: Record<string, string> = {};
        headers.forEach((h, i) => row[h] = values[i]?.trim() || '');
        return row;
      }).filter(r => r['name'] || r['sku']);

      if (rows.length === 0) {
        setResults({ success: 0, skipped: 0, errors: ['No valid data rows found'] });
        setImporting(false);
        return;
      }

      await processImport(rows);
    } catch (err: any) {
      setResults({ success: 0, skipped: 0, errors: [err.message || 'Failed to parse pasted data'] });
    }
    setImporting(false);
  }

  async function processImport(rows: any[]) {
    const defaultWarehouse = warehouses.find(w => w.is_default)?.id || warehouses[0]?.id;
    let success = 0;
    let skipped = 0;
    const errors: string[] = [];

    if (!defaultWarehouse) {
      setResults({ success: 0, skipped: rows.length, errors: ['No warehouse found. Please create a warehouse first.'] });
      setImporting(false);
      return;
    }

    // Group rows by base product (same Name, different variants)
    const productGroups = new Map<string, any[]>();

    rows.forEach((row, idx) => {
      const name = row['Name'] || row['name'] || '';
      const sku = row['SKU'] || row['sku'] || '';

      if (!name && !sku) {
        skipped++;
        errors.push(`Row ${idx + 1}: Missing Name and SKU`);
        return;
      }

      // For variant mode, group by Name; for simple mode, each row is separate
      const groupKey = importMode === 'variants' ? (name || sku) : `${name}_${sku}_${idx}`;
      if (!productGroups.has(groupKey)) productGroups.set(groupKey, []);
      productGroups.get(groupKey)!.push({ ...row, _rowIndex: idx + 1 });
    });

    setProgress({ current: 0, total: productGroups.size, stage: 'Importing products...' });

    let current = 0;
    for (const [, groupRows] of productGroups) {
      current++;
      setProgress({ current, total: productGroups.size, stage: `Processing ${current}/${productGroups.size}...` });

      const firstRow = groupRows[0];
      const name = String(firstRow['Name'] || firstRow['name'] || '').trim();
      const sku = String(firstRow['SKU'] || firstRow['sku'] || '').trim();

      if (!name || !sku) {
        skipped += groupRows.length;
        errors.push(`Row ${firstRow._rowIndex}: Missing Name or SKU`);
        continue;
      }

      // Find category and brand
      const catName = firstRow['Category'] || firstRow['category'];
      const brandName = firstRow['Brand'] || firstRow['brand'];
      const category = catName ? categories.find(c => c.name.toLowerCase() === String(catName).toLowerCase()) : null;
      const brand = brandName ? brands.find(b => b.name.toLowerCase() === String(brandName).toLowerCase()) : null;

      // Parse multi-unit data
      const multiUnitName = firstRow['Multi-Unit Name'] || firstRow['multi_unit_name'] || '';
      const multiUnitConversion = Number(firstRow['Multi-Unit Conversion'] || firstRow['multi_unit_conversion'] || 1);
      const multiUnitSalePrice = Number(firstRow['Multi-Unit Sale Price'] || firstRow['multi_unit_sale_price'] || 0);

      const enableMultiUnit = !!multiUnitName && multiUnitConversion > 1;
      const enableColors = groupRows.some(r => r['Color'] || r['color']);
      const enableSizes = groupRows.some(r => r['Size'] || r['size']);

      const skuExists = existingSkus.includes(sku);
      let productId: string;

      if (skuExists) {
        // Update existing product
        const { data: existingProduct, error: fetchError } = await supabase
          .from('products')
          .select('id')
          .eq('sku', sku)
          .single();

        if (fetchError || !existingProduct) {
          skipped += groupRows.length;
          errors.push(`Row ${firstRow._rowIndex}: Failed to find existing product with SKU ${sku}`);
          continue;
        }

        productId = existingProduct.id;

        // Update product details (but preserve variant settings)
        await supabase.from('products').update({
          name,
          unit: String(firstRow['Unit'] || firstRow['unit'] || 'pcs'),
          cost_price: Number(firstRow['Cost Price'] || firstRow['cost_price'] || 0),
          sale_price: Number(firstRow['Sale Price'] || firstRow['sale_price'] || 0),
          min_stock_level: Number(firstRow['Min Stock Level'] || firstRow['min_stock_level'] || 0),
          description: String(firstRow['Description'] || firstRow['description'] || ''),
          category_id: category?.id || null,
          brand_id: brand?.id || null,
          updated_at: new Date().toISOString(),
        }).eq('id', productId);
      } else {
        // Create new product
        const { data: productData, error: prodError } = await supabase.from('products').insert({
          tenant_id: '00000000-0000-0000-0000-000000000001',
          name,
          sku,
          unit: String(firstRow['Unit'] || firstRow['unit'] || 'pcs'),
          base_unit: String(firstRow['Unit'] || firstRow['unit'] || 'pcs'),
          cost_price: Number(firstRow['Cost Price'] || firstRow['cost_price'] || 0),
          sale_price: Number(firstRow['Sale Price'] || firstRow['sale_price'] || 0),
          min_stock_level: Number(firstRow['Min Stock Level'] || firstRow['min_stock_level'] || 0),
          description: String(firstRow['Description'] || firstRow['description'] || ''),
          category_id: category?.id || null,
          brand_id: brand?.id || null,
          enable_multi_unit: enableMultiUnit,
          enable_colors: enableColors,
          enable_sizes: enableSizes,
          is_active: true,
        }).select('id').single();

        if (prodError || !productData) {
          skipped += groupRows.length;
          errors.push(`Row ${firstRow._rowIndex}: ${prodError?.message || 'Failed to create product'}`);
          continue;
        }

        productId = productData.id;
      }

      let productsCreated = skuExists ? 0 : 1;
      let productsUpdated = skuExists ? 1 : 0;

      // Add colors if enabled (only for new products)
      if (enableColors && !skuExists) {
        const uniqueColors = new Map<string, { name: string; hex: string }>();
        groupRows.forEach(r => {
          const colorName = String(r['Color'] || r['color'] || '').trim();
          if (colorName) {
            const colorKey = colorName.toLowerCase();
            if (!uniqueColors.has(colorKey)) {
              uniqueColors.set(colorKey, {
                name: colorName,
                hex: colorNameToHex(colorName),
              });
            }
          }
        });

        let colorSort = 0;
        for (const [, color] of uniqueColors) {
          await supabase.from('product_colors').insert({
            product_id: productId,
            name: color.name,
            hex_code: color.hex,
            is_default: colorSort === 0,
            sort_order: colorSort++,
          });
        }
      }

      // Add sizes if enabled (only for new products)
      if (enableSizes && !skuExists) {
        const uniqueSizes = new Map<string, string>();
        groupRows.forEach(r => {
          const sizeName = String(r['Size'] || r['size'] || '').trim();
          if (sizeName && !uniqueSizes.has(sizeName.toLowerCase())) {
            uniqueSizes.set(sizeName.toLowerCase(), sizeName);
          }
        });

        let sizeSort = 0;
        for (const [, sizeName] of uniqueSizes) {
          await supabase.from('product_sizes').insert({
            product_id: productId,
            name: sizeName,
            is_default: sizeSort === 0,
            sort_order: sizeSort++,
          });
        }
      }

      // Add multi-unit data (only for new products)
      if (enableMultiUnit && !skuExists) {
        // Base unit
        await supabase.from('product_units').insert({
          product_id: productId,
          unit_name: String(firstRow['Unit'] || firstRow['unit'] || 'pcs'),
          conversion_factor: 1,
          is_base_unit: true,
          is_sale_unit: false,
          price: Number(firstRow['Sale Price'] || firstRow['sale_price'] || 0),
          cost_price: Number(firstRow['Cost Price'] || firstRow['cost_price'] || 0),
          sort_order: 0,
          is_active: true,
        });

        // Sale unit
        await supabase.from('product_units').insert({
          product_id: productId,
          unit_name: multiUnitName,
          conversion_factor: multiUnitConversion,
          is_base_unit: false,
          is_sale_unit: true,
          price: multiUnitSalePrice || Number(firstRow['Sale Price'] || 0) * multiUnitConversion,
          cost_price: Number(firstRow['Cost Price'] || 0) * multiUnitConversion,
          sort_order: 1,
          is_active: true,
        });
      }

      // Create inventory for each variant row
      for (const row of groupRows) {
        const currentStock = Number(row['Current Stock'] || row['current_stock'] || 0);
        if (currentStock > 0 && defaultWarehouse) {
          // Check current inventory for existing products
          if (skuExists) {
            const { data: existingInv } = await supabase
              .from('inventory_items')
              .select('quantity_on_hand')
              .eq('product_id', productId)
              .eq('warehouse_id', defaultWarehouse)
              .single();

            const existingQty = existingInv?.quantity_on_hand || 0;
            if (currentStock > existingQty) {
              const addQty = currentStock - existingQty;
              await supabase.from('inventory_items')
                .update({ quantity_on_hand: currentStock })
                .eq('product_id', productId)
                .eq('warehouse_id', defaultWarehouse);

              await supabase.from('stock_movements').insert({
                tenant_id: '00000000-0000-0000-0000-000000000001',
                product_id: productId,
                warehouse_id: defaultWarehouse,
                movement_type: 'adjustment',
                quantity: addQty,
                unit_cost: Number(firstRow['Cost Price'] || 0),
                reference_type: 'import_update',
                notes: 'Stock updated from import',
              });
            }
          } else {
            // Check if inventory already exists
            const { data: existingInv } = await supabase
              .from('inventory_items')
              .select('id')
              .eq('product_id', productId)
              .eq('warehouse_id', defaultWarehouse)
              .maybeSingle();

            let invError;
            if (existingInv) {
              // Update existing
              const { error } = await supabase.from('inventory_items')
                .update({ quantity_on_hand: currentStock })
                .eq('id', existingInv.id);
              invError = error;
            } else {
              // Insert new
              const { error } = await supabase.from('inventory_items').insert({
                tenant_id: '00000000-0000-0000-0000-000000000001',
                product_id: productId,
                warehouse_id: defaultWarehouse,
                quantity_on_hand: currentStock,
              });
              invError = error;
            }

            if (!invError) {
              await supabase.from('stock_movements').insert({
                tenant_id: '00000000-0000-0000-0000-000000000001',
                product_id: productId,
                warehouse_id: defaultWarehouse,
                movement_type: 'opening',
                quantity: currentStock,
                unit_cost: Number(firstRow['Cost Price'] || 0),
                reference_type: 'import',
                notes: 'Initial stock from import',
              });
            } else {
              errors.push(`Row ${firstRow._rowIndex}: Failed to set stock - ${invError.message}`);
            }
          }
        }
      }

      success += productsCreated + productsUpdated;
      existingSkus.push(sku);
    }

    setResults({ success, skipped, errors: errors.slice(0, 20) });
    if (success > 0) onImported();
  }

  function colorNameToHex(name: string): string {
    const colors: Record<string, string> = {
      red: '#ef4444', green: '#22c55e', blue: '#3b82f6', yellow: '#eab308',
      black: '#000000', white: '#ffffff', orange: '#f97316', purple: '#a855f7',
      pink: '#ec4899', brown: '#a16207', gray: '#6b7280', grey: '#6b7280',
      silver: '#9ca3af', gold: '#d97706', navy: '#1e3a8a', teal: '#14b8a6',
    };
    return colors[name.toLowerCase()] || '#6b7280';
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-4xl shadow-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <div>
            <h2 className="text-lg font-bold text-foreground">Bulk Import Products</h2>
            <p className="text-xs text-muted-foreground">Import products from CSV or paste data directly</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border shrink-0">
          {[
            { key: 'upload', label: 'Upload File', icon: Upload },
            { key: 'paste', label: 'Bulk Paste', icon: Plus },
            { key: 'guide', label: 'Import Guide', icon: Info },
          ].map(t => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key as any)}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition ${activeTab === t.key ? 'border-blue-600 text-blue-600' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
            >
              <t.icon className="w-4 h-4" /> {t.label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {results && (
            <div className={`mb-4 p-4 rounded-lg ${results.success > 0 ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
              <div className="flex items-center gap-2 mb-2">
                {results.success > 0 ? (
                  <><CheckCircle2 className="w-5 h-5 text-green-600" /><span className="font-semibold text-green-800">Import Complete</span></>
                ) : (
                  <><AlertTriangle className="w-5 h-5 text-red-600" /><span className="font-semibold text-red-800">Import Failed</span></>
                )}
              </div>
              <p className="text-sm text-gray-700">
                <strong>{results.success}</strong> products imported, <strong>{results.skipped}</strong> skipped
              </p>
              {results.errors.length > 0 && (
                <div className="mt-2 text-xs text-red-600 space-y-1">
                  {results.errors.map((e, i) => <p key={i}>{e}</p>)}
                </div>
              )}
            </div>
          )}

          {importing && (
            <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <div className="flex items-center gap-3">
                <div className="w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
                <div>
                  <p className="text-sm font-medium text-blue-800">{progress.stage}</p>
                  <p className="text-xs text-blue-600">{progress.current} of {progress.total}</p>
                </div>
              </div>
              <div className="mt-2 h-2 bg-blue-200 rounded-full overflow-hidden">
                <div className="h-full bg-blue-600 transition-all" style={{ width: `${(progress.current / Math.max(progress.total, 1)) * 100}%` }} />
              </div>
            </div>
          )}

          {activeTab === 'upload' && (
            <div className="space-y-4">
              {/* Import Mode */}
              <div>
                <label className="block text-sm font-medium mb-2">Import Mode</label>
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { key: 'simple', label: 'Simple Products', desc: 'Each row = 1 product' },
                    { key: 'variants', label: 'Product Variants', desc: 'Same name = 1 product with sizes/colors' },
                    { key: 'multiunit', label: 'Multi-Unit Products', desc: 'Products with unit conversions' },
                  ].map(m => (
                    <button
                      key={m.key}
                      onClick={() => setImportMode(m.key as any)}
                      className={`p-3 rounded-lg border text-left transition ${importMode === m.key ? 'border-blue-600 bg-blue-50' : 'border-border hover:border-gray-400'}`}
                    >
                      <p className="text-sm font-medium">{m.label}</p>
                      <p className="text-xs text-muted-foreground">{m.desc}</p>
                    </button>
                  ))}
                </div>
              </div>

              {/* Drop Zone */}
              <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  const file = e.dataTransfer.files[0];
                  if (file && (file.name.endsWith('.csv') || file.name.endsWith('.xlsx') || file.name.endsWith('.xls'))) {
                    handleFileUpload(file);
                  }
                }}
                className={`border-2 border-dashed rounded-xl p-8 text-center transition ${dragOver ? 'border-blue-500 bg-blue-50' : 'border-gray-300 bg-gray-50'}`}
              >
                <Upload className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
                <p className="text-sm text-foreground font-medium">Drag & drop CSV or Excel file here</p>
                <p className="text-xs text-muted-foreground mt-1">or click to browse</p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.xlsx,.xls"
                  className="hidden"
                  onChange={(e) => e.target.files?.[0] && handleFileUpload(e.target.files[0])}
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="mt-3 px-4 py-2 bg-white border border-border rounded-lg text-sm font-medium hover:bg-gray-100 transition"
                >
                  Choose File
                </button>
              </div>

              <div className="flex items-center justify-between">
                <button
                  onClick={downloadTemplate}
                  className="flex items-center gap-2 text-sm text-blue-600 hover:text-blue-700 font-medium"
                >
                  <Download className="w-4 h-4" /> Download Template CSV
                </button>
                <span className="text-xs text-muted-foreground">Supported: CSV, XLSX, XLS</span>
              </div>
            </div>
          )}

          {activeTab === 'paste' && (
            <div className="space-y-4">
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                <p className="text-xs text-blue-800">
                  <strong>Bulk Paste:</strong> Paste data from Excel or Google Sheets. First row should be headers (Name, SKU, Cost Price, Sale Price, etc.).
                </p>
              </div>
              <textarea
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                placeholder="Paste CSV data here (tab or comma separated)&#10;&#10;Example:&#10;Name,SKU,Cost Price,Sale Price,Current Stock&#10;Product A,SKU-001,100,150,50&#10;Product B,SKU-002,200,300,25"
                className="w-full h-64 border border-border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500/20 resize-none"
              />
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">
                  {pasteText.split('\n').filter(l => l.trim()).length - 1} rows detected
                </p>
                <button
                  onClick={handlePasteImport}
                  disabled={importing || !pasteText.trim()}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition disabled:opacity-60"
                >
                  {importing ? 'Importing...' : 'Import Pasted Data'}
                </button>
              </div>
            </div>
          )}

          {activeTab === 'guide' && (
            <div className="space-y-6">
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                <h4 className="text-sm font-semibold text-amber-800 mb-2">Column Reference</h4>
                <div className="grid grid-cols-2 gap-2 text-xs text-amber-700">
                  <div><strong>Name</strong> - Product name (required)</div>
                  <div><strong>SKU</strong> - Unique code (required)</div>
                  <div><strong>Category</strong> - Existing category name</div>
                  <div><strong>Brand</strong> - Existing brand name</div>
                  <div><strong>Unit</strong> - pcs, kg, box, etc.</div>
                  <div><strong>Cost Price</strong> - Purchase cost</div>
                  <div><strong>Sale Price</strong> - Selling price</div>
                  <div><strong>Current Stock</strong> - Opening stock qty</div>
                  <div><strong>Color</strong> - Color variant name</div>
                  <div><strong>Size</strong> - Size variant name</div>
                  <div><strong>Multi-Unit Name</strong> - e.g., Box</div>
                  <div><strong>Multi-Unit Conversion</strong> - e.g., 100</div>
                  <div><strong>Multi-Unit Sale Price</strong> - Price per unit</div>
                </div>
              </div>

              <div>
                <h4 className="text-sm font-semibold mb-3">Import Scenarios</h4>
                <div className="space-y-3">
                  <div className="p-3 bg-gray-50 rounded-lg border">
                    <p className="text-xs font-semibold text-gray-800 mb-1">Simple Products</p>
                    <p className="text-xs text-gray-600">Each row creates one product. For products without variants.</p>
                    <pre className="mt-2 text-xs bg-white p-2 rounded border overflow-x-auto">Name,SKU,Cost Price,Sale Price,Current Stock&#10;Hammer,HAM-001,50,80,100</pre>
                  </div>
                  <div className="p-3 bg-green-50 rounded-lg border">
                    <p className="text-xs font-semibold text-green-800 mb-1">Product with Colors/Sizes</p>
                    <p className="text-xs text-green-600">Rows with same Name create ONE product with multiple variants. Use "Product Variants" mode.</p>
                    <pre className="mt-2 text-xs bg-white p-2 rounded border overflow-x-auto">Name,SKU,Cost Price,Sale Price,Color,Current Stock&#10;T-Shirt,TS-RED,100,150,Red,50&#10;T-Shirt,TS-BLU,100,150,Blue,30&#10;T-Shirt,TS-GRN,100,150,Green,20</pre>
                  </div>
                  <div className="p-3 bg-blue-50 rounded-lg border">
                    <p className="text-xs font-semibold text-blue-800 mb-1">Multi-Unit Products</p>
                    <p className="text-xs text-blue-600">For products sold in different packaging (e.g., pieces and boxes).</p>
                    <pre className="mt-2 text-xs bg-white p-2 rounded border overflow-x-auto">Name,SKU,Unit,Cost Price,Sale Price,Multi-Unit Name,Multi-Unit Conversion,Multi-Unit Sale Price&#10;Tiles,TIL-001,sqft,25,45,Carton,20,800</pre>
                  </div>
                </div>
              </div>

              <button
                onClick={downloadTemplate}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition"
              >
                <Download className="w-4 h-4" /> Download Template with Examples
              </button>
            </div>
          )}
        </div>

        <div className="border-t border-border px-6 py-4 flex justify-end gap-3 shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-border rounded-lg text-sm hover:bg-muted transition"
          >
            {results ? 'Close' : 'Cancel'}
          </button>
        </div>
      </div>
    </div>
  );
}

function BarcodeModal({ product, onClose }: { product: ProductWithStock; onClose: () => void }) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (svgRef.current) {
      try {
        JsBarcode(svgRef.current, product.sku, {
          format: 'CODE128',
          width: 2,
          height: 80,
          displayValue: true,
          fontSize: 14,
          margin: 10,
          background: '#ffffff',
          lineColor: '#000000',
        });
      } catch (e) {
        console.error('Barcode generation error:', e);
      }
    }
  }, [product.sku]);

  function handlePrint() {
    const svgEl = svgRef.current;
    if (!svgEl) return;
    const svgHTML = new XMLSerializer().serializeToString(svgEl);
    const w = window.open('', '_blank', 'width=500,height=350');
    if (!w) return;
    w.document.write(`<!DOCTYPE html><html><head><title>Barcode - ${product.sku}</title></head><body style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px;font-family:sans-serif;margin:0"><p style="margin:0 0 4px;font-size:13px;font-weight:600">${product.name}</p><p style="margin:0 0 12px;font-size:11px;color:#666">SKU: ${product.sku}</p>${svgHTML}<script>window.onload=function(){window.print();setTimeout(function(){window.close();},500);}<\/script></body></html>`);
    w.document.close();
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-base font-bold">Product Barcode</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-6 flex flex-col items-center">
          <p className="text-sm font-semibold text-foreground mb-0.5">{product.name}</p>
          <p className="text-xs text-muted-foreground mb-4">SKU: {product.sku}</p>
          <div className="border border-border rounded-lg p-4 bg-white w-full flex justify-center">
            <svg ref={svgRef} />
          </div>
          <button
            onClick={handlePrint}
            className="mt-4 flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold transition"
          >
            <Printer className="w-4 h-4" />Print Barcode
          </button>
        </div>
      </div>
    </div>
  );
}

function ManageCatalogModal({ categories, brands, unitTypes, onClose, onSaved }: {
  categories: Category[];
  brands: Brand[];
  unitTypes: { id: string; unit_name: string; unit_short: string }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [tab, setTab] = useState<'categories' | 'brands' | 'units'>('categories');
  const [newName, setNewName] = useState('');
  const [newShort, setNewShort] = useState('');
  const [parentCategory, setParentCategory] = useState('');
  const [saving, setSaving] = useState(false);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [editingShort, setEditingShort] = useState('');

  const parentCategories = categories.filter(c => !c.parent_id);
  const subCategories = categories.filter(c => c.parent_id);

  function getSubCategories(parentId: string) {
    return subCategories.filter(sc => sc.parent_id === parentId);
  }

  function toggleCategory(id: string) {
    const newExpanded = new Set(expandedCategories);
    if (newExpanded.has(id)) newExpanded.delete(id);
    else newExpanded.add(id);
    setExpandedCategories(newExpanded);
  }

  function startEdit(id: string, name: string, short?: string) {
    setEditingId(id);
    setEditingName(name);
    setEditingShort(short || '');
  }

  function cancelEdit() {
    setEditingId(null);
    setEditingName('');
    setEditingShort('');
  }

  async function handleAdd() {
    if (!newName.trim()) return;
    if (tab === 'units' && !newShort.trim()) return;
    setSaving(true);

    if (tab === 'units') {
      const { error } = await supabase.from('unit_types').insert({ unit_name: newName.trim().toLowerCase(), unit_short: newShort.trim().toLowerCase(), is_active: true });
      if (error) toast({ title: 'Error', description: error.message, variant: 'destructive' });
      else { toast({ title: 'Unit added' }); setNewName(''); setNewShort(''); onSaved(); }
    } else {
      const table = tab === 'categories' ? 'categories' : 'brands';
      const insertData: any = { name: newName.trim(), is_active: true, slug: newName.trim().toLowerCase().replace(/\s+/g, '-') };
      if (tab === 'categories' && parentCategory) insertData.parent_id = parentCategory;
      const { error } = await supabase.from(table).insert(insertData);
      if (error) toast({ title: 'Error', description: error.message, variant: 'destructive' });
      else { toast({ title: 'Success', description: `${tab === 'categories' ? 'Category' : 'Brand'} added` }); setNewName(''); setParentCategory(''); onSaved(); }
    }
    setSaving(false);
  }

  async function handleSaveEdit(id: string, isUnit = false) {
    setSaving(true);
    if (isUnit) {
      const { error } = await supabase.from('unit_types').update({ unit_name: editingName.trim().toLowerCase(), unit_short: editingShort.trim().toLowerCase() }).eq('id', id);
      if (error) toast({ title: 'Error', description: error.message, variant: 'destructive' });
      else { toast({ title: 'Unit updated' }); cancelEdit(); onSaved(); }
    } else {
      const table = tab === 'categories' ? 'categories' : 'brands';
      const { error } = await supabase.from(table).update({ name: editingName.trim(), slug: editingName.trim().toLowerCase().replace(/\s+/g, '-') }).eq('id', id);
      if (error) toast({ title: 'Error', description: error.message, variant: 'destructive' });
      else { toast({ title: 'Updated' }); cancelEdit(); onSaved(); }
    }
    setSaving(false);
  }

  async function handleDelete(id: string, isUnit = false) {
    if (isUnit) {
      const { error } = await supabase.from('unit_types').update({ is_active: false }).eq('id', id);
      if (error) toast({ title: 'Error', description: error.message, variant: 'destructive' });
      else { toast({ title: 'Unit removed' }); onSaved(); }
    } else {
      const table = tab === 'categories' ? 'categories' : 'brands';
      const { error } = await supabase.from(table).update({ is_active: false }).eq('id', id);
      if (error) toast({ title: 'Error', description: error.message, variant: 'destructive' });
      else { toast({ title: 'Deleted' }); onSaved(); }
    }
  }

  const items = tab === 'categories' ? parentCategories : brands;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-base font-bold">Manage Catalog</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>
        <div className="flex border-b border-border">
          {([
            { key: 'categories', label: `Categories (${categories.length})` },
            { key: 'brands', label: `Brands (${brands.length})` },
            { key: 'units', label: `Units (${unitTypes.length})` },
          ] as const).map(t => (
            <button
              key={t.key}
              onClick={() => { setTab(t.key); setNewName(''); setNewShort(''); setParentCategory(''); }}
              className={`flex-1 py-3 text-xs font-medium transition ${tab === t.key ? 'text-blue-600 border-b-2 border-blue-600' : 'text-muted-foreground hover:text-foreground'}`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="p-4">
          <div className="space-y-2 mb-4">
            {tab === 'units' ? (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <input
                    value={newName}
                    onChange={e => setNewName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleAdd()}
                    placeholder="Unit name (e.g. Carton)"
                    className="flex-1 border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  />
                  <input
                    value={newShort}
                    onChange={e => setNewShort(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleAdd()}
                    placeholder="Short (e.g. ctn)"
                    className="w-24 border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  />
                  <button
                    onClick={handleAdd}
                    disabled={saving || !newName.trim() || !newShort.trim()}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold transition disabled:opacity-50"
                  >
                    Add
                  </button>
                </div>
                <p className="text-xs text-muted-foreground">Short name is the abbreviation shown on invoices (e.g. "pcs", "box", "ctn").</p>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <input
                    value={newName}
                    onChange={e => setNewName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleAdd()}
                    placeholder={`New ${tab === 'categories' ? 'category' : 'brand'} name...`}
                    className="flex-1 border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  />
                  <button
                    onClick={handleAdd}
                    disabled={saving || !newName.trim()}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold transition disabled:opacity-50"
                  >
                    Add
                  </button>
                </div>
                {tab === 'categories' && (
                  <select
                    value={parentCategory}
                    onChange={e => setParentCategory(e.target.value)}
                    className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none bg-white"
                  >
                    <option value="">Top-level category</option>
                    {parentCategories.map(c => (
                      <option key={c.id} value={c.id}>Sub-category of: {c.name}</option>
                    ))}
                  </select>
                )}
              </div>
            )}
          </div>

          <div className="space-y-1 max-h-64 overflow-y-auto">
            {tab === 'units' ? (
              unitTypes.length === 0 ? (
                <p className="text-center text-sm text-muted-foreground py-6">No units yet. Add one above.</p>
              ) : (
                <div className="grid grid-cols-4 gap-1 px-2 py-1 text-xs font-semibold text-muted-foreground border-b border-border mb-1">
                  <span className="col-span-1">Name</span><span className="col-span-1">Short</span><span className="col-span-2"></span>
                </div>
              ) && unitTypes.map(u => (
                <div key={u.id} className="grid grid-cols-4 gap-1 items-center px-2 py-1.5 rounded-lg hover:bg-muted/50 group">
                  {editingId === u.id ? (
                    <>
                      <input value={editingName} onChange={e => setEditingName(e.target.value)} className="col-span-1 border border-blue-300 rounded px-1 py-0.5 text-sm" autoFocus />
                      <input value={editingShort} onChange={e => setEditingShort(e.target.value)} className="col-span-1 border border-blue-300 rounded px-1 py-0.5 text-sm" />
                      <div className="col-span-2 flex justify-end gap-1">
                        <button onClick={() => handleSaveEdit(u.id, true)} disabled={saving} className="px-2 py-0.5 bg-blue-600 text-white rounded text-xs">Save</button>
                        <button onClick={cancelEdit} className="px-2 py-0.5 border border-border rounded text-xs">Cancel</button>
                      </div>
                    </>
                  ) : (
                    <>
                      <span className="text-sm text-foreground font-medium">{u.unit_name}</span>
                      <span className="text-sm text-muted-foreground font-mono">{u.unit_short}</span>
                      <div className="col-span-2 flex justify-end gap-1">
                        <button
                          onClick={() => startEdit(u.id, u.unit_name, u.unit_short)}
                          className="opacity-0 group-hover:opacity-100 w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:text-blue-600 hover:bg-blue-50 transition"
                          title="Edit unit"
                        >
                          <Edit className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDelete(u.id, true)}
                          className="opacity-0 group-hover:opacity-100 w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:text-red-600 hover:bg-red-50 transition"
                          title="Remove unit"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ))
            ) : items.length === 0 ? (
              <p className="text-center text-sm text-muted-foreground py-6">No {tab} added yet. Add one above.</p>
            ) : tab === 'categories' ? (
              parentCategories.map(cat => {
                const subs = getSubCategories(cat.id);
                const isExpanded = expandedCategories.has(cat.id);
                return (
                  <div key={cat.id}>
                    <div className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-muted/50 group">
                      <div className="flex items-center gap-2">
                        {subs.length > 0 && (
                          <button onClick={() => toggleCategory(cat.id)} className="text-muted-foreground hover:text-foreground">
                            {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                          </button>
                        )}
                        {editingId === cat.id ? (
                          <div className="flex items-center gap-2 flex-1">
                            <input value={editingName} onChange={e => setEditingName(e.target.value)} className="border border-blue-300 rounded px-2 py-0.5 text-sm flex-1" autoFocus />
                            <button onClick={() => handleSaveEdit(cat.id)} disabled={saving} className="px-2 py-0.5 bg-blue-600 text-white rounded text-xs">Save</button>
                            <button onClick={cancelEdit} className="px-2 py-0.5 border border-border rounded text-xs">Cancel</button>
                          </div>
                        ) : (
                          <>
                            <span className="text-sm text-foreground font-medium">{cat.name}</span>
                            {subs.length > 0 && <span className="text-xs text-muted-foreground">({subs.length})</span>}
                          </>
                        )}
                      </div>
                      {editingId !== cat.id && (
                        <div className="flex items-center gap-1">
                          <button onClick={() => startEdit(cat.id, cat.name)} className="opacity-0 group-hover:opacity-100 w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:text-blue-600 hover:bg-blue-50 transition" title="Edit">
                            <Edit className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => handleDelete(cat.id)} className="opacity-0 group-hover:opacity-100 w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:text-red-600 hover:bg-red-50 transition" title="Delete">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                    {isExpanded && subs.length > 0 && (
                      <div className="ml-6 space-y-1 border-l border-border pl-2">
                        {subs.map(sub => (
                          <div key={sub.id} className="flex items-center justify-between px-3 py-1.5 rounded-lg hover:bg-muted/50 group">
                            {editingId === sub.id ? (
                              <div className="flex items-center gap-2 flex-1">
                                <input value={editingName} onChange={e => setEditingName(e.target.value)} className="border border-blue-300 rounded px-2 py-0.5 text-sm flex-1" autoFocus />
                                <button onClick={() => handleSaveEdit(sub.id)} disabled={saving} className="px-2 py-0.5 bg-blue-600 text-white rounded text-xs">Save</button>
                                <button onClick={cancelEdit} className="px-2 py-0.5 border border-border rounded text-xs">Cancel</button>
                              </div>
                            ) : (
                              <>
                                <span className="text-sm text-muted-foreground">{sub.name}</span>
                                <div className="flex items-center gap-1">
                                  <button onClick={() => startEdit(sub.id, sub.name)} className="opacity-0 group-hover:opacity-100 w-5 h-5 flex items-center justify-center rounded text-muted-foreground hover:text-blue-600 hover:bg-blue-50 transition" title="Edit">
                                    <Edit className="w-3 h-3" />
                                  </button>
                                  <button onClick={() => handleDelete(sub.id)} className="opacity-0 group-hover:opacity-100 w-5 h-5 flex items-center justify-center rounded text-muted-foreground hover:text-red-600 hover:bg-red-50 transition" title="Delete">
                                    <Trash2 className="w-3 h-3" />
                                  </button>
                                </div>
                              </>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })
            ) : (
              brands.map(item => (
                <div key={item.id} className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-muted/50 group">
                  {editingId === item.id ? (
                    <div className="flex items-center gap-2 flex-1">
                      <input value={editingName} onChange={e => setEditingName(e.target.value)} className="border border-blue-300 rounded px-2 py-0.5 text-sm flex-1" autoFocus />
                      <button onClick={() => handleSaveEdit(item.id)} disabled={saving} className="px-2 py-0.5 bg-blue-600 text-white rounded text-xs">Save</button>
                      <button onClick={cancelEdit} className="px-2 py-0.5 border border-border rounded text-xs">Cancel</button>
                    </div>
                  ) : (
                    <>
                      <span className="text-sm text-foreground">{item.name}</span>
                      <div className="flex items-center gap-1">
                        <button onClick={() => startEdit(item.id, item.name)} className="opacity-0 group-hover:opacity-100 w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:text-blue-600 hover:bg-blue-50 transition" title="Edit">
                          <Edit className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => handleDelete(item.id)} className="opacity-0 group-hover:opacity-100 w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:text-red-600 hover:bg-red-50 transition" title="Delete">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
