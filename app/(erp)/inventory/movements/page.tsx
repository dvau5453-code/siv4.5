'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { formatRelativeTime, formatDate } from '@/lib/format';
import { ArrowUpDown, TrendingUp, TrendingDown, Package, Search, X, Filter, ChevronLeft, ChevronRight, Calendar, Download } from 'lucide-react';

const typeConfig: Record<string, { label: string; color: string; bg: string; sign: string }> = {
  purchase: { label: 'Purchase', color: 'text-green-600', bg: 'bg-green-50', sign: '+' },
  sale: { label: 'Sale', color: 'text-red-600', bg: 'bg-red-50', sign: '-' },
  adjustment: { label: 'Adjustment', color: 'text-blue-600', bg: 'bg-blue-50', sign: '±' },
  transfer_in: { label: 'Transfer In', color: 'text-teal-600', bg: 'bg-teal-50', sign: '+' },
  transfer_out: { label: 'Transfer Out', color: 'text-orange-600', bg: 'bg-orange-50', sign: '-' },
  damage: { label: 'Damage', color: 'text-red-600', bg: 'bg-red-50', sign: '-' },
  opening: { label: 'Opening', color: 'text-purple-600', bg: 'bg-purple-50', sign: '+' },
};

const movementTypes = Object.keys(typeConfig);

type FilterState = {
  search: string;
  movementType: string;
  warehouseId: string;
  dateFrom: string;
  dateTo: string;
};

const initialFilters: FilterState = {
  search: '',
  movementType: 'all',
  warehouseId: 'all',
  dateFrom: '',
  dateTo: '',
};

const PAGE_SIZE = 25;

