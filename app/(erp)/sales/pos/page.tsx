'use client';

import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { formatCurrency } from '@/lib/format';
import { toast } from '@/hooks/use-toast';
import { Search, Plus, Minus, Trash2, ShoppingCart, CreditCard, Banknote, Smartphone, CircleCheck as CheckCircle2, X, Camera, UserPlus, Filter, Wallet, Maximize2, Minimize2, ArrowRight, ArrowLeft, Receipt, History, Eye, EyeOff, ImagePlus, Package, Check, Clock, DollarSign } from 'lucide-react';
import type { ProductUnit } from '@/lib/types';
import { isMultiUnitEnabled, getDefaultSaleUnit, convertToBaseUnit } from '@/lib/unit-utils';

interface CartItem {
  id: string;
  name: string;
  sku: string;
  sale_price: number;
  cost_price: number;
  quantity: number;
  image_url?: string;
  inventory_item_id?: string;
  warehouse_id?: string;
  stock_available: number;
  selected_unit?: ProductUnit;
  unit_price: number;
  base_quantity: number;
  discount_percent: number;
}

type PaymentTerm = 'full' | 'partial' | 'credit';

interface ProductData {
  id: string;
  name: string;
  sku: string;
  sale_price: number;
  cost_price: number;
  image_url?: string;
  unit?: string;
  base_unit?: string;
  enable_multi_unit?: boolean;
  inventory_items: {
    id: string;
    warehouse_id: string;
    quantity_on_hand: number;
  }[];
  units?: ProductUnit[];
}

const WALK_IN_CUSTOMER_ID = '00000000-0000-0000-0000-000000000001';

