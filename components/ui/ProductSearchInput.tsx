'use client';

import { useEffect, useRef, useState } from 'react';
import { Search, X, Filter } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { formatCurrency } from '@/lib/format';
import type { ProductUnit } from '@/lib/types';

interface ProductResult {
  id: string;
  name: string;
  sku: string;
  sale_price: number;
  cost_price: number;
  unit?: string;
  base_unit?: string;
  enable_multi_unit?: boolean;
  image_url?: string;
  inventory_items?: { quantity_on_hand: number }[];
  units?: ProductUnit[];
}

interface Brand {
  id: string;
  name: string;
}

interface Props {
  onSelect: (product: ProductResult) => void;
  placeholder?: string;
  showStock?: boolean;
  className?: string;
}

export default function ProductSearchInput({ onSelect, placeholder = 'Search product by name or SKU...', showStock = false, className = '' }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ProductResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [selectedBrand, setSelectedBrand] = useState<string>('');
  const [brandDropdownOpen, setBrandDropdownOpen] = useState(false);
  const [brandSearch, setBrandSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    supabase
      .from('brands')
      .select('id, name')
      .eq('is_active', true)
      .order('name')
      .then(({ data }) => setBrands(data || []));
  }, []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setBrandDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) { setResults([]); setOpen(false); return; }

    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      let dbQuery = supabase
        .from('products')
        .select(`id, name, sku, sale_price, cost_price, unit, base_unit, enable_multi_unit, image_url,
          inventory_items(quantity_on_hand),
          units:product_units(id, product_id, unit_name, unit_short, conversion_factor, is_base_unit, is_sale_unit, price, cost_price, is_active, sort_order)`)
        .eq('is_active', true)
        .or(`name.ilike.%${query.trim()}%,sku.ilike.%${query.trim()}%`)
        .order('name')
        .limit(20);

      if (selectedBrand) {
        dbQuery = dbQuery.eq('brand_id', selectedBrand);
      }

      const { data } = await dbQuery;
      setResults((data as ProductResult[]) || []);
      setOpen(true);
      setLoading(false);
    }, 250);

    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, selectedBrand]);

  function handleSelect(product: ProductResult) {
    onSelect(product);
    setQuery('');
    setResults([]);
    setOpen(false);
  }

  const stock = (p: ProductResult) =>
    p.inventory_items?.reduce((s, i) => s + Number(i.quantity_on_hand), 0) ?? null;

  const selectedBrandName = brands.find(b => b.id === selectedBrand)?.name;
  const filteredBrands = brandSearch.trim()
    ? brands.filter(b => b.name.toLowerCase().includes(brandSearch.trim().toLowerCase()))
    : brands;

  return (
    <div ref={containerRef} className={`relative flex gap-2 ${className}`}>
      {/* Brand filter */}
      <div className="relative shrink-0">
        <button
          type="button"
          onClick={() => setBrandDropdownOpen(!brandDropdownOpen)}
          className={`flex items-center gap-1.5 border rounded-lg px-3 py-2 text-sm bg-white hover:border-blue-300 focus:outline-none focus:border-blue-500 transition whitespace-nowrap ${
            selectedBrand ? 'border-blue-500 text-blue-600' : 'border-border text-muted-foreground'
          }`}
          title="Filter by brand"
        >
          <Filter className="w-3.5 h-3.5" />
          <span className="max-w-[120px] truncate">{selectedBrand ? selectedBrandName : 'All Brands'}</span>
          {selectedBrand && (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => { e.stopPropagation(); setSelectedBrand(''); setBrandSearch(''); }}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); setSelectedBrand(''); setBrandSearch(''); } }}
              className="ml-0.5 hover:text-red-500"
            >
              <X className="w-3 h-3" />
            </span>
          )}
        </button>

        {brandDropdownOpen && (
          <div className="absolute top-full left-0 mt-1 bg-white border border-border rounded-lg shadow-lg z-50 w-56 overflow-hidden">
            <div className="p-2 border-b border-border">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <input
                  type="text"
                  value={brandSearch}
                  onChange={e => setBrandSearch(e.target.value)}
                  placeholder="Search brands..."
                  className="w-full pl-8 pr-3 py-1.5 text-sm border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500"
                  autoFocus
                />
              </div>
            </div>
            <div className="max-h-48 overflow-y-auto">
              <button
                type="button"
                onClick={() => { setSelectedBrand(''); setBrandDropdownOpen(false); setBrandSearch(''); }}
                className={`w-full flex items-center px-3 py-2 text-sm hover:bg-blue-50 transition text-left ${!selectedBrand ? 'bg-blue-50 text-blue-600' : 'text-muted-foreground'}`}
              >
                All Brands
              </button>
              {filteredBrands.map(b => (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => { setSelectedBrand(b.id); setBrandDropdownOpen(false); setBrandSearch(''); }}
                  className={`w-full flex items-center px-3 py-2 text-sm hover:bg-blue-50 transition text-left ${selectedBrand === b.id ? 'bg-blue-50 text-blue-600' : 'text-foreground'}`}
                >
                  {b.name}
                </button>
              ))}
              {filteredBrands.length === 0 && (
                <div className="px-3 py-3 text-center text-xs text-muted-foreground">No brands found</div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Search input */}
      <div className="relative flex-1">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onFocus={() => { if (results.length > 0) setOpen(true); }}
            placeholder={placeholder}
            className="w-full pl-8 pr-8 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 bg-white"
          />
          {query && (
            <button
              type="button"
              onClick={() => { setQuery(''); setResults([]); setOpen(false); }}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {open && (
          <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-border rounded-xl shadow-lg z-50 max-h-72 overflow-y-auto">
            {loading ? (
              <div className="px-4 py-3 text-sm text-muted-foreground">Searching...</div>
            ) : results.length === 0 ? (
              <div className="px-4 py-3 text-sm text-muted-foreground">No products found for "{query}"</div>
            ) : results.map(p => {
              const s = showStock ? stock(p) : null;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => handleSelect(p)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-blue-50 transition text-left border-b border-border/50 last:border-0"
                >
                  <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center overflow-hidden shrink-0">
                    {p.image_url
                      ? <img src={p.image_url} alt="" className="w-full h-full object-cover" />
                      : <span className="text-xs text-muted-foreground">?</span>
                    }
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{p.name}</p>
                    <p className="text-xs text-muted-foreground">{p.sku}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-semibold text-blue-600">{formatCurrency(p.sale_price)}</p>
                    {showStock && s !== null && (
                      <p className={`text-[10px] font-medium ${s > 0 ? 'text-green-600' : 'text-red-500'}`}>
                        {s > 0 ? `${s} in stock` : 'Out of stock'}
                      </p>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