export default function StockMovementsPage() {
  const [allMovements, setAllMovements] = useState<any[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<FilterState>(initialFilters);
  const [currentPage, setCurrentPage] = useState(1);
  const [showFilters, setShowFilters] = useState(true);

  useEffect(() => {
    async function load() {
      const [movRes, whRes] = await Promise.all([
        supabase.from('stock_movements').select('*, product:products(name, sku), warehouse:warehouses(name)').order('created_at', { ascending: false }).limit(500),
        supabase.from('warehouses').select('id, name').order('name'),
      ]);
      setAllMovements(movRes.data || []);
      setWarehouses(whRes.data || []);
      setLoading(false);
    }
    load();
  }, []);

  const filtered = useMemo(() => {
    return allMovements.filter((m) => {
      if (filters.search) {
        const q = filters.search.toLowerCase();
        const productName = (m.product?.name || '').toLowerCase();
        const sku = (m.product?.sku || '').toLowerCase();
        const refNum = (m.reference_number || '').toLowerCase();
        const notes = (m.notes || '').toLowerCase();
        if (!productName.includes(q) && !sku.includes(q) && !refNum.includes(q) && !notes.includes(q)) return false;
      }
      if (filters.movementType !== 'all' && m.movement_type !== filters.movementType) return false;
      if (filters.warehouseId !== 'all' && m.warehouse_id !== filters.warehouseId) return false;
      if (filters.dateFrom) {
        const moveDate = new Date(m.created_at).toISOString().split('T')[0];
        if (moveDate < filters.dateFrom) return false;
      }
      if (filters.dateTo) {
        const moveDate = new Date(m.created_at).toISOString().split('T')[0];
        if (moveDate > filters.dateTo) return false;
      }
      return true;
    });
  }, [allMovements, filters]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paginated = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  useEffect(() => {
    setCurrentPage(1);
  }, [filters]);

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (filters.search) count++;
    if (filters.movementType !== 'all') count++;
    if (filters.warehouseId !== 'all') count++;
    if (filters.dateFrom) count++;
    if (filters.dateTo) count++;
    return count;
  }, [filters]);

  const handleFilterChange = useCallback((key: keyof FilterState, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }, []);

  const resetFilters = useCallback(() => {
    setFilters(initialFilters);
  }, []);

  const exportCSV = useCallback(() => {
    const headers = ['Date', 'Product', 'SKU', 'Warehouse', 'Type', 'Quantity', 'Reference', 'Notes'];
    const rows = filtered.map((m) => {
      const cfg = typeConfig[m.movement_type] || typeConfig.adjustment;
      return [
        new Date(m.created_at).toISOString(),
        m.product?.name || '',
        m.product?.sku || '',
        m.warehouse?.name || '',
        cfg.label,
        `${cfg.sign}${Math.abs(m.quantity)}`,
        m.reference_number || '',
        m.notes || '',
      ];
    });
    const csv = [headers, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `stock_movements_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [filtered]);

  const inCount = filtered.filter((m) => m.quantity > 0).length;
  const outCount = filtered.filter((m) => m.quantity < 0).length;
  const totalIn = filtered.filter((m) => m.quantity > 0).reduce((s, m) => s + Math.abs(m.quantity), 0);
  const totalOut = filtered.filter((m) => m.quantity < 0).reduce((s, m) => s + Math.abs(m.quantity), 0);

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Stock Movements</h1>
          <p className="text-muted-foreground text-sm mt-0.5">Complete audit trail of all inventory changes</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowFilters(!showFilters)}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg border border-border bg-background hover:bg-muted/50 transition-colors"
          >
            <Filter className="w-4 h-4" />
            Filters
            {activeFilterCount > 0 && (
              <span className="inline-flex items-center justify-center w-5 h-5 text-xs font-bold rounded-full bg-blue-600 text-white">{activeFilterCount}</span>
            )}
          </button>
          <button
            onClick={exportCSV}
            disabled={filtered.length === 0}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg border border-border bg-background hover:bg-muted/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Download className="w-4 h-4" />
            Export
          </button>
        </div>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-2 text-muted-foreground text-xs font-medium mb-1">
            <Package className="w-4 h-4" /> Total Movements
          </div>
          <div className="text-2xl font-bold text-foreground">{filtered.length.toLocaleString()}</div>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-2 text-green-600 text-xs font-medium mb-1">
            <TrendingUp className="w-4 h-4" /> Stock In
          </div>
          <div className="text-2xl font-bold text-green-600">{totalIn.toLocaleString()}</div>
          <div className="text-xs text-muted-foreground mt-0.5">{inCount} movements</div>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-2 text-red-600 text-xs font-medium mb-1">
            <TrendingDown className="w-4 h-4" /> Stock Out
          </div>
          <div className="text-2xl font-bold text-red-600">{totalOut.toLocaleString()}</div>
          <div className="text-xs text-muted-foreground mt-0.5">{outCount} movements</div>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-2 text-muted-foreground text-xs font-medium mb-1">
            <ArrowUpDown className="w-4 h-4" /> Net Change
          </div>
          <div className={`text-2xl font-bold ${(totalIn - totalOut) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
            {(totalIn - totalOut) >= 0 ? '+' : ''}{(totalIn - totalOut).toLocaleString()}
          </div>
        </div>
      </div>

      {/* Filter Bar */}
      {showFilters && (
        <div className="rounded-xl border border-border bg-card p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Filter className="w-4 h-4" /> Filter Stock Movements
            </h3>
            {activeFilterCount > 0 && (
              <button onClick={resetFilters} className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors">
                <X className="w-3.5 h-3.5" /> Clear all ({activeFilterCount})
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {/* Search */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Search</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Product, SKU, ref no..."
                  value={filters.search}
                  onChange={(e) => handleFilterChange('search', e.target.value)}
                  className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                />
              </div>
            </div>

            {/* Movement Type */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Movement Type</label>
              <select
                value={filters.movementType}
                onChange={(e) => handleFilterChange('movementType', e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
              >
                <option value="all">All Types</option>
                {movementTypes.map((t) => (
                  <option key={t} value={t}>{typeConfig[t].label}</option>
                ))}
              </select>
            </div>

            {/* Warehouse */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Warehouse</label>
              <select
                value={filters.warehouseId}
                onChange={(e) => handleFilterChange('warehouseId', e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
              >
                <option value="all">All Warehouses</option>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </select>
            </div>

            {/* Date From */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">From Date</label>
              <div className="relative">
                <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                <input
                  type="date"
                  value={filters.dateFrom}
                  onChange={(e) => handleFilterChange('dateFrom', e.target.value)}
                  className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                />
              </div>
            </div>

            {/* Date To */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">To Date</label>
              <div className="relative">
                <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                <input
                  type="date"
                  value={filters.dateTo}
                  onChange={(e) => handleFilterChange('dateTo', e.target.value)}
                  className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                />
              </div>
            </div>
          </div>

          {/* Quick Date Presets */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-medium text-muted-foreground">Quick select:</span>
            {[
              { label: 'Today', days: 0 },
              { label: '7 days', days: 7 },
              { label: '30 days', days: 30 },
              { label: '90 days', days: 90 },
            ].map((preset) => (
              <button
                key={preset.label}
                onClick={() => {
                  const to = new Date();
                  const from = new Date();
                  from.setDate(from.getDate() - preset.days);
                  setFilters((prev) => ({
                    ...prev,
                    dateFrom: from.toISOString().split('T')[0],
                    dateTo: to.toISOString().split('T')[0],
                  }));
                }}
                className="px-2.5 py-1 text-xs font-medium rounded-md bg-muted hover:bg-muted/70 text-muted-foreground hover:text-foreground transition-colors"
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Results Table */}
      <div className="table-wrapper">
        <table className="w-full">
          <thead><tr className="bg-muted/40 border-b border-border">
            {['Product','SKU','Warehouse','Type','Qty','Reference','Date'].map(h => <th key={h} className="text-left text-xs font-semibold text-muted-foreground px-4 py-3">{h}</th>)}
          </tr></thead>
          <tbody className="divide-y divide-border">
            {loading ? Array.from({length: 8}).map((_, i) => (
              <tr key={i}>{Array.from({length: 7}).map((_, j) => <td key={j} className="px-4 py-3"><div className="h-4 bg-muted rounded animate-pulse" /></td>)}</tr>
            )) : paginated.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-12 text-center text-muted-foreground text-sm">
                {activeFilterCount > 0 ? 'No stock movements match your filters' : 'No stock movements recorded yet'}
              </td></tr>
            ) : paginated.map((m: any) => {
              const cfg = typeConfig[m.movement_type] || typeConfig.adjustment;
              return (
                <tr key={m.id} className="hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3 text-sm font-medium text-foreground">{m.product?.name || '—'}</td>
                  <td className="px-4 py-3 text-xs font-mono text-muted-foreground">{m.product?.sku || '—'}</td>
                  <td className="px-4 py-3 text-sm text-foreground">{m.warehouse?.name || '—'}</td>
                  <td className="px-4 py-3"><span className={`badge-status ${cfg.bg} ${cfg.color}`}>{cfg.label}</span></td>
                  <td className="px-4 py-3 text-sm font-bold"><span className={m.quantity > 0 ? 'text-green-600' : 'text-red-600'}>{cfg.sign}{Math.abs(m.quantity)}</span></td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{m.reference_number || '—'}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{formatRelativeTime(m.created_at)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {filtered.length > 0 && (
        <div className="flex items-center justify-between flex-wrap gap-2">
          <span className="text-sm text-muted-foreground">
            Showing {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, filtered.length)} of {filtered.length} movements
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium rounded-lg border border-border bg-background hover:bg-muted/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-4 h-4" /> Prev
            </button>
            <span className="px-3 py-1.5 text-sm font-medium text-muted-foreground">
              Page {currentPage} / {totalPages || 1}
            </span>
            <button
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages || totalPages === 0}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium rounded-lg border border-border bg-background hover:bg-muted/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Next <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
