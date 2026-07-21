'use client';

import { useEffect, useRef, useState } from 'react';
import { Search, X, User } from 'lucide-react';
import { supabase } from '@/lib/supabase';

export interface CustomerResult {
  id: string;
  name: string;
  code?: string;
  phone?: string;
  address?: string;
  outstanding_balance?: number;
}

interface Props {
  onSelect: (customer: CustomerResult) => void;
  selectedName?: string;
  placeholder?: string;
  className?: string;
}

export default function CustomerSearchInput({ onSelect, selectedName, placeholder = 'Search customer by name or code...', className = '' }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CustomerResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
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
      const { data } = await supabase
        .from('customers')
        .select('id, name, code, phone, address, outstanding_balance')
        .or(`name.ilike.%${query.trim()}%,code.ilike.%${query.trim()}%,phone.ilike.%${query.trim()}%`)
        .order('name')
        .limit(20);

      setResults((data as CustomerResult[]) || []);
      setOpen(true);
      setLoading(false);
    }, 250);

    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query]);

  function handleSelect(customer: CustomerResult) {
    onSelect(customer);
    setQuery('');
    setResults([]);
    setOpen(false);
  }

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onFocus={() => { if (results.length > 0) setOpen(true); }}
          placeholder={selectedName && !query ? selectedName : placeholder}
          className="w-full pl-8 pr-8 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 bg-white"
        />
        {query && (
          <button
            type="button"
            onClick={() => { setQuery(''); setResults([]); setOpen(false); inputRef.current?.focus(); }}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {open && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-border rounded-xl shadow-lg z-50 max-h-64 overflow-y-auto">
          {loading ? (
            <div className="px-4 py-3 text-sm text-muted-foreground">Searching...</div>
          ) : results.length === 0 ? (
            <div className="px-4 py-3 text-sm text-muted-foreground">No customers found for &quot;{query}&quot;</div>
          ) : results.map(c => (
            <button
              key={c.id}
              type="button"
              onClick={() => handleSelect(c)}
              className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-blue-50 transition text-left border-b border-border/50 last:border-0"
            >
              <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center shrink-0">
                <User className="w-4 h-4 text-blue-600" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground truncate">{c.name}</p>
                <p className="text-xs text-muted-foreground">
                  {c.code || ''}{c.code && c.phone ? ' · ' : ''}{c.phone || ''}
                </p>
              </div>
              {c.outstanding_balance !== undefined && Number(c.outstanding_balance) > 0 && (
                <span className="text-[10px] font-medium text-amber-600 shrink-0">
                  Due: {Number(c.outstanding_balance).toLocaleString('en-BD', { minimumFractionDigits: 0 })}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
