'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { formatCurrency } from '@/lib/format';
import { toast } from '@/hooks/use-toast';
import { X, Save, TriangleAlert as AlertTriangle, History, Package, Trash2, Info } from 'lucide-react';
import type { Invoice, InvoiceStatus, Customer, Product, ProductUnit } from '@/lib/types';
import { isMultiUnitEnabled, getDefaultSaleUnit, convertToBaseUnit } from '@/lib/unit-utils';
import ProductSearchInput from '@/components/ui/ProductSearchInput';

interface EditableInvoice extends Omit<Invoice, 'customer'> {
  customer?: { name: string; code: string; phone?: string; address?: string };
}

interface EditInvoiceModalProps {
  invoice: EditableInvoice;
  customers: Customer[];
  products: Product[];
  onClose: () => void;
  onSaved: () => void;
}

interface EditItem {
  id?: string;
  product_id: string;
  product_name: string;
  product_sku: string;
  product_unit?: string;
  product_base_unit?: string;
  stock_qty: number | null;
  quantity: number;
  unit_price: number;
  cost_price: number;
  discount_percent: number;
  selected_unit?: ProductUnit;
  available_units?: ProductUnit[];
  base_quantity: number;
  subtotal: number;
}

export default function EditInvoiceModal({ invoice, customers, products, onClose, onSaved }: EditInvoiceModalProps) {
  const [form, setForm] = useState({
    customer_id: invoice.customer_id,
    invoice_date: invoice.invoice_date,
    due_date: invoice.due_date || '',
    notes: (invoice as any).notes || '',
  });
  const [items, setItems] = useState<EditItem[]>([]);
  const [originalItems, setOriginalItems] = useState<EditItem[]>([]);
  const [originalQtyMap, setOriginalQtyMap] = useState<Record<string, number>>({});
  const [originalHeader, setOriginalHeader] = useState({ ...form });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [editReason, setEditReason] = useState('');
  const [showReason, setShowReason] = useState(false);
  const [loadingItems, setLoadingItems] = useState(true);

  const isDraft = invoice.status === 'draft';
  const isPaid = invoice.status === 'paid';
  const isPartial = invoice.status === 'partially_paid';
  const isPos = invoice.is_pos;

  useEffect(() => {
    loadInvoiceItems();
  }, []);

  async function loadInvoiceItems() {
    setLoadingItems(true);
    const { data } = await supabase
      .from('invoice_items')
      .select('*, product:products(name, sku, unit, base_unit, enable_multi_unit, units:product_units(id, product_id, unit_name, unit_short, conversion_factor, is_base_unit, is_sale_unit, price, cost_price, is_active, sort_order), inventory_items(quantity_on_hand))')
      .eq('invoice_id', invoice.id);

    const mapped: EditItem[] = (data || []).map((item: any) => {
      const product = item.product;
      const multiUnit = product?.enable_multi_unit && product?.units?.filter((u: any) => u.is_active).length > 0;
      const matchedUnit = multiUnit ? product.units.find((u: any) => u.unit_name === item.unit_name) : undefined;
      const stock = product?.inventory_items?.reduce((s: number, i: any) => s + Number(i.quantity_on_hand), 0) ?? null;

      return {
        id: item.id,
        product_id: item.product_id,
        product_name: product?.name || '—',
        product_sku: product?.sku || '',
        product_unit: product?.unit,
        product_base_unit: product?.base_unit,
        stock_qty: stock,
        quantity: Number(item.quantity),
        unit_price: Number(item.unit_price),
        cost_price: Number(item.cost_price) || 0,
        discount_percent: Number(item.discount_percent) || 0,
        selected_unit: matchedUnit,
        available_units: multiUnit ? product.units.filter((u: any) => u.is_active) : undefined,
        base_quantity: Number(item.base_quantity) || Number(item.quantity),
        subtotal: Number(item.subtotal),
      };
    });

    setItems(mapped);
    setOriginalItems(mapped.map(m => ({ ...m })));

    const qtyMap: Record<string, number> = {};
    for (const m of mapped) {
      qtyMap[m.product_id] = (qtyMap[m.product_id] || 0) + m.base_quantity;
    }
    setOriginalQtyMap(qtyMap);

    setLoadingItems(false);
  }

  function getEffectiveStock(productId: string, currentStock: number | null): number | null {
    if (currentStock === null) return null;
    return currentStock + (originalQtyMap[productId] || 0);
  }

  function addProductToItems(product: any) {
    const multiUnit = product.enable_multi_unit && product.units && product.units.filter((u: any) => u.is_active).length > 0;
    const defaultUnit: ProductUnit | undefined = multiUnit ? getDefaultSaleUnit(product) : undefined;
    const unitPrice = defaultUnit ? defaultUnit.price : (product.sale_price || 0);
    const baseQty = defaultUnit ? convertToBaseUnit(1, defaultUnit) : 1;
    const stock = product.inventory_items?.reduce((s: number, i: any) => s + Number(i.quantity_on_hand), 0) ?? null;
    const effStock = getEffectiveStock(product.id, stock);

    if (effStock !== null && effStock <= 0) {
      toast({ title: 'Out of stock', description: `${product.name} is not available`, variant: 'destructive' });
      return;
    }

    const existingIndex = items.findIndex(
      i => i.product_id === product.id && (i.selected_unit?.id ?? '') === (defaultUnit?.id ?? '')
    );
    if (existingIndex >= 0) {
      const updated = [...items];
      const ex = updated[existingIndex];
      const newQty = ex.quantity + 1;
      const newBase = ex.selected_unit ? convertToBaseUnit(newQty, ex.selected_unit) : newQty;
      const exEffStock = getEffectiveStock(ex.product_id, ex.stock_qty);
      if (exEffStock !== null && newBase > exEffStock) {
        toast({ title: 'Stock limit', description: `Only ${exEffStock} ${ex.product_base_unit || 'units'} available`, variant: 'destructive' });
        return;
      }
      updated[existingIndex] = { ...ex, quantity: newQty, base_quantity: newBase, subtotal: newQty * ex.unit_price * (1 - (ex.discount_percent || 0) / 100) };
      setItems(updated);
      return;
    }

    setItems(prev => [...prev, {
      product_id: product.id,
      product_name: product.name,
      product_sku: product.sku,
      product_unit: product.unit,
      product_base_unit: product.base_unit,
      stock_qty: stock,
      quantity: 1,
      unit_price: unitPrice,
      cost_price: defaultUnit ? (defaultUnit.cost_price || product.cost_price || 0) : (product.cost_price || 0),
      discount_percent: 0,
      selected_unit: defaultUnit,
      available_units: multiUnit ? product.units.filter((u: any) => u.is_active) : undefined,
      base_quantity: baseQty,
      subtotal: unitPrice,
    }]);
  }

  function updateItem(index: number, field: string, value: any) {
    const updated = [...items];
    if (field === 'selected_unit') {
      const unit = value as ProductUnit;
      const newBaseQty = convertToBaseUnit(updated[index].quantity, unit);
      updated[index] = { ...updated[index], selected_unit: unit, unit_price: unit.price, base_quantity: newBaseQty, subtotal: updated[index].quantity * unit.price * (1 - (updated[index].discount_percent || 0) / 100) };
    } else if (field === 'quantity') {
      const qty = parseInt(value) || 1;
      const unit = updated[index].selected_unit;
      const newBaseQty = unit ? convertToBaseUnit(qty, unit) : qty;
      updated[index] = { ...updated[index], quantity: qty, base_quantity: newBaseQty, subtotal: qty * updated[index].unit_price * (1 - (updated[index].discount_percent || 0) / 100) };
    } else if (field === 'unit_price') {
      updated[index] = { ...updated[index], unit_price: parseFloat(value) || 0, subtotal: updated[index].quantity * (parseFloat(value) || 0) * (1 - (updated[index].discount_percent || 0) / 100) };
    } else if (field === 'discount_percent') {
      const disc = Math.min(100, Math.max(0, parseFloat(value) || 0));
      updated[index] = { ...updated[index], discount_percent: disc, subtotal: updated[index].quantity * updated[index].unit_price * (1 - disc / 100) };
    }
    setItems(updated);
  }

  function removeItem(index: number) {
    setItems(items.filter((_, i) => i !== index));
  }

  const subtotal = items.reduce((sum, item) => sum + item.subtotal, 0);
  const hasItemChanges = JSON.stringify(items.map(i => ({ product_id: i.product_id, quantity: i.quantity, unit_price: i.unit_price, discount_percent: i.discount_percent, selected_unit_id: i.selected_unit?.id }))) !== JSON.stringify(originalItems.map(i => ({ product_id: i.product_id, quantity: i.quantity, unit_price: i.unit_price, discount_percent: i.discount_percent, selected_unit_id: i.selected_unit?.id })));
  const hasHeaderChanges = form.customer_id !== originalHeader.customer_id || form.invoice_date !== originalHeader.invoice_date || form.due_date !== originalHeader.due_date || form.notes !== originalHeader.notes;
  const hasChanges = hasItemChanges || hasHeaderChanges;

  useEffect(() => {
    setShowReason(!isDraft && hasChanges);
  }, [hasChanges, isDraft]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!hasChanges) { toast({ title: 'No changes', description: 'Nothing was modified' }); return; }
    if (showReason && !editReason.trim()) { setError('Please provide a reason for this edit'); return; }
    if (items.length === 0) { setError('Invoice must have at least one item'); return; }

    for (const item of items) {
      const effStock = getEffectiveStock(item.product_id, item.stock_qty);
      if (effStock !== null && item.base_quantity > effStock) {
        setError(`Insufficient stock for ${item.product_name}. Available: ${effStock} ${item.product_base_unit || 'units'}`);
        return;
      }
    }

    setSaving(true);
    setError('');

    try {
      const newItems = items.map((item, idx) => ({
        product_id: item.product_id,
        quantity: item.quantity,
        unit_price: item.unit_price,
        cost_price: item.cost_price || 0,
        discount_percent: item.discount_percent || 0,
        unit_name: item.selected_unit?.unit_name || null,
        unit_conversion_factor: item.selected_unit?.conversion_factor?.toString() || null,
        base_quantity: item.base_quantity,
        sort_order: idx,
      }));

      const newData = {
        customer_id: form.customer_id,
        invoice_date: form.invoice_date,
        due_date: form.due_date || null,
        notes: form.notes || null,
        items: newItems,
      };

      const { data, error: rpcError } = await supabase.rpc('edit_invoice', {
        p_invoice_id: invoice.id,
        p_new_data: newData,
        p_reason: editReason || null,
        p_edited_by: 'Current User',
      });

      if (rpcError) throw new Error(rpcError.message);

      const res = data as any;
      if (!res.success) throw new Error(res.error || 'Failed to edit invoice');

      toast({ title: 'Success', description: `Invoice updated — old total: ${formatCurrency(Number(res.old_total))}, new total: ${formatCurrency(Number(res.new_total))}` });
      onSaved();
    } catch (err: any) {
      setError(err.message || 'Failed to update invoice');
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-3xl shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border sticky top-0 bg-white z-10">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold">Edit Invoice {invoice.invoice_number}</h2>
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${isDraft ? 'bg-gray-100 text-gray-600' : isPaid ? 'bg-green-100 text-green-700' : isPartial ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'}`}>
              {invoice.status.replace('_', ' ')}
            </span>
            {isPos && <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-purple-100 text-purple-700">POS</span>}
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>

        <form onSubmit={handleSave} className="p-6 space-y-4">
          {error && <div className="p-3 bg-red-50 text-red-600 rounded-lg text-sm">{error}</div>}

          {!isDraft && hasChanges && (
            <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg flex gap-2 text-sm text-blue-800">
              <Info className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium mb-0.5">Full Edit Mode</p>
                <p className="text-xs">This invoice has accounting entries. Editing will reverse all old effects (stock, journal, payments) and re-apply them with the new values. The edit is recorded in the audit trail.</p>
              </div>
            </div>
          )}

          {/* Header fields */}
          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2">
              <label className="block text-xs font-medium mb-1">Customer *</label>
              <select
                required
                value={form.customer_id}
                onChange={e => setForm({ ...form, customer_id: e.target.value })}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              >
                {customers.map(c => <option key={c.id} value={c.id}>{c.name} ({c.code})</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-medium mb-1">Invoice Date</label>
                <input
                  type="date"
                  value={form.invoice_date}
                  onChange={e => setForm({ ...form, invoice_date: e.target.value })}
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Due Date</label>
                <input
                  type="date"
                  value={form.due_date}
                  onChange={e => setForm({ ...form, due_date: e.target.value })}
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                />
              </div>
            </div>
          </div>

          {/* Line Items */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium">Line Items</label>
              <span className="text-xs text-muted-foreground">{items.length} item{items.length !== 1 ? 's' : ''}</span>
            </div>
            <ProductSearchInput
              onSelect={addProductToItems}
              showStock
              placeholder="Search and add products..."
              className="mb-3"
            />
            {loadingItems ? (
              <div className="p-8 text-center text-sm text-muted-foreground">Loading items...</div>
            ) : items.length > 0 ? (
              <div className="border border-border rounded-lg overflow-hidden">
                <table className="w-full">
                  <thead className="bg-muted/40">
                    <tr>
                      <th className="text-left text-xs font-semibold text-muted-foreground px-3 py-2">Product</th>
                      <th className="text-right text-xs font-semibold text-muted-foreground px-3 py-2 w-20">Qty</th>
                      <th className="text-right text-xs font-semibold text-muted-foreground px-3 py-2 w-28">Price</th>
                      <th className="text-right text-xs font-semibold text-muted-foreground px-3 py-2 w-20">Disc %</th>
                      <th className="text-right text-xs font-semibold text-muted-foreground px-3 py-2 w-28">Total</th>
                      <th className="w-8"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {items.map((item, index) => (
                      <tr key={index} className={JSON.stringify(originalItems[index]) !== JSON.stringify(item) ? 'bg-blue-50/40' : ''}>
                        <td className="px-3 py-2">
                          <p className="text-sm font-medium text-foreground">{item.product_name}</p>
                          <p className="text-[10px] text-muted-foreground">{item.product_sku}</p>
                          {item.stock_qty !== null && (() => {
                            const restorable = originalQtyMap[item.product_id] || 0;
                            const effStock = (item.stock_qty ?? 0) + restorable;
                            const isRestored = restorable > 0 && item.stock_qty === 0;
                            const isPartialRestore = restorable > 0 && item.stock_qty > 0;
                            return (
                              <p className={`text-[10px] font-medium ${effStock > 0 ? 'text-green-600' : 'text-red-500'}`}>
                                {effStock} {item.product_base_unit || 'units'} available
                                {isRestored && ` (from this invoice)`}
                                {isPartialRestore && ` (incl. ${restorable} from this invoice)`}
                              </p>
                            );
                          })()}
                          {item.available_units && item.selected_unit && (
                            <select
                              value={item.selected_unit.id}
                              onChange={e => {
                                const unit = item.available_units?.find(u => u.id === e.target.value);
                                if (unit) updateItem(index, 'selected_unit', unit);
                              }}
                              className="mt-1 w-full border border-blue-200 bg-blue-50 text-blue-700 rounded px-2 py-1 text-xs focus:outline-none"
                            >
                              {item.available_units.map(u => <option key={u.id} value={u.id}>{u.unit_name} - {formatCurrency(u.price)}</option>)}
                            </select>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <input type="number" min="1" value={item.quantity}
                            onChange={e => updateItem(index, 'quantity', e.target.value)}
                            className="w-full border border-border rounded px-2 py-1 text-sm text-right focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
                        </td>
                        <td className="px-3 py-2">
                          <input type="number" min="0" step="0.01" value={item.unit_price}
                            onChange={e => updateItem(index, 'unit_price', e.target.value)}
                            className="w-full border border-border rounded px-2 py-1 text-sm text-right focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
                        </td>
                        <td className="px-3 py-2">
                          <input type="number" min="0" max="100" step="0.5" value={item.discount_percent || 0}
                            onChange={e => updateItem(index, 'discount_percent', e.target.value)}
                            className="w-full border border-border rounded px-2 py-1 text-sm text-right focus:outline-none focus:ring-2 focus:ring-blue-500/20" placeholder="0" />
                        </td>
                        <td className="px-3 py-2 text-right text-sm font-semibold">
                          {formatCurrency(item.subtotal)}
                          {(item.discount_percent || 0) > 0 && (
                            <p className="text-[10px] text-amber-600 line-through">{formatCurrency(item.quantity * item.unit_price)}</p>
                          )}
                        </td>
                        <td className="px-2 py-2">
                          <button type="button" onClick={() => removeItem(index)} className="text-red-500 hover:text-red-600">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-8 text-center text-sm text-muted-foreground border border-border rounded-lg">No items — search and add products above</div>
            )}
          </div>

          {/* Total */}
          <div className="flex justify-end bg-muted/30 rounded-lg p-3">
            <div className="text-right">
              <p className="text-xs text-muted-foreground">New Subtotal</p>
              <p className="text-lg font-bold text-foreground">{formatCurrency(subtotal)}</p>
              {subtotal !== Number(invoice.total_amount) && (
                <p className="text-[10px] text-blue-600">Was: {formatCurrency(Number(invoice.total_amount))}</p>
              )}
            </div>
          </div>

          {/* Edit reason for non-draft invoices */}
          {showReason && (
            <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <label className="block text-xs font-medium mb-1 text-blue-800">
                Reason for Edit <span className="text-red-500">*</span>
              </label>
              <textarea
                value={editReason}
                onChange={e => setEditReason(e.target.value)}
                rows={2}
                placeholder="Why is this invoice being edited? (e.g. 'Wrong price entered', 'Product added by mistake')"
                className="w-full border border-blue-300 bg-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            </div>
          )}

          {/* Notes */}
          <div>
            <label className="block text-xs font-medium mb-1">Notes</label>
            <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2}
              className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              placeholder="Additional notes..." />
          </div>

          <div className="flex items-center justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 border border-border rounded-lg text-sm hover:bg-muted transition">Cancel</button>
            <button type="submit" disabled={saving || !hasChanges} className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold transition disabled:opacity-60">
              <Save className="w-4 h-4" />
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