export default function POSPage() {
  const [products, setProducts] = useState<ProductData[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<string>('');
  const [walkInCustomerId, setWalkInCustomerId] = useState<string>(WALK_IN_CUSTOMER_ID);
  const [customers, setCustomers] = useState<any[]>([]);
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [paymentMethods, setPaymentMethods] = useState<{ code: string; name: string }[]>([]);
  const [paymentTerm, setPaymentTerm] = useState<PaymentTerm>('full');
  const [partialAmount, setPartialAmount] = useState('');
  const [discount, setDiscount] = useState(0);
  const [extraDiscount, setExtraDiscount] = useState(0);
  const [orderComplete, setOrderComplete] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [lastInvoiceNumber, setLastInvoiceNumber] = useState('');
  const [unitSelectorProduct, setUnitSelectorProduct] = useState<ProductData | null>(null);
  const [showScanner, setShowScanner] = useState(false);
  const [showAddCustomer, setShowAddCustomer] = useState(false);
  const [brands, setBrands] = useState<{ id: string; name: string }[]>([]);
  const [selectedBrand, setSelectedBrand] = useState('');
  const [brandDropdownOpen, setBrandDropdownOpen] = useState(false);
  const [brandSearch, setBrandSearch] = useState('');
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [selectedCategory, setSelectedCategory] = useState('');
  const [categoryDropdownOpen, setCategoryDropdownOpen] = useState(false);
  const [categorySearch, setCategorySearch] = useState('');
  const [storeCreditBalance, setStoreCreditBalance] = useState(0);
  const [applyStoreCredit, setApplyStoreCredit] = useState(false);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    loadProducts('');
    loadCustomers();
    supabase.from('payment_methods').select('code, name').eq('is_active', true).order('sort_order')
      .then(({ data }) => { if (data && data.length > 0) setPaymentMethods(data); });
    supabase.from('brands').select('id, name').eq('is_active', true).order('name')
      .then(({ data }) => setBrands(data || []));
    supabase.from('categories').select('id, name').eq('is_active', true).order('name')
      .then(({ data }) => setCategories(data || []));
    supabase.from('app_settings').select('setting_value').eq('setting_key', 'product_defaults').maybeSingle()
      .then(({ data }) => {
        if (data?.setting_value?.default_image_url) setDefaultProductImage(data.setting_value.default_image_url);
      });
    // Fetch actual walk-in customer from DB
    supabase.from('customers').select('id, name').ilike('name', '%walk%').limit(1)
      .then(({ data }) => {
        if (data && data.length > 0) {
          setWalkInCustomerId(data[0].id);
          setSelectedCustomer(data[0].id);
        }
      });
  }, []);

  // Load store credit balance when customer changes
  useEffect(() => {
    if (!selectedCustomer || selectedCustomer === walkInCustomerId) {
      setStoreCreditBalance(0);
      setApplyStoreCredit(false);
      return;
    }
    supabase
      .from('customer_store_credits')
      .select('balance')
      .eq('customer_id', selectedCustomer)
      .eq('status', 'active')
      .then(({ data }) => {
        const total = (data || []).reduce((s: number, c: any) => s + Number(c.balance), 0);
        setStoreCreditBalance(total);
        if (total === 0) setApplyStoreCredit(false);
      });
  }, [selectedCustomer]);

  useEffect(() => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => loadProducts(search), 250);
    return () => { if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current); };
  }, [search, selectedBrand, selectedCategory]);

  async function loadProducts(q: string) {
    setLoading(true);
    let query = supabase
      .from('products')
      .select(`id, name, sku, sale_price, cost_price, image_url, unit, base_unit, enable_multi_unit,
        inventory_items(id, warehouse_id, quantity_on_hand),
        units:product_units(id, product_id, unit_name, unit_short, conversion_factor, is_base_unit, is_sale_unit, price, cost_price, is_active, sort_order)`, { count: 'exact' })
      .eq('is_active', true)
      .order('name');

    if (q.trim()) {
      query = query.or(`name.ilike.%${q.trim()}%,sku.ilike.%${q.trim()}%`);
    }
    if (selectedBrand) {
      query = query.eq('brand_id', selectedBrand);
    }
    if (selectedCategory) {
      query = query.eq('category_id', selectedCategory);
    }

    const { data } = await query.limit(60);
    setProducts((data || []) as ProductData[]);
    setLoading(false);
  }

  async function loadCustomers() {
    const { data } = await supabase
      .from('customers')
      .select('id, name, code, phone')
      .eq('is_active', true)
      .limit(100);
    setCustomers(data || []);
  }

  const filteredProducts = products;

  function getStockInBaseUnits(product: ProductData): number {
    return product.inventory_items?.reduce((s: number, i: any) => s + Number(i.quantity_on_hand), 0) || 0;
  }

  function addToCart(product: ProductData, selectedUnit?: ProductUnit) {
    const invItems = product.inventory_items || [];
    const bestInv = invItems.length > 0
      ? invItems.reduce((a, b) => (a.quantity_on_hand > b.quantity_on_hand ? a : b))
      : null;

    const stockAvailableInBase = bestInv ? bestInv.quantity_on_hand : 0;

    if (stockAvailableInBase <= 0) {
      toast({ title: 'Out of stock', description: `${product.name} is not available`, variant: 'destructive' });
      return;
    }

    const unit = selectedUnit || getDefaultSaleUnit(product as any);
    const unitPrice = unit.price || product.sale_price;

    setCart(prev => {
      const existingIndex = prev.findIndex(i => i.id === product.id && i.selected_unit?.id === unit.id);

      if (existingIndex >= 0) {
        const existing = prev[existingIndex];
        const newQty = existing.quantity + 1;
        const newBaseQty = convertToBaseUnit(newQty, unit);

        if (newBaseQty > stockAvailableInBase) {
          toast({ title: 'Stock limit', description: `Only ${stockAvailableInBase} base units available`, variant: 'destructive' });
          return prev;
        }
        const updated = [...prev];
        updated[existingIndex] = { ...existing, quantity: newQty, base_quantity: newBaseQty };
        return updated;
      }

      return [...prev, {
        id: product.id,
        name: product.name,
        sku: product.sku,
        sale_price: unitPrice,
        cost_price: unit.cost_price || product.cost_price || 0,
        quantity: 1,
        image_url: product.image_url,
        inventory_item_id: bestInv?.id,
        warehouse_id: bestInv?.warehouse_id,
        stock_available: stockAvailableInBase,
        selected_unit: unit,
        unit_price: unitPrice,
        base_quantity: convertToBaseUnit(1, unit),
        discount_percent: 0,
      }];
    });

    setUnitSelectorProduct(null);
  }

  function handleProductClick(product: ProductData) {
    if (isMultiUnitEnabled(product as any)) {
      setUnitSelectorProduct(product);
    } else {
      addToCart(product);
    }
  }

  function updateQty(id: string, unitId: string | undefined, delta: number) {
    setCart(prev => prev.map(i => {
      if (i.id !== id || i.selected_unit?.id !== unitId) return i;
      const newQty = Math.max(0, i.quantity + delta);
      const newBaseQty = i.selected_unit ? convertToBaseUnit(newQty, i.selected_unit) : newQty;
      if (newBaseQty > i.stock_available) {
        toast({ title: 'Stock limit', description: `Only ${i.stock_available} base units available`, variant: 'destructive' });
        return i;
      }
      return { ...i, quantity: newQty, base_quantity: newBaseQty };
    }).filter(i => i.quantity > 0));
  }

  function removeFromCart(id: string, unitId?: string) {
    setCart(prev => prev.filter(i => !(i.id === id && (unitId ? i.selected_unit?.id === unitId : true))));
  }

  function updateCartPrice(id: string, unitId: string | undefined, newPrice: number) {
    setCart(prev => prev.map(i =>
      (i.id === id && i.selected_unit?.id === unitId) ? { ...i, unit_price: newPrice } : i
    ));
  }

  function updateCartItemDiscount(id: string, unitId: string | undefined, disc: number) {
    const clamped = Math.min(100, Math.max(0, disc));
    setCart(prev => prev.map(i =>
      (i.id === id && i.selected_unit?.id === unitId) ? { ...i, discount_percent: clamped } : i
    ));
  }

  function updateCartQuantity(id: string, unitId: string | undefined, newQty: number) {
    if (isNaN(newQty) || newQty < 0) return;
    setCart(prev => prev.map(i => {
      if (i.id !== id || (unitId && i.selected_unit?.id !== unitId)) return i;
      const baseQty = i.selected_unit ? convertToBaseUnit(newQty, i.selected_unit) : newQty;
      if (baseQty > i.stock_available) {
        toast({ title: 'Stock limit', description: `Only ${i.stock_available} ${i.selected_unit ? 'base units' : 'units'} available`, variant: 'destructive' });
        const maxQty = i.selected_unit ? i.stock_available / i.selected_unit.conversion_factor : i.stock_available;
        return { ...i, quantity: maxQty, base_quantity: i.stock_available };
      }
      return { ...i, quantity: newQty, base_quantity: baseQty };
    }));
  }

  function reorderCart(fromIndex: number, toIndex: number) {
    setCart(prev => {
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  }

  const lineTotals = cart.map(i => i.unit_price * i.quantity * (1 - (i.discount_percent || 0) / 100));
  const subtotal = lineTotals.reduce((s, t) => s + t, 0);
  const itemDiscountTotal = cart.reduce((s, i, idx) => s + (i.unit_price * i.quantity - lineTotals[idx]), 0);
  const cartDiscountAmount = (subtotal * discount) / 100;
  const discountAmount = cartDiscountAmount;
  const total = Math.max(0, subtotal - cartDiscountAmount - extraDiscount);

  async function processOrder() {
    if (cart.length === 0) { toast({ title: 'Cart is empty', variant: 'destructive' }); return; }
    if (!selectedCustomer) { toast({ title: 'Please select a customer first', variant: 'destructive' }); return; }
    setProcessing(true);

    try {
      const { data: posNum } = await supabase.rpc('generate_pos_number');
      const invoiceNumber = posNum || `POS-${Date.now().toString().slice(-8)}`;
      setLastInvoiceNumber(invoiceNumber);

      const customerId = selectedCustomer;
      const creditToApply = applyStoreCredit ? Math.min(storeCreditBalance, total) : 0;

      // Determine amount paid based on payment term
      let amountPaid = 0;
      let invoiceStatus = 'draft';
      if (paymentTerm === 'full') {
        amountPaid = total;
        invoiceStatus = creditToApply > 0 && (total - creditToApply) > 0 ? 'partially_paid' : 'paid';
      } else if (paymentTerm === 'partial') {
        amountPaid = parseFloat(partialAmount) || 0;
        if (amountPaid <= 0) {
          toast({ title: 'Invalid amount', description: 'Please enter a partial payment amount', variant: 'destructive' });
          setProcessing(false);
          return;
        }
        if (amountPaid >= total) {
          toast({ title: 'Invalid amount', description: 'Partial payment must be less than total. Use Full Payment.', variant: 'destructive' });
          setProcessing(false);
          return;
        }
        invoiceStatus = 'partially_paid';
      } else {
        // credit — no payment now
        amountPaid = 0;
        invoiceStatus = 'sent';
      }

      const cashToPay = paymentTerm === 'full' ? (total - creditToApply) : (paymentTerm === 'partial' ? amountPaid : 0);

      const { data: invoice, error: invError } = await supabase
        .from('invoices')
        .insert({
          invoice_number: invoiceNumber,
          customer_id: customerId,
          invoice_date: new Date().toISOString().split('T')[0],
          subtotal: subtotal + itemDiscountTotal,
          discount_amount: cartDiscountAmount + itemDiscountTotal,
          extra_discount: extraDiscount,
          tax_amount: 0,
          total_amount: total,
          amount_paid: paymentTerm === 'full' ? total : (paymentTerm === 'partial' ? amountPaid : 0),
          status: invoiceStatus,
          is_pos: true,
        })
        .select()
        .single();

      if (invError) throw invError;
      if (!invoice) throw new Error('Invoice not created');

      const invoiceItems = cart.map(item => ({
        invoice_id: invoice.id,
        product_id: item.id,
        quantity: item.quantity,
        unit_price: item.unit_price,
        cost_price: item.cost_price || 0,
        discount_percent: item.discount_percent || 0,
        tax_rate: 0,
        subtotal: item.quantity * item.unit_price * (1 - (item.discount_percent || 0) / 100),
        unit_name: item.selected_unit?.unit_name,
        unit_conversion_factor: item.selected_unit?.conversion_factor,
        base_quantity: item.base_quantity,
      }));

      const { error: itemsError } = await supabase.from('invoice_items').insert(invoiceItems);
      if (itemsError) throw itemsError;

      // Record cost price history snapshot for each item at time of sale
      const costHistoryRecords = cart.map(item => {
        const unitName = item.selected_unit?.unit_name || 'pcs';
        const costPerUnit = item.cost_price || 0;
        const totalCostAdded = costPerUnit * item.quantity;
        return {
          product_id: item.id,
          product_name: item.name,
          product_sku: item.sku || '',
          invoice_id: invoice.id,
          unit: unitName,
          quantity: item.quantity,
          unit_price: item.unit_price,
          cost_price_per_qty: costPerUnit,
          cost_price_for_added_qty: totalCostAdded,
          total_cost_price_single: costPerUnit,
          total_cost_price_added: totalCostAdded,
        };
      });
      if (costHistoryRecords.length > 0) {
        await supabase.from('cost_price_history').insert(costHistoryRecords);
      }

      // Stock deduction is handled by the DB trigger on invoice_items INSERT

      // Record payment: if store credit is applied, record the cash/card portion separately
      if (paymentTerm === 'credit') {
        // On credit — no payment to record
      } else if (creditToApply > 0) {
        // Redeem store credit
        const { data: activeCredits } = await supabase
          .from('customer_store_credits')
          .select('id, balance')
          .eq('customer_id', customerId)
          .eq('status', 'active')
          .order('created_at', { ascending: true });

        let remainingToRedeem = creditToApply;
        for (const credit of (activeCredits || [])) {
          if (remainingToRedeem <= 0) break;
          const redeemAmount = Math.min(Number(credit.balance), remainingToRedeem);
          await supabase.from('store_credit_redemptions').insert({
            store_credit_id: credit.id,
            customer_id: customerId,
            invoice_id: invoice.id,
            amount: redeemAmount,
            notes: `Redeemed for ${invoiceNumber}`,
          });
          remainingToRedeem -= redeemAmount;
        }

        // Record store credit as a payment
        const { data: scPayNum } = await supabase.rpc('generate_payment_number');
        const { error: creditPayError } = await supabase.from('payments').insert({
          payment_number: `PAY-SC-${(scPayNum || '').replace('PAY-', '')}`,
          payment_type: 'received',
          reference_type: 'invoice',
          reference_id: invoice.id,
          customer_id: customerId,
          amount: creditToApply,
          payment_method: 'store_credit',
          payment_date: new Date().toISOString().split('T')[0],
          notes: `Store credit redeemed for ${invoiceNumber}`,
        });
        if (creditPayError) console.error('Store credit payment record error:', creditPayError.message);
      }

      // Record cash/card payment for the remaining amount
      if (cashToPay > 0) {
        const { data: posPayNum } = await supabase.rpc('generate_payment_number');
        const { error: payError } = await supabase.from('payments').insert({
          payment_number: posPayNum || `PAY-${Date.now().toString().slice(-6)}`,
          payment_type: 'received',
          reference_type: 'invoice',
          reference_id: invoice.id,
          customer_id: customerId,
          amount: cashToPay,
          payment_method: paymentMethod,
          payment_date: new Date().toISOString().split('T')[0],
          notes: creditToApply > 0 ? `POS sale (partial store credit: ${formatCurrency(creditToApply)})` : 'POS sale',
        });
        if (payError) console.error('Payment record error:', payError.message);

        const { data: custData } = await supabase
          .from('customers')
          .select('total_purchases')
          .eq('id', customerId)
          .single();
        if (custData) {
          await supabase
            .from('customers')
            .update({ total_purchases: (custData.total_purchases || 0) + total })
            .eq('id', customerId);
        }
      }

      setCart([]);
      setDiscount(0);
      setExtraDiscount(0);
      setSelectedCustomer(walkInCustomerId);
      setStoreCreditBalance(0);
      setApplyStoreCredit(false);
      setPaymentTerm('full');
      setPartialAmount('');
      setShowCheckout(false);
      setAmountPaid('');
      setCartTab('items');
      setOrderComplete(true);
      toast({ title: 'Success', description: `Order ${invoiceNumber} completed successfully` });
      loadProducts(search);
    } catch (error: any) {
      console.error('POS error:', error);
      toast({ title: 'Error', description: error.message || 'Failed to process order', variant: 'destructive' });
    }

    setProcessing(false);
    setTimeout(() => setOrderComplete(false), 4000);
  }

  const paymentMethodIcons: Record<string, any> = {
    cash: Banknote,
    bank_transfer: CreditCard,
    card: CreditCard,
    mobile_banking: Smartphone,
    cheque: CreditCard,
    other: Banknote,
  };
  const paymentMethodColors: Record<string, string> = {
    cash: 'text-green-600 bg-green-50 border-green-200',
    bank_transfer: 'text-blue-600 bg-blue-50 border-blue-200',
    card: 'text-indigo-600 bg-indigo-50 border-indigo-200',
    mobile_banking: 'text-pink-600 bg-pink-50 border-pink-200',
    cheque: 'text-amber-600 bg-amber-50 border-amber-200',
    other: 'text-gray-600 bg-gray-50 border-gray-200',
  };
  const displayMethods = paymentMethods.length > 0 ? paymentMethods : [
    { code: 'cash', name: 'Cash' },
    { code: 'card', name: 'Card' },
    { code: 'mobile_banking', name: 'Mobile Banking' },
  ];

  const [showMobileCart, setShowMobileCart] = useState(false);
  const [cartMaximized, setCartMaximized] = useState(false);
  const [cartTab, setCartTab] = useState<'items' | 'cost'>('items');
  const [showCheckout, setShowCheckout] = useState(false);
  const [amountPaid, setAmountPaid] = useState('');
  const [defaultProductImage, setDefaultProductImage] = useState('');
  const [showImageModal, setShowImageModal] = useState(false);
  const [imageModalProduct, setImageModalProduct] = useState<ProductData | null>(null);
  const [imageModalUrl, setImageModalUrl] = useState('');
  const [imageModalIsDefault, setImageModalIsDefault] = useState(false);
  const [customerSearch, setCustomerSearch] = useState('');
  const [customerDropdownOpen, setCustomerDropdownOpen] = useState(false);
  const [showCostPrice, setShowCostPrice] = useState<string | null>(null);
  const [draggedItem, setDraggedItem] = useState<number | null>(null);
  const [dragOverItem, setDragOverItem] = useState<number | null>(null);

  useEffect(() => {
    if (!customerDropdownOpen) return;
    const handler = () => setCustomerDropdownOpen(false);
    setTimeout(() => window.addEventListener('click', handler), 0);
    return () => window.removeEventListener('click', handler);
  }, [customerDropdownOpen]);

  return (
    <div className="flex flex-col lg:flex-row lg:h-[calc(100vh-120px)] gap-4 animate-fade-in">
      {/* Mobile Cart Overlay */}
      {showMobileCart && (
        <div
          className="fixed inset-0 bg-black/40 z-40 lg:hidden"
          onClick={() => setShowMobileCart(false)}
        />
      )}
      {/* Maximized Cart Backdrop (desktop) */}
      {cartMaximized && (
        <div
          className="fixed inset-0 bg-black/40 z-[90] hidden lg:block"
          onClick={() => setCartMaximized(false)}
        />
      )}

      {/* Left panel — mobile: natural scroll, desktop: flex-col with overflow */}
      <div className="flex-1 flex flex-col min-w-0 lg:overflow-hidden">
        {/* Controls row */}
        <div className="flex flex-col gap-2 mb-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search products by name or SKU..."
              className="w-full pl-10 pr-4 py-2.5 border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 bg-white"
            />
          </div>
          {/* Brand filter */}
          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => setBrandDropdownOpen(!brandDropdownOpen)}
              className={`flex items-center gap-1.5 border rounded-xl px-3 py-2.5 text-sm bg-white hover:border-blue-300 focus:outline-none focus:border-blue-500 transition whitespace-nowrap ${
                selectedBrand ? 'border-blue-500 text-blue-600' : 'border-border text-muted-foreground'
              }`}
              title="Filter by brand"
            >
              <Filter className="w-3.5 h-3.5" />
              <span className="max-w-[100px] truncate">{selectedBrand ? brands.find(b => b.id === selectedBrand)?.name : 'All Brands'}</span>
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
              <div className="absolute top-full right-0 mt-1 bg-white border border-border rounded-lg shadow-lg z-50 w-56 overflow-hidden">
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
                  {(brandSearch.trim() ? brands.filter(b => b.name.toLowerCase().includes(brandSearch.trim().toLowerCase())) : brands).map(b => (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => { setSelectedBrand(b.id); setBrandDropdownOpen(false); setBrandSearch(''); }}
                      className={`w-full flex items-center px-3 py-2 text-sm hover:bg-blue-50 transition text-left ${selectedBrand === b.id ? 'bg-blue-50 text-blue-600' : 'text-foreground'}`}
                    >
                      {b.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          {/* Category filter */}
          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => setCategoryDropdownOpen(!categoryDropdownOpen)}
              className={`flex items-center gap-1.5 border rounded-lg px-3 py-2.5 text-sm bg-white hover:border-blue-300 focus:outline-none focus:border-blue-500 transition whitespace-nowrap ${
                selectedCategory ? 'border-blue-500 text-blue-600' : 'border-border text-muted-foreground'
              }`}
              title="Filter by category"
            >
              <Filter className="w-3.5 h-3.5" />
              <span className="max-w-[100px] truncate">{selectedCategory ? categories.find(c => c.id === selectedCategory)?.name : 'All Categories'}</span>
              {selectedCategory && (
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => { e.stopPropagation(); setSelectedCategory(''); setCategorySearch(''); }}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); setSelectedCategory(''); setCategorySearch(''); } }}
                  className="ml-0.5 hover:text-red-500"
                >
                  <X className="w-3 h-3" />
                </span>
              )}
            </button>
            {categoryDropdownOpen && (
              <div className="absolute top-full right-0 mt-1 bg-white border border-border rounded-lg shadow-lg z-50 w-56 overflow-hidden">
                <div className="p-2 border-b border-border">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                    <input
                      type="text"
                      value={categorySearch}
                      onChange={e => setCategorySearch(e.target.value)}
                      placeholder="Search categories..."
                      className="w-full pl-8 pr-3 py-1.5 text-sm border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500"
                      autoFocus
                    />
                  </div>
                </div>
                <div className="max-h-48 overflow-y-auto">
                  <button
                    type="button"
                    onClick={() => { setSelectedCategory(''); setCategoryDropdownOpen(false); setCategorySearch(''); }}
                    className={`w-full flex items-center px-3 py-2 text-sm hover:bg-blue-50 transition text-left ${!selectedCategory ? 'bg-blue-50 text-blue-600' : 'text-muted-foreground'}`}
                  >
                    All Categories
                  </button>
                  {(categorySearch.trim() ? categories.filter(c => c.name.toLowerCase().includes(categorySearch.trim().toLowerCase())) : categories).map(c => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => { setSelectedCategory(c.id); setCategoryDropdownOpen(false); setCategorySearch(''); }}
                      className={`w-full flex items-center px-3 py-2 text-sm hover:bg-blue-50 transition text-left ${selectedCategory === c.id ? 'bg-blue-50 text-blue-600' : 'text-foreground'}`}
                    >
                      {c.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowScanner(true)}
              title="Scan Barcode"
              className="flex items-center justify-center gap-2 border border-border bg-white rounded-xl px-3 py-2.5 text-sm hover:bg-muted transition text-muted-foreground hover:text-foreground shrink-0"
            >
              <Camera className="w-4 h-4" />
              <span className="hidden sm:inline">Scan</span>
            </button>
            {/* Mobile cart toggle button */}
            <button
              onClick={() => setShowMobileCart(true)}
              className="lg:hidden flex items-center justify-center gap-2 bg-blue-600 text-white rounded-xl px-3 py-2.5 relative"
            >
              <ShoppingCart className="w-4 h-4" />
              {cart.length > 0 && (
                <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                  {cart.length}
                </span>
              )}
            </button>
          </div>
          <div className="flex items-center gap-2 relative">
            {/* Searchable Customer Selector */}
            <div className="flex-1 sm:flex-none relative">
              <button
                onClick={(e) => { e.stopPropagation(); setCustomerDropdownOpen(!customerDropdownOpen); }}
                className="flex items-center gap-2 border border-border rounded-xl px-3 py-2.5 text-sm bg-white hover:bg-muted/50 transition sm:min-w-[200px] w-full"
              >
                <span className="text-muted-foreground shrink-0"><UserPlus className="w-3.5 h-3.5" /></span>
                <span className="flex-1 text-left truncate">
                  {selectedCustomer
                    ? (customers.find(c => c.id === selectedCustomer)?.name || 'Walk-in Customer')
                    : 'Select Customer'}
                </span>
                <span className="text-xs text-muted-foreground shrink-0">▾</span>
              </button>
              {customerDropdownOpen && (
                <div className="absolute top-full mt-1 left-0 right-0 sm:w-72 bg-white border border-border rounded-xl shadow-lg z-50 overflow-hidden" onClick={(e) => e.stopPropagation()}>
                  <div className="p-2 border-b border-border">
                    <div className="relative">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                      <input
                        type="text"
                        value={customerSearch}
                        onChange={e => setCustomerSearch(e.target.value)}
                        placeholder="Search customers..."
                        autoFocus
                        className="w-full pl-8 pr-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:border-blue-400"
                      />
                    </div>
                  </div>
                  <div className="max-h-60 overflow-y-auto">
                    <button
                      type="button"
                      onClick={() => { setSelectedCustomer(walkInCustomerId); setCustomerDropdownOpen(false); setCustomerSearch(''); }}
                      className={`w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-blue-50 transition text-left ${selectedCustomer === walkInCustomerId ? 'bg-blue-50 text-blue-600' : 'text-foreground'}`}
                    >
                      <span>Walk-in Customer</span>
                      <span className="text-[10px] text-muted-foreground">CUST-272756</span>
                    </button>
                    {(customerSearch.trim()
                      ? customers.filter(c => c.name.toLowerCase().includes(customerSearch.trim().toLowerCase()) || (c.code || '').toLowerCase().includes(customerSearch.trim().toLowerCase()) || (c.phone || '').includes(customerSearch.trim()))
                      : customers
                    ).map(c => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => { setSelectedCustomer(c.id); setCustomerDropdownOpen(false); setCustomerSearch(''); }}
                        className={`w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-blue-50 transition text-left ${selectedCustomer === c.id ? 'bg-blue-50 text-blue-600' : 'text-foreground'}`}
                      >
                        <span className="truncate">{c.name}</span>
                        <span className="text-[10px] text-muted-foreground shrink-0 ml-2">{c.code}</span>
                      </button>
                    ))}
                    {customerSearch.trim() && customers.filter(c => c.name.toLowerCase().includes(customerSearch.trim().toLowerCase())).length === 0 && (
                      <div className="px-3 py-4 text-center text-xs text-muted-foreground">No customers found</div>
                    )}
                  </div>
                </div>
              )}
            </div>
            <button
              onClick={() => setShowAddCustomer(true)}
              title="Add New Customer"
              className="flex items-center justify-center gap-1.5 border border-blue-500 text-blue-600 rounded-xl px-3 py-2.5 text-sm hover:bg-blue-50 transition shrink-0"
            >
              <UserPlus className="w-4 h-4" />
              <span className="hidden sm:inline">New</span>
            </button>
          </div>
        </div>

        {/* Product grid — natural flow on mobile, overflow-y-auto on desktop */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 content-start pb-28 lg:pb-4 lg:flex-1 lg:min-h-0 lg:overflow-y-auto">
          {loading ? Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="bg-white rounded-xl border border-border p-3 animate-pulse"><div className="h-20 bg-muted rounded-lg mb-2" /><div className="h-3 bg-muted rounded mb-1" /><div className="h-3 bg-muted rounded w-2/3" /></div>
          )) : filteredProducts.length === 0 ? (
            <div className="col-span-full text-center py-12 text-muted-foreground">
              {search ? `No products found for "${search}"` : 'No products found'}
            </div>
          ) : filteredProducts.map(p => {
            const stock = getStockInBaseUnits(p);
            const multiUnit = isMultiUnitEnabled(p as any);
            const saleUnit = p.units?.find(u => u.is_sale_unit);
            const displayPrice = saleUnit?.price || p.sale_price;

            const inCart = cart.filter(c => c.id === p.id);
            const cartQty = inCart.reduce((sum, c) => sum + c.base_quantity, 0);
            const available = stock - cartQty;

            return (
              <div
                key={p.id}
                className="bg-white rounded-xl border border-border p-3 text-left hover:border-blue-400 hover:shadow-md transition-all group relative"
              >
                {/* group class stays for image-btn opacity; cost overlay uses a separate nested group below */}
                {/* Image change button (top-right, appears on hover) */}
                <button
                  onClick={(e) => { e.stopPropagation(); setImageModalProduct(p); setImageModalUrl(p.image_url || ''); setImageModalIsDefault(false); setShowImageModal(true); }}
                  className="absolute top-1.5 right-1.5 z-20 w-6 h-6 bg-white/90 rounded-full flex items-center justify-center text-muted-foreground hover:text-blue-600 hover:bg-blue-50 shadow-sm opacity-0 group-hover:opacity-100 transition"
                  title="Change product image"
                >
                  <ImagePlus className="w-3.5 h-3.5" />
                </button>

                <div onClick={() => available > 0 && handleProductClick(p)} className={available <= 0 ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}>
                  {multiUnit && (
                    <span className="absolute top-2 left-2 text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-medium z-10">Multi-unit</span>
                  )}
                  <div className="w-full h-20 bg-muted rounded-lg overflow-hidden mb-2 relative">
                    {p.image_url || defaultProductImage ? (
                      <img
                        src={p.image_url || defaultProductImage}
                        alt={p.name}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; (e.target as HTMLImageElement).nextElementSibling?.classList.remove('hidden'); }}
                      />
                    ) : null}
                    {(!p.image_url && !defaultProductImage) || true ? (
                      <div className={`w-full h-full flex items-center justify-center text-muted-foreground ${(p.image_url || defaultProductImage) ? 'hidden' : ''}`}>
                        <Package className="w-8 h-8 text-muted-foreground/40" />
                      </div>
                    ) : null}
                  </div>
                  <p className="text-xs font-semibold text-foreground leading-tight mb-0.5 line-clamp-2">{p.name}</p>
                  <p className="text-[10px] text-muted-foreground mb-1">{p.sku}</p>
                  <div className="flex items-center justify-between">
                    {/* Price area — hovering here reveals cost/profit tooltip */}
                    <div className="relative group/price">
                      <p className="text-sm font-bold text-blue-600 cursor-default">{formatCurrency(displayPrice)}</p>
                      {multiUnit && saleUnit && (
                        <p className="text-[9px] text-muted-foreground">per {saleUnit.unit_name}</p>
                      )}
                      {/* Cost price & profit tooltip — only visible on price area hover */}
                      <div
                        className="absolute bottom-full left-0 mb-1.5 z-30 min-w-[120px] bg-slate-800 text-white rounded-lg px-2.5 py-2 shadow-xl pointer-events-none opacity-0 group-hover/price:opacity-100 transition-opacity duration-150"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <p className="text-[9px] text-white/60 uppercase tracking-wide mb-0.5">Cost Price</p>
                        <p className="text-xs font-bold">{formatCurrency(p.cost_price || 0)}</p>
                        <p className="text-[10px] text-green-400 mt-0.5">
                          Profit: {formatCurrency((displayPrice || 0) - (p.cost_price || 0))}
                        </p>
                        {/* Small arrow */}
                        <div className="absolute top-full left-3 w-0 h-0 border-x-4 border-x-transparent border-t-4 border-t-slate-800" />
                      </div>
                    </div>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${available > 0 ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-500'}`}>{available}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Cart - Desktop Side Panel / Mobile Bottom Drawer / Maximized Overlay */}
      <div className={`
        ${cartMaximized ? 'fixed inset-0 z-[100]' : 'fixed lg:relative inset-x-0 bottom-0 lg:inset-auto'}
        ${cartMaximized ? 'w-full h-full lg:w-full lg:h-full' : 'lg:w-96'}
        flex flex-col bg-white
        ${cartMaximized ? 'rounded-none lg:rounded-none' : 'rounded-t-3xl lg:rounded-2xl'}
        border border-border shadow-sm overflow-hidden relative
        z-50
        transition-transform duration-300 ease-out lg:transition-none
        ${showMobileCart || cartMaximized ? 'translate-y-0' : 'translate-y-full lg:translate-y-0'}
        ${cartMaximized ? '' : 'h-[70vh] lg:h-auto lg:max-h-none'}
      `}>
        {/* Drag handle for mobile */}
        <div className="flex justify-center pt-2 pb-1 lg:hidden">
          <div className="w-10 h-1 bg-slate-200 rounded-full" />
        </div>

        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <h2 className="font-bold text-foreground flex items-center gap-2">
            <ShoppingCart className="w-4 h-4" />Cart ({cart.length})
          </h2>
          <div className="flex items-center gap-2">
            {cart.length > 0 && (
              <button onClick={() => setCart([])} className="text-xs text-red-500 hover:underline">Clear</button>
            )}
            <button
              onClick={() => setCartMaximized(v => !v)}
              className="hidden lg:flex text-muted-foreground hover:text-foreground p-1 transition"
              title={cartMaximized ? 'Minimize cart' : 'Maximize cart'}
            >
              {cartMaximized ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
            <button
              onClick={() => setShowMobileCart(false)}
              className="lg:hidden text-muted-foreground hover:text-foreground p-1"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Cart tabs: Items | Cost Price History */}
        {cart.length > 0 && (
          <div className="flex border-b border-border">
            <button
              onClick={() => setCartTab('items')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-semibold transition ${cartTab === 'items' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-muted-foreground hover:text-foreground'}`}
            >
              <ShoppingCart className="w-3.5 h-3.5" /> Items
            </button>
            <button
              onClick={() => setCartTab('cost')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-semibold transition ${cartTab === 'cost' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-muted-foreground hover:text-foreground'}`}
            >
              <History className="w-3.5 h-3.5" /> Cost Price
            </button>
          </div>
        )}

        <div className={`flex-1 overflow-y-auto p-3 space-y-2 ${cartMaximized ? 'lg:max-w-3xl lg:mx-auto lg:w-full' : ''}`}>
          {cart.length === 0 ? (
            <div className="flex-1 flex items-center justify-center text-center py-12">
              <div>
                <ShoppingCart className="w-12 h-12 text-muted-foreground/30 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">Cart is empty</p>
                <p className="text-xs text-muted-foreground">Click products to add</p>
              </div>
            </div>
          ) : cartTab === 'items' ? (
            cart.map((item, index) => (
            <div
              key={`${item.id}-${item.selected_unit?.id || 'default'}`}
              draggable
              onDragStart={() => setDraggedItem(index)}
              onDragOver={e => { e.preventDefault(); setDragOverItem(index); }}
              onDrop={() => { if (draggedItem !== null && draggedItem !== index) reorderCart(draggedItem, index); setDraggedItem(null); setDragOverItem(null); }}
              onDragEnd={() => { setDraggedItem(null); setDragOverItem(null); }}
              className={`flex items-center gap-2 bg-muted/30 rounded-xl p-2 transition-all ${draggedItem === index ? 'opacity-40' : ''} ${dragOverItem === index && draggedItem !== index ? 'border-2 border-blue-400' : ''} cursor-grab active:cursor-grabbing`}
            >
              <span className="text-muted-foreground/40 text-xs select-none shrink-0">⠿</span>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-semibold text-foreground truncate">{item.name}</p>
                <div className="flex items-center gap-1 mt-0.5">
                  <span className="text-[10px] text-muted-foreground">৳</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={item.unit_price}
                    onChange={e => updateCartPrice(item.id, item.selected_unit?.id, parseFloat(e.target.value) || 0)}
                    onClick={e => e.stopPropagation()}
                    className="w-14 text-[10px] border border-border rounded px-1 py-0.5 focus:outline-none focus:border-blue-400 text-right bg-white"
                  />
                  {item.selected_unit && <span className="text-[10px] text-muted-foreground">/ {item.selected_unit.unit_short || item.selected_unit.unit_name}</span>}
                  <span className="text-[10px] text-muted-foreground ml-1">Disc%</span>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.5"
                    value={item.discount_percent || 0}
                    onChange={e => updateCartItemDiscount(item.id, item.selected_unit?.id, parseFloat(e.target.value) || 0)}
                    onClick={e => e.stopPropagation()}
                    className="w-10 text-[10px] border border-amber-300 rounded px-1 py-0.5 focus:outline-none focus:border-amber-400 text-center bg-amber-50/30"
                    placeholder="0"
                  />
                </div>
                {(item.discount_percent || 0) > 0 && (
                  <p className="text-[9px] text-amber-600 mt-0.5">
                    {formatCurrency(item.unit_price * item.quantity)} → {formatCurrency(item.unit_price * item.quantity * (1 - (item.discount_percent || 0) / 100))}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => updateQty(item.id, item.selected_unit?.id, -1)} className="w-5 h-5 rounded-full bg-white border border-border flex items-center justify-center hover:bg-muted transition"><Minus className="w-2.5 h-2.5" /></button>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={item.quantity}
                  onChange={e => updateCartQuantity(item.id, item.selected_unit?.id, parseFloat(e.target.value) || 0)}
                  onClick={e => e.stopPropagation()}
                  className="w-16 text-xs font-bold border border-border rounded px-1 py-0.5 text-center focus:outline-none focus:border-blue-400 bg-white"
                />
                <button onClick={() => updateQty(item.id, item.selected_unit?.id, 1)} className="w-5 h-5 rounded-full bg-blue-500 text-white flex items-center justify-center hover:bg-blue-600 transition"><Plus className="w-2.5 h-2.5" /></button>
              </div>
              <button onClick={() => removeFromCart(item.id, item.selected_unit?.id || undefined)} className="text-muted-foreground hover:text-red-500 transition"><X className="w-3.5 h-3.5" /></button>
            </div>
            ))
          ) : (
            /* Cost Price History preview tab */
            <div className="space-y-2">
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-2.5 text-[11px] text-blue-800">
                Cost price snapshot that will be recorded when this sale is completed.
              </div>
              <div className="border border-border rounded-lg overflow-hidden">
                <table className="w-full">
                  <thead className="bg-muted/40">
                    <tr>
                      <th className="text-left text-[10px] font-semibold text-muted-foreground px-2 py-1.5">Product</th>
                      <th className="text-right text-[10px] font-semibold text-muted-foreground px-2 py-1.5">Qty</th>
                      <th className="text-right text-[10px] font-semibold text-muted-foreground px-2 py-1.5">Cost/Unit</th>
                      <th className="text-right text-[10px] font-semibold text-muted-foreground px-2 py-1.5">Total Cost</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {cart.map((item, i) => {
                      const costPerUnit = item.cost_price || 0;
                      const totalCost = costPerUnit * item.quantity;
                      return (
                        <tr key={i} className="hover:bg-muted/20">
                          <td className="px-2 py-1.5">
                            <p className="text-[11px] font-medium text-foreground truncate max-w-[100px]">{item.name}</p>
                            <p className="text-[9px] text-muted-foreground">{item.selected_unit?.unit_name || 'pcs'}</p>
                          </td>
                          <td className="px-2 py-1.5 text-right text-[11px] text-foreground">{item.quantity}</td>
                          <td className="px-2 py-1.5 text-right text-[11px] text-foreground">{formatCurrency(costPerUnit)}</td>
                          <td className="px-2 py-1.5 text-right text-[11px] font-semibold text-foreground">{formatCurrency(totalCost)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot className="bg-muted/30">
                    <tr>
                      <td colSpan={3} className="px-2 py-1.5 text-right text-[10px] font-semibold text-muted-foreground">Total Cost:</td>
                      <td className="px-2 py-1.5 text-right text-[11px] font-bold text-foreground">
                        {formatCurrency(cart.reduce((s, item) => s + (item.cost_price || 0) * item.quantity, 0))}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              <div className="flex justify-between text-[11px] pt-1">
                <span className="text-muted-foreground">Selling Total:</span>
                <span className="font-bold text-foreground">{formatCurrency(total)}</span>
              </div>
              <div className="flex justify-between text-[11px]">
                <span className="text-muted-foreground">Profit (est.):</span>
                <span className="font-bold text-green-600">{formatCurrency(total - cart.reduce((s, item) => s + (item.cost_price || 0) * item.quantity, 0))}</span>
              </div>
            </div>
          )}
        </div>

        {cart.length > 0 && (
          <div className="p-3 border-t border-border space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground flex-1">Cart Discount %</span>
              <input type="number" min="0" max="100" value={discount} onChange={e => setDiscount(Number(e.target.value))} className="w-16 border border-border rounded-lg px-2 py-1 text-sm text-center focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground flex-1">Extra Discount ৳</span>
              <input type="number" min="0" step="0.01" value={extraDiscount} onChange={e => setExtraDiscount(Number(e.target.value) || 0)} className="w-20 border border-border rounded-lg px-2 py-1 text-sm text-center focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
            </div>

            <div className="space-y-1 text-xs">
              <div className="flex justify-between text-muted-foreground"><span>Subtotal</span><span>{formatCurrency(subtotal + itemDiscountTotal)}</span></div>
              {itemDiscountTotal > 0 && <div className="flex justify-between text-amber-600"><span>Item Discounts</span><span>-{formatCurrency(itemDiscountTotal)}</span></div>}
              {discount > 0 && <div className="flex justify-between text-red-500"><span>Cart Discount ({discount}%)</span><span>-{formatCurrency(cartDiscountAmount)}</span></div>}
              {extraDiscount > 0 && <div className="flex justify-between text-red-500"><span>Extra Discount</span><span>-{formatCurrency(extraDiscount)}</span></div>}
              <div className="flex justify-between font-bold text-base text-foreground pt-1 border-t border-border"><span>Total</span><span>{formatCurrency(total)}</span></div>
            </div>

            <button
              onClick={() => setShowCheckout(true)}
              disabled={processing || !selectedCustomer}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-xl transition disabled:opacity-60 text-sm flex items-center justify-center gap-2"
            >
              <Receipt className="w-4 h-4" />
              {processing ? 'Processing...' : `Checkout · ${formatCurrency(total)}`}
            </button>
          </div>
        )}

        {orderComplete && (
          <div className="absolute inset-0 bg-white flex flex-col items-center justify-center rounded-2xl z-10">
            <CheckCircle2 className="w-16 h-16 text-green-500 mb-3" />
            <h3 className="font-bold text-lg text-foreground">Order Complete!</h3>
            <p className="text-sm text-muted-foreground mt-1">{lastInvoiceNumber}</p>
            <div className="flex items-center gap-2 mt-4">
              <button onClick={() => setOrderComplete(false)} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 transition">New Order</button>
            </div>
          </div>
        )}
      </div>

      {/* Checkout Modal */}
      {showCheckout && (
        <CheckoutModal
          total={total}
          subtotal={subtotal}
          discount={discount}
          discountAmount={discountAmount}
          extraDiscount={extraDiscount}
          itemDiscountTotal={itemDiscountTotal}
          cartDiscountAmount={cartDiscountAmount}
          paymentMethod={paymentMethod}
          setPaymentMethod={setPaymentMethod}
          displayMethods={displayMethods}
          paymentMethodIcons={paymentMethodIcons}
          paymentMethodColors={paymentMethodColors}
          amountPaid={amountPaid}
          setAmountPaid={setAmountPaid}
          processing={processing}
          onConfirm={processOrder}
          onClose={() => setShowCheckout(false)}
          storeCreditBalance={storeCreditBalance}
          applyStoreCredit={applyStoreCredit}
          setApplyStoreCredit={setApplyStoreCredit}
          selectedCustomer={selectedCustomer}
          customers={customers}
          cart={cart}
          paymentTerm={paymentTerm}
          setPaymentTerm={setPaymentTerm}
          partialAmount={partialAmount}
          setPartialAmount={setPartialAmount}
        />
      )}

      {showScanner && (
        <BarcodeScannerModal
          onDetected={(sku) => { setSearch(sku); setShowScanner(false); }}
          onClose={() => setShowScanner(false)}
        />
      )}

      {showAddCustomer && (
        <AddCustomerModal
          onClose={() => setShowAddCustomer(false)}
          onSaved={(id) => { loadCustomers(); setSelectedCustomer(id); }}
        />
      )}

      {unitSelectorProduct && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <div>
                <h3 className="font-bold text-sm">{unitSelectorProduct.name}</h3>
                <p className="text-xs text-muted-foreground">Select unit for this sale</p>
              </div>
              <button onClick={() => setUnitSelectorProduct(null)} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-4 space-y-2">
              {unitSelectorProduct.units?.filter(u => u.is_active).map(unit => (
                <button
                  key={unit.id}
                  onClick={() => addToCart(unitSelectorProduct, unit)}
                  className="w-full flex items-center justify-between p-3 border border-border rounded-xl hover:border-blue-400 hover:bg-blue-50/50 transition"
                >
                  <div className="text-left">
                    <p className="text-sm font-semibold">{unit.unit_name} {unit.unit_short && <span className="text-muted-foreground font-normal">({unit.unit_short})</span>}</p>
                    <p className="text-xs text-muted-foreground">
                      1 {unit.unit_name} = {unit.conversion_factor} {unitSelectorProduct.base_unit || 'base units'}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-blue-600">{formatCurrency(unit.price)}</p>
                    <p className="text-[10px] text-muted-foreground">per {unit.unit_short || unit.unit_name}</p>
                  </div>
                </button>
              ))}
              {(!unitSelectorProduct.units || unitSelectorProduct.units.filter(u => u.is_active).length === 0) && (
                <button
                  onClick={() => addToCart(unitSelectorProduct)}
                  className="w-full flex items-center justify-between p-3 border border-border rounded-xl hover:border-blue-400 hover:bg-blue-50/50 transition"
                >
                  <p className="text-sm font-semibold">{unitSelectorProduct.unit || 'Piece'}</p>
                  <p className="text-sm font-bold text-blue-600">{formatCurrency(unitSelectorProduct.sale_price)}</p>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Image Change Modal */}
      {showImageModal && imageModalProduct && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[110] p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <div>
                <h3 className="font-bold text-sm flex items-center gap-2"><ImagePlus className="w-4 h-4" /> Product Image</h3>
                <p className="text-xs text-muted-foreground truncate">{imageModalProduct.name}</p>
              </div>
              <button onClick={() => setShowImageModal(false)} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-5 space-y-4">
              {/* Current image preview */}
              <div className="w-full h-40 bg-muted rounded-xl overflow-hidden flex items-center justify-center">
                {imageModalUrl ? (
                  <img src={imageModalUrl} alt="Preview" className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                ) : (
                  <div className="flex flex-col items-center text-muted-foreground">
                    <Package className="w-12 h-12 text-muted-foreground/30 mb-2" />
                    <p className="text-xs">No image set</p>
                  </div>
                )}
              </div>

              {/* Image URL input */}
              <div>
                <label className="block text-xs font-semibold text-muted-foreground mb-1.5">IMAGE URL</label>
                <input
                  type="text"
                  value={imageModalUrl}
                  onChange={e => setImageModalUrl(e.target.value)}
                  placeholder="https://images.pexels.com/photos/..."
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                />
                <p className="text-[11px] text-muted-foreground mt-1">Paste an image URL (e.g. from Pexels)</p>
              </div>

              {/* Toggle: set as default for all products */}
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={imageModalIsDefault}
                  onChange={e => setImageModalIsDefault(e.target.checked)}
                  className="w-4 h-4 rounded border-border"
                />
                <span className="text-sm text-foreground">Set as default image for all products without images</span>
              </label>

              <div className="flex gap-2 pt-2">
                <button onClick={() => setShowImageModal(false)} className="flex-1 px-4 py-2 border border-border rounded-lg text-sm font-medium hover:bg-muted transition">Cancel</button>
                <button
                  onClick={async () => {
                    if (imageModalIsDefault) {
                      await supabase.from('app_settings').upsert({ setting_key: 'product_defaults', setting_value: { default_image_url: imageModalUrl } });
                      setDefaultProductImage(imageModalUrl);
                    } else if (imageModalProduct) {
                      await supabase.from('products').update({ image_url: imageModalUrl || null }).eq('id', imageModalProduct.id);
                      setProducts(prev => prev.map(p => p.id === imageModalProduct.id ? { ...p, image_url: imageModalUrl || undefined } : p));
                    }
                    setShowImageModal(false);
                    toast({ title: imageModalIsDefault ? 'Default image updated' : 'Product image updated' });
                  }}
                  className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold transition"
                >
                  Save Image
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function BarcodeScannerModal({ onDetected, onClose }: { onDetected: (sku: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState('');
  const [manualSku, setManualSku] = useState('');
  const [scanning, setScanning] = useState(false);
  const streamRef = useRef<MediaStream | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const supported = typeof window !== 'undefined' && 'BarcodeDetector' in window;

  useEffect(() => {
    if (!supported) return;
    async function startCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play();
          setScanning(true);
          const detector = new (window as any).BarcodeDetector({
            formats: ['code_128', 'code_39', 'ean_13', 'ean_8', 'qr_code'],
          });
          intervalRef.current = setInterval(async () => {
            if (!videoRef.current || videoRef.current.readyState < 2) return;
            try {
              const barcodes = await detector.detect(videoRef.current);
              if (barcodes.length > 0) {
                stopCamera();
                onDetected(barcodes[0].rawValue);
              }
            } catch (_) {}
          }, 300);
        }
      } catch (_) {
        setError('Camera access denied. Allow camera access or enter SKU manually.');
      }
    }
    startCamera();
    return () => stopCamera();
  }, []);

  function stopCamera() {
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
  }

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h3 className="font-bold text-sm flex items-center gap-2"><Camera className="w-4 h-4" />Scan Barcode</h3>
          <button onClick={() => { stopCamera(); onClose(); }} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-4 space-y-4">
          {supported && !error ? (
            <div className="relative">
              <video ref={videoRef} className="w-full rounded-xl bg-black aspect-video object-cover" muted playsInline />
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="w-48 h-28 border-2 border-blue-400 rounded-xl opacity-80" />
              </div>
              {scanning && <p className="text-xs text-center text-muted-foreground mt-2">Point camera at barcode to scan automatically</p>}
            </div>
          ) : (
            <div className="py-2">
              <p className="text-xs text-center text-muted-foreground">
                {error || 'Camera scanning not supported in this browser.'}
              </p>
            </div>
          )}
          <div className="space-y-1.5">
            <p className="text-xs text-muted-foreground">{supported && !error ? 'Or type SKU manually:' : 'Enter SKU manually:'}</p>
            <div className="flex gap-2">
              <input
                value={manualSku}
                onChange={e => setManualSku(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && manualSku.trim()) { stopCamera(); onDetected(manualSku.trim()); } }}
                placeholder="Product SKU..."
                autoFocus={!supported || !!error}
                className="flex-1 border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
              <button
                onClick={() => { if (manualSku.trim()) { stopCamera(); onDetected(manualSku.trim()); } }}
                disabled={!manualSku.trim()}
                className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold transition disabled:opacity-50"
              >
                Search
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function AddCustomerModal({ onClose, onSaved }: { onClose: () => void; onSaved: (id: string) => void }) {
  const [form, setForm] = useState({
    name: '',
    phone: '',
    email: '',
    address: '',
    type: 'retail' as 'retail' | 'contractor' | 'builder' | 'architect' | 'interior_designer' | 'corporate' | 'government',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { setError('Customer name is required'); return; }
    setSaving(true);
    setError('');

    const code = `CUST-${Date.now().toString().slice(-6)}`;
    const { data, error: insertError } = await supabase
      .from('customers')
      .insert({
        code,
        name: form.name.trim(),
        phone: form.phone || null,
        email: form.email || null,
        address: form.address || null,
        type: form.type,
        country: 'Bangladesh',
        is_active: true,
        credit_limit: 0,
        credit_days: 0,
        outstanding_balance: 0,
        total_purchases: 0,
        loyalty_points: 0,
        discount_percent: 0,
      })
      .select('id')
      .single();

    if (insertError) {
      setError(insertError.message);
      setSaving(false);
      return;
    }

    toast({ title: 'Success', description: 'Customer added successfully' });
    onSaved(data.id);
    onClose();
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-base font-bold flex items-center gap-2"><UserPlus className="w-4 h-4" />Add New Customer</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSave} className="p-4 space-y-3">
          {error && <div className="p-3 bg-red-50 text-red-600 rounded-lg text-sm">{error}</div>}
          <div>
            <label className="block text-xs font-medium mb-1">Customer Name *</label>
            <input
              required
              value={form.name}
              onChange={e => setForm({ ...form, name: e.target.value })}
              placeholder="Enter customer name..."
              className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">Phone</label>
              <input
                value={form.phone}
                onChange={e => setForm({ ...form, phone: e.target.value })}
                placeholder="Phone number..."
                className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Type</label>
              <select
                value={form.type}
                onChange={e => setForm({ ...form, type: e.target.value as any })}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none"
              >
                <option value="retail">Retail</option>
                <option value="contractor">Contractor</option>
                <option value="builder">Builder</option>
                <option value="architect">Architect</option>
                <option value="interior_designer">Interior Designer</option>
                <option value="corporate">Corporate</option>
                <option value="government">Government</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Email</label>
            <input
              type="email"
              value={form.email}
              onChange={e => setForm({ ...form, email: e.target.value })}
              placeholder="Email address..."
              className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Address</label>
            <textarea
              value={form.address}
              onChange={e => setForm({ ...form, address: e.target.value })}
              placeholder="Full address..."
              rows={2}
              className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 resize-none"
            />
          </div>
          <div className="flex gap-2 pt-2">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border border-border rounded-lg text-sm font-medium hover:bg-muted transition">Cancel</button>
            <button type="submit" disabled={saving} className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold transition disabled:opacity-50">{saving ? 'Saving...' : 'Add Customer'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function CheckoutModal({
  total, subtotal, discount, discountAmount, extraDiscount, itemDiscountTotal, cartDiscountAmount, paymentMethod, setPaymentMethod,
  displayMethods, paymentMethodIcons, paymentMethodColors,
  amountPaid, setAmountPaid, processing, onConfirm, onClose,
  storeCreditBalance, applyStoreCredit, setApplyStoreCredit, selectedCustomer, customers, cart,
  paymentTerm, setPaymentTerm, partialAmount, setPartialAmount,
}: {
  total: number; subtotal: number; discount: number; discountAmount: number; extraDiscount: number; itemDiscountTotal: number; cartDiscountAmount: number;
  paymentMethod: string; setPaymentMethod: (m: string) => void;
  displayMethods: any[]; paymentMethodIcons: Record<string, any>; paymentMethodColors: Record<string, string>;
  amountPaid: string; setAmountPaid: (v: string) => void;
  processing: boolean; onConfirm: () => void; onClose: () => void;
  storeCreditBalance: number; applyStoreCredit: boolean; setApplyStoreCredit: (v: boolean) => void;
  selectedCustomer: any; customers: any[]; cart: any[];
  paymentTerm: string; setPaymentTerm: (v: any) => void;
  partialAmount: string; setPartialAmount: (v: string) => void;
}) {
  const [step, setStep] = useState<'method' | 'confirm'>('method');
  const paid = parseFloat(amountPaid) || 0;
  const change = paid - total;
  const totalCost = cart.reduce((s, item) => s + (item.cost_price || 0) * item.quantity, 0);
  const profit = total - totalCost;
  const customerName = selectedCustomer ? (customers.find(c => c.id === selectedCustomer)?.name || 'Walk-in Customer') : 'Walk-in Customer';
  const partialNum = parseFloat(partialAmount) || 0;
  const isWalkIn = !selectedCustomer || selectedCustomer === '00000000-0000-0000-0000-000000000001';

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[110] p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <h2 className="text-base font-bold flex items-center gap-2">
            {step === 'method' ? <><CreditCard className="w-4 h-4" /> Select Payment Method</> : <><Receipt className="w-4 h-4" /> Confirm Charge</>}
          </h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4 overflow-y-auto">
          {/* Order summary */}
          <div className="bg-muted/30 rounded-xl p-3 space-y-1.5 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span className="font-medium">{formatCurrency(subtotal + itemDiscountTotal)}</span></div>
            {itemDiscountTotal > 0 && (
              <div className="flex justify-between text-amber-600"><span>Item Discounts</span><span>-{formatCurrency(itemDiscountTotal)}</span></div>
            )}
            {cartDiscountAmount > 0 && (
              <div className="flex justify-between text-red-600"><span>Cart Discount ({discount}%)</span><span>-{formatCurrency(cartDiscountAmount)}</span></div>
            )}
            {extraDiscount > 0 && (
              <div className="flex justify-between text-red-600"><span>Extra Discount</span><span>-{formatCurrency(extraDiscount)}</span></div>
            )}
            <div className="flex justify-between text-base font-bold pt-1 border-t border-border"><span>Total Due</span><span className="text-blue-600">{formatCurrency(total)}</span></div>
          </div>

          {step === 'method' ? (
            <>
              {/* Payment Terms */}
              <div>
                <label className="block text-xs font-semibold text-muted-foreground mb-2">PAYMENT TERMS</label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    onClick={() => setPaymentTerm('full')}
                    className={`flex flex-col items-center gap-1 px-2 py-2.5 rounded-xl border-2 text-xs font-medium transition ${paymentTerm === 'full' ? 'text-green-700 bg-green-50 border-green-600 ring-2 ring-green-500/10' : 'border-border text-muted-foreground hover:border-green-200 hover:bg-green-50/30'}`}
                  >
                    <CheckCircle2 className="w-4 h-4" /> Full
                    <span className="text-[10px] text-muted-foreground">Pay all now</span>
                  </button>
                  <button
                    onClick={() => setPaymentTerm('partial')}
                    disabled={isWalkIn}
                    className={`flex flex-col items-center gap-1 px-2 py-2.5 rounded-xl border-2 text-xs font-medium transition ${paymentTerm === 'partial' ? 'text-amber-700 bg-amber-50 border-amber-600 ring-2 ring-amber-500/10' : 'border-border text-muted-foreground hover:border-amber-200 hover:bg-amber-50/30'} ${isWalkIn ? 'opacity-40 cursor-not-allowed' : ''}`}
                  >
                    <DollarSign className="w-4 h-4" /> Partial
                    <span className="text-[10px] text-muted-foreground">Pay some now</span>
                  </button>
                  <button
                    onClick={() => setPaymentTerm('credit')}
                    disabled={isWalkIn}
                    className={`flex flex-col items-center gap-1 px-2 py-2.5 rounded-xl border-2 text-xs font-medium transition ${paymentTerm === 'credit' ? 'text-blue-700 bg-blue-50 border-blue-600 ring-2 ring-blue-500/10' : 'border-border text-muted-foreground hover:border-blue-200 hover:bg-blue-50/30'} ${isWalkIn ? 'opacity-40 cursor-not-allowed' : ''}`}
                  >
                    <Clock className="w-4 h-4" /> On Credit
                    <span className="text-[10px] text-muted-foreground">Pay later</span>
                  </button>
                </div>
                {isWalkIn && (paymentTerm === 'partial' || paymentTerm === 'credit') && (
                  <p className="text-[11px] text-amber-600 mt-1.5">Partial and credit terms require a selected customer. Walk-in customers must use full payment.</p>
                )}
              </div>

              {/* Partial payment amount input */}
              {paymentTerm === 'partial' && (
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground mb-1.5">PARTIAL PAYMENT AMOUNT</label>
                  <input
                    type="number"
                    min="0.01"
                    max={total - 0.01}
                    step="0.01"
                    value={partialAmount}
                    onChange={e => setPartialAmount(e.target.value)}
                    placeholder={`Enter amount (Max: ${formatCurrency(total)})`}
                    className="w-full border border-amber-300 bg-amber-50/30 rounded-lg px-3 py-2.5 text-base font-semibold focus:outline-none focus:ring-2 focus:ring-amber-500/20"
                  />
                  <p className="text-xs text-amber-700 mt-1 font-medium">
                    Balance Due After Payment: {formatCurrency(total - partialNum)}
                  </p>
                </div>
              )}

              {/* Payment method grid — only for full and partial terms */}
              {paymentTerm !== 'credit' && (
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground mb-2">PAYMENT METHOD</label>
                  <div className="grid grid-cols-2 gap-2">
                    {displayMethods.map(m => {
                      const Icon = paymentMethodIcons[m.code] || Banknote;
                      const color = paymentMethodColors[m.code] || 'text-gray-600 bg-gray-50 border-gray-200';
                      const selected = paymentMethod === m.code;
                      return (
                        <button
                          key={m.code}
                          onClick={() => setPaymentMethod(m.code)}
                          className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border-2 text-sm font-medium transition ${selected ? color + ' border-current ring-2 ring-current/10' : 'border-border text-muted-foreground hover:border-blue-200 hover:bg-muted/30'}`}
                        >
                          <Icon className="w-4 h-4" />{m.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Store credit option */}
              {storeCreditBalance > 0 && selectedCustomer && paymentTerm !== 'credit' && (
                <div className="flex items-center justify-between bg-amber-50 border border-amber-200 rounded-xl p-3">
                  <div>
                    <p className="text-xs font-semibold text-amber-800">Apply Store Credit</p>
                    <p className="text-[11px] text-amber-700">Balance: {formatCurrency(storeCreditBalance)}</p>
                  </div>
                  <button
                    onClick={() => setApplyStoreCredit(!applyStoreCredit)}
                    className={`w-10 h-5 rounded-full transition relative ${applyStoreCredit ? 'bg-amber-500' : 'bg-gray-300'}`}
                  >
                    <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${applyStoreCredit ? 'left-5' : 'left-0.5'}`} />
                  </button>
                </div>
              )}

              {/* Amount paid input — only for full and partial terms */}
              {paymentTerm !== 'credit' && (
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground mb-1.5">AMOUNT PAID</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={amountPaid}
                    onChange={e => setAmountPaid(e.target.value)}
                    placeholder={total.toFixed(2)}
                    className="w-full border border-border rounded-lg px-3 py-2.5 text-base font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  />
                  {paid > 0 && (
                    <p className={`text-xs mt-1 ${change >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                      {change >= 0 ? `Change: ${formatCurrency(change)}` : `Remaining: ${formatCurrency(-change)}`}
                    </p>
                  )}
                </div>
              )}
            </>
          ) : (
            /* Confirmation step */
            <div className="space-y-3">
              <div className="flex items-center justify-between p-3 bg-blue-50 rounded-xl">
                <div className="flex items-center gap-2">
                  {(() => {
                    const Icon = paymentMethodIcons[paymentMethod] || Banknote;
                    return <Icon className="w-5 h-5 text-blue-600" />;
                  })()}
                  <span className="text-sm font-semibold">{paymentTerm === 'credit' ? 'On Credit' : (displayMethods.find(m => m.code === paymentMethod)?.name || paymentMethod)}</span>
                </div>
                <button onClick={() => setStep('method')} className="text-xs text-blue-600 hover:underline">Change</button>
              </div>

              <div className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Customer</span><span className="font-medium truncate max-w-[180px]">{customerName}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Items</span><span className="font-medium">{cart.length}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Payment Term</span><span className="font-medium">{paymentTerm === 'full' ? 'Full Payment' : paymentTerm === 'partial' ? 'Partial Payment' : 'On Credit'}</span></div>
                {paymentTerm === 'full' && <div className="flex justify-between"><span className="text-muted-foreground">Amount Paid</span><span className="font-medium">{formatCurrency(paid || total)}</span></div>}
                {paymentTerm === 'partial' && <div className="flex justify-between"><span className="text-muted-foreground">Amount Paid</span><span className="font-medium">{formatCurrency(partialNum)}</span></div>}
                {paymentTerm === 'partial' && <div className="flex justify-between text-amber-600"><span className="text-muted-foreground">Balance Due</span><span className="font-medium">{formatCurrency(total - partialNum)}</span></div>}
                {paymentTerm === 'credit' && <div className="flex justify-between text-blue-600"><span className="text-muted-foreground">Balance Due</span><span className="font-medium">{formatCurrency(total)}</span></div>}
                {paymentTerm === 'full' && paid > 0 && change >= 0 && <div className="flex justify-between"><span className="text-muted-foreground">Change</span><span className="font-medium text-green-600">{formatCurrency(change)}</span></div>}
                {applyStoreCredit && storeCreditBalance > 0 && paymentTerm !== 'credit' && <div className="flex justify-between text-amber-700"><span>Store Credit Applied</span><span className="font-medium">{formatCurrency(Math.min(storeCreditBalance, total))}</span></div>}
              </div>

              <div className="bg-muted/30 rounded-xl p-3 space-y-1 text-xs">
                <div className="flex justify-between"><span className="text-muted-foreground">Cost Price (total)</span><span>{formatCurrency(totalCost)}</span></div>
                <div className="flex justify-between font-semibold"><span>Est. Profit</span><span className="text-green-600">{formatCurrency(profit)}</span></div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border flex gap-2 shrink-0">
          {step === 'method' ? (
            <>
              <button onClick={onClose} className="flex-1 px-4 py-2.5 border border-border rounded-lg text-sm font-medium hover:bg-muted transition">Cancel</button>
              <button
                onClick={() => setStep('confirm')}
                disabled={!paymentMethod && paymentTerm !== 'credit'}
                className="flex-1 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold transition disabled:opacity-50 flex items-center justify-center gap-1.5"
              >
                Next <ArrowRight className="w-4 h-4" />
              </button>
            </>
          ) : (
            <>
              <button onClick={() => setStep('method')} className="flex-1 px-4 py-2.5 border border-border rounded-lg text-sm font-medium hover:bg-muted transition flex items-center justify-center gap-1.5">
                <ArrowLeft className="w-4 h-4" /> Back
              </button>
              <button
                onClick={onConfirm}
                disabled={processing}
                className="flex-1 px-4 py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-bold transition disabled:opacity-50 flex items-center justify-center gap-1.5"
              >
                <CheckCircle2 className="w-4 h-4" /> {processing ? 'Processing...' : `Charge ${formatCurrency(paymentTerm === 'partial' ? partialNum : total)}`}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
