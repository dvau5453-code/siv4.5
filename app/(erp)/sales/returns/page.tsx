'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { formatCurrency, formatDate } from '@/lib/format';
import { toast } from '@/hooks/use-toast';
import { ArrowLeft, Search, RefreshCw, Plus, X, Package, FileText, Receipt, CreditCard, CircleCheck as CheckCircle, Clock, Eye, ArrowRightLeft, Building2, Banknote, Wallet, ExternalLink } from 'lucide-react';
import Link from 'next/link';
import type { Customer } from '@/lib/types';

interface Invoice {
  id: string;
  invoice_number: string;
  customer_id: string;
  customer_name?: string;
  status: string;
  invoice_date: string;
  total_amount: number;
  amount_paid: number;
  balance_due: number;
  customer?: { name: string; code: string };
}

interface InvoiceItem {
  id: string;
  invoice_id: string;
  product_id: string;
  product?: { name: string; sku: string; unit: string };
  quantity: number;
  unit_price: number;
  cost_price: number;
  subtotal: number;
  remaining_qty?: number;
}

interface SalesReturn {
  id: string;
  return_number: string;
  invoice_id: string;
  customer_id: string;
  total_refund_amount: number;
  refund_method: string;
  status: string;
  notes: string;
  created_at: string;
  journal_entry_id?: string;
  payment_id?: string;
  invoice?: { invoice_number: string };
  customer?: { name: string };
  items?: SalesReturnItem[];
}

interface SalesReturnItem {
  id: string;
  product_id: string;
  product?: { name: string; sku: string };
  quantity_returned: number;
  unit_price: number;
  cost_price: number;
  subtotal: number;
  reason: string;
}

interface PaymentMethod {
  id: string;
  name: string;
  code: string;
  is_cash: boolean;
  is_bank: boolean;
  account_id: string | null;
}

export default function SalesReturnsPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [returns, setReturns] = useState<SalesReturn[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [showViewModal, setShowViewModal] = useState(false);
  const [viewingReturn, setViewingReturn] = useState<SalesReturn | null>(null);

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    setLoading(true);
    const [invRes, returnsRes] = await Promise.all([
      supabase.from('invoices').select('*, customer:customers(name, code)').in('status', ['paid', 'partially_paid', 'sent']).order('invoice_date', { ascending: false }),
      supabase.from('sales_returns').select('*, invoice:invoices(invoice_number), customer:customers(name)').order('created_at', { ascending: false }),
    ]);

    setInvoices(invRes.data || []);
    setReturns(returnsRes.data || []);
    setLoading(false);
  }

  const filteredInvoices = invoices.filter(inv =>
    !search ||
    inv.invoice_number.toLowerCase().includes(search.toLowerCase()) ||
    inv.customer?.name?.toLowerCase().includes(search.toLowerCase())
  );

  const filteredReturns = returns.filter(r =>
    !search ||
    r.return_number.toLowerCase().includes(search.toLowerCase()) ||
    r.customer?.name?.toLowerCase().includes(search.toLowerCase())
  );

  async function handleViewReturn(ret: SalesReturn) {
    const { data: items } = await supabase
      .from('sales_return_items')
      .select('*, product:products(name, sku)')
      .eq('sales_return_id', ret.id);

    setViewingReturn({ ...ret, items: items || [] });
    setShowViewModal(true);
  }

  const totalRefundValue = returns.reduce((sum, r) => sum + Number(r.total_refund_amount), 0);

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/sales" className="w-8 h-8 flex items-center justify-center rounded-lg border border-border hover:bg-muted transition">
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Sales Returns</h1>
            <p className="text-muted-foreground text-sm mt-0.5">Process customer returns and refunds with proper accounting</p>
          </div>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-semibold transition"
        >
          <Plus className="w-4 h-4" />
          New Return
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="stat-card">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-blue-50 flex items-center justify-center">
              <Receipt className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Total Returns</p>
              <p className="text-lg font-bold text-foreground">{returns.length}</p>
            </div>
          </div>
        </div>
        <div className="stat-card">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-green-50 flex items-center justify-center">
              <CheckCircle className="w-5 h-5 text-green-600" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Completed</p>
              <p className="text-lg font-bold text-foreground">{returns.filter(r => r.status === 'completed').length}</p>
            </div>
          </div>
        </div>
        <div className="stat-card">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-purple-50 flex items-center justify-center">
              <CreditCard className="w-5 h-5 text-purple-600" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Refund Value</p>
              <p className="text-lg font-bold text-foreground">{formatCurrency(totalRefundValue)}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-border p-4 shadow-sm flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search invoices or returns..."
            className="w-full pl-8 pr-4 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          />
        </div>
        <button onClick={loadData} className="flex items-center gap-2 border border-border rounded-lg px-3 py-2 text-sm hover:bg-muted transition">
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-border shadow-sm">
          <div className="px-4 py-3 border-b border-border">
            <h3 className="font-semibold text-foreground flex items-center gap-2">
              <FileText className="w-4 h-4" />
              Eligible Invoices
            </h3>
          </div>
          <div className="max-h-[400px] overflow-y-auto">
            {loading ? (
              <div className="p-4 space-y-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="h-16 bg-muted rounded animate-pulse" />
                ))}
              </div>
            ) : filteredInvoices.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground text-sm">No eligible invoices found</div>
            ) : (
              filteredInvoices.slice(0, 10).map(inv => (
                <div
                  key={inv.id}
                  className="px-4 py-3 border-b border-border hover:bg-muted/50 transition"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-semibold text-foreground text-sm">{inv.invoice_number}</p>
                      <p className="text-xs text-muted-foreground">{inv.customer?.name || 'Walk-in Customer'}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-foreground text-sm">{formatCurrency(inv.total_amount)}</p>
                      <p className="text-xs text-muted-foreground">{formatDate(inv.invoice_date)}</p>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-border shadow-sm">
          <div className="px-4 py-3 border-b border-border">
            <h3 className="font-semibold text-foreground flex items-center gap-2">
              <ArrowRightLeft className="w-4 h-4" />
              Recent Returns
            </h3>
          </div>
          <div className="max-h-[400px] overflow-y-auto">
            {loading ? (
              <div className="p-4 space-y-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="h-16 bg-muted rounded animate-pulse" />
                ))}
              </div>
            ) : filteredReturns.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground text-sm">No returns recorded yet</div>
            ) : (
              filteredReturns.map(ret => (
                <div key={ret.id} className="px-4 py-3 border-b border-border hover:bg-muted/50 transition">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-semibold text-foreground text-sm">{ret.return_number}</p>
                      <p className="text-xs text-muted-foreground">
                        {ret.customer?.name || 'Customer'} | {ret.invoice?.invoice_number}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="text-right">
                        <p className="font-bold text-foreground text-sm">{formatCurrency(ret.total_refund_amount)}</p>
                        <p className="text-xs text-muted-foreground capitalize">{ret.refund_method?.replace('_', ' ')}</p>
                      </div>
                      <button
                        onClick={() => handleViewReturn(ret)}
                        className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-blue-50 text-muted-foreground hover:text-blue-600 transition"
                      >
                        <Eye className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {showModal && (
        <ReturnModal
          invoices={invoices}
          onClose={() => setShowModal(false)}
          onSaved={loadData}
        />
      )}

      {showViewModal && viewingReturn && (
        <ViewReturnModal returnData={viewingReturn} onClose={() => setShowViewModal(false)} />
      )}
    </div>
  );
}

function ReturnModal({ invoices, onClose, onSaved }: {
  invoices: Invoice[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [step, setStep] = useState(1);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [items, setItems] = useState<InvoiceItem[]>([]);
  const [returnItems, setReturnItems] = useState<Record<string, { qty: number; reason: string }>>({});
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    // Load payment methods from database
    supabase
      .from('payment_methods')
      .select('id, name, code, is_cash, is_bank, account_id')
      .eq('is_active', true)
      .order('sort_order')
      .then(({ data }) => {
        // Add "Store Credit" as a special option
        const methods = [
          { id: 'store_credit', name: 'Store Credit', code: 'store_credit', is_cash: false, is_bank: false, account_id: null },
          ...(data || [])
        ];
        setPaymentMethods(methods);
        if (methods.length > 0) {
          setSelectedPaymentMethod(methods[0].id);
        }
      });
  }, []);

  async function selectInvoice(invoice: Invoice) {
    setSelectedInvoice(invoice);
    const { data } = await supabase
      .from('invoice_items')
      .select('id, invoice_id, product_id, quantity, unit_price, cost_price, subtotal, product:products(name, sku, unit)')
      .eq('invoice_id', invoice.id);

    // Fetch previously returned quantities for each item
    const itemIds = (data || []).map(i => i.id);
    const { data: returnedItems } = itemIds.length > 0
      ? await supabase
          .from('sales_return_items')
          .select('invoice_item_id, quantity_returned')
          .in('invoice_item_id', itemIds)
      : { data: null };

    const returnedMap = new Map<string, number>();
    (returnedItems || []).forEach(ri => {
      const current = returnedMap.get(ri.invoice_item_id) || 0;
      returnedMap.set(ri.invoice_item_id, current + ri.quantity_returned);
    });

    // Add remaining_qty to each item and handle product object
    const itemsWithRemaining: InvoiceItem[] = (data || []).map((item: any) => ({
      id: item.id,
      invoice_id: item.invoice_id,
      product_id: item.product_id,
      quantity: item.quantity,
      unit_price: item.unit_price,
      cost_price: item.cost_price || 0,
      subtotal: item.subtotal,
      product: Array.isArray(item.product) ? item.product[0] : item.product,
      remaining_qty: item.quantity - (returnedMap.get(item.id) || 0)
    }));

    setItems(itemsWithRemaining);
    setStep(2);
  }

  const filteredInvoices = invoices.filter(inv =>
    !search ||
    inv.invoice_number.toLowerCase().includes(search.toLowerCase()) ||
    inv.customer?.name?.toLowerCase().includes(search.toLowerCase())
  );

  const totalRefundAmount = Object.entries(returnItems).reduce((sum, [itemId, { qty }]) => {
    const item = items.find(i => i.id === itemId);
    return sum + (item ? qty * item.unit_price : 0);
  }, 0);

  const totalCOGS = Object.entries(returnItems).reduce((sum, [itemId, { qty }]) => {
    const item = items.find(i => i.id === itemId);
    return sum + (item ? qty * (item.cost_price || 0) : 0);
  }, 0);

  async function handleReturn() {
    if (!selectedInvoice) return;

    const itemsToReturn = Object.entries(returnItems).filter(([_, v]) => v.qty > 0);
    if (itemsToReturn.length === 0) {
      setError('Please select at least one item to return');
      return;
    }

    if (!selectedPaymentMethod) {
      setError('Please select a refund method');
      return;
    }

    setSaving(true);
    setError('');

    try {
      // Generate return number
      const { data: returnNumberData } = await supabase.rpc('generate_sales_return_number');
      const returnNumber = returnNumberData || `SR-${Date.now().toString().slice(-6)}`;

      // Get default warehouse
      const { data: warehouse } = await supabase
        .from('warehouses')
        .select('id')
        .eq('is_default', true)
        .maybeSingle();
      const warehouseId = warehouse?.id || '11000000-0000-0000-0000-000000000001';

      // Get current user (if authenticated and exists in profiles)
      let createdBy: string | null = null;
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user?.id) {
          // Verify the user exists in profiles table
          const { data: profile } = await supabase
            .from('profiles')
            .select('id')
            .eq('id', user.id)
            .maybeSingle();
          if (profile) {
            createdBy = user.id;
          }
        }
      } catch {
        // Auth not available, continue without created_by
      }

      // Get selected payment method details
      const selectedMethod = paymentMethods.find(m => m.id === selectedPaymentMethod);
      const isStoreCredit = selectedPaymentMethod === 'store_credit';

      // Get required accounts
      const accountCodes = ['4050', '1100', '1200', '5000'];
      if (!isStoreCredit && selectedMethod?.account_id) {
        // We'll use the payment method's account for cash/bank refunds
      } else if (isStoreCredit) {
        accountCodes.push('2200'); // Customer Refund Payable
      }

      const { data: accounts } = await supabase
        .from('accounts')
        .select('id, code')
        .in('code', accountCodes);

      const getAccountId = (code: string) => accounts?.find(a => a.code === code)?.id;

      const salesReturnsAccountId = getAccountId('4050');
      const accountsReceivableId = getAccountId('1100');
      const customerRefundPayableId = getAccountId('2200');
      const inventoryAccountId = getAccountId('1200');
      const cogsAccountId = getAccountId('5000');

      if (!salesReturnsAccountId || !accountsReceivableId || !inventoryAccountId || !cogsAccountId) {
        setError('Required accounts not found. Please check chart of accounts.');
        setSaving(false);
        return;
      }

      // Determine credit account based on refund method
      let creditAccountId: string;
      if (isStoreCredit) {
        creditAccountId = customerRefundPayableId || accountsReceivableId;
      } else if (selectedMethod?.account_id) {
        creditAccountId = selectedMethod.account_id;
      } else {
        creditAccountId = accountsReceivableId;
      }

      // Create journal entry
      const journalEntryNumber = `JE-${Date.now().toString().slice(-6)}`;
      const journalLines: any[] = [];

      // Line 1: Debit Sales Returns & Allowances (Revenue Reversal)
      journalLines.push({
        account_id: salesReturnsAccountId,
        description: `Sales Return - ${returnNumber}`,
        debit: totalRefundAmount,
        credit: 0,
        sort_order: 1
      });

      // Line 2: Credit Accounts Receivable or Cash/Bank/Refund Payable
      journalLines.push({
        account_id: creditAccountId,
        description: isStoreCredit ? 'Customer Store Credit' : `Refund via ${selectedMethod?.name || 'Payment'}`,
        debit: 0,
        credit: totalRefundAmount,
        sort_order: 2
      });

      // Line 3: Debit Inventory (COGS Reversal) - if we have cost prices
      if (totalCOGS > 0) {
        journalLines.push({
          account_id: inventoryAccountId,
          description: 'Inventory restored from return',
          debit: totalCOGS,
          credit: 0,
          sort_order: 3
        });

        // Line 4: Credit COGS
        journalLines.push({
          account_id: cogsAccountId,
          description: 'COGS reversal for returned items',
          debit: 0,
          credit: totalCOGS,
          sort_order: 4
        });
      }

      // Insert journal entry (without created_by if no user)
      const journalEntryData: any = {
        entry_number: journalEntryNumber,
        entry_date: new Date().toISOString().split('T')[0],
        description: `Sales Return ${returnNumber} - Invoice ${selectedInvoice.invoice_number}`,
        reference_type: 'sales_return',
        total_debit: totalRefundAmount + totalCOGS,
        total_credit: totalRefundAmount + totalCOGS,
        is_posted: true
      };
      if (createdBy) {
        journalEntryData.created_by = createdBy;
      }

      const { data: journalEntry, error: journalError } = await supabase
        .from('journal_entries')
        .insert(journalEntryData)
        .select('id')
        .single();

      if (journalError) throw journalError;

      // Insert journal lines
      await supabase.from('journal_lines').insert(
        journalLines.map(line => ({
          ...line,
          journal_entry_id: journalEntry.id
        }))
      );

      // Update account balances for all affected accounts
      const affectedAccountIds = [...new Set(journalLines.map(l => l.account_id))];
      for (const accountId of affectedAccountIds) {
        const accountLines = journalLines.filter(l => l.account_id === accountId);
        const totalDebit = accountLines.reduce((sum, l) => sum + Number(l.debit || 0), 0);
        const totalCredit = accountLines.reduce((sum, l) => sum + Number(l.credit || 0), 0);

        // Get current balance
        const { data: currentAccount } = await supabase
          .from('accounts')
          .select('balance, type')
          .eq('id', accountId)
          .single();

        if (currentAccount) {
          // For asset/expense accounts: debit increases, credit decreases
          // For liability/equity/revenue accounts: credit increases, debit decreases
          const isDebitAccount = ['asset', 'expense'].includes(currentAccount.type);
          const netChange = isDebitAccount
            ? totalDebit - totalCredit
            : totalCredit - totalDebit;

          await supabase
            .from('accounts')
            .update({
              balance: (currentAccount.balance || 0) + netChange,
              updated_at: new Date().toISOString()
            })
            .eq('id', accountId);
        }
      }

      // Create payment record for the refund (only for non-store-credit refunds)
      let paymentId = null;
      if (!isStoreCredit) {
        const paymentNumber = `PAY-${Date.now().toString().slice(-6)}`;
        const { data: payment, error: paymentError } = await supabase
          .from('payments')
          .insert({
            payment_number: paymentNumber,
            payment_type: 'refund',
            reference_type: 'sales_return',
            reference_id: journalEntry.id,
            customer_id: selectedInvoice.customer_id,
            amount: totalRefundAmount,
            payment_method: selectedMethod?.code || 'cash',
            payment_date: new Date().toISOString().split('T')[0],
            notes: `Refund for sales return ${returnNumber}`
          })
          .select('id')
          .maybeSingle();

        if (!paymentError && payment) {
          paymentId = payment.id;
        }
      }

      // Create sales_return record
      const salesReturnData: any = {
        return_number: returnNumber,
        invoice_id: selectedInvoice.id,
        customer_id: selectedInvoice.customer_id,
        return_date: new Date().toISOString().split('T')[0],
        total_refund_amount: totalRefundAmount,
        refund_method: selectedMethod?.code || 'store_credit',
        status: 'completed',
        journal_entry_id: journalEntry.id,
        payment_id: paymentId
      };
      if (createdBy) {
        salesReturnData.created_by = createdBy;
      }

      const { data: salesReturn, error: returnError } = await supabase
        .from('sales_returns')
        .insert(salesReturnData)
        .select('id')
        .single();

      if (returnError) throw returnError;

      // Create sales_return_items
      for (const [itemId, { qty, reason }] of itemsToReturn) {
        const item = items.find(i => i.id === itemId);
        if (!item) continue;

        await supabase.from('sales_return_items').insert({
          sales_return_id: salesReturn.id,
          invoice_item_id: itemId,
          product_id: item.product_id,
          quantity_returned: qty,
          unit_price: item.unit_price,
          cost_price: item.cost_price || 0,
          subtotal: qty * item.unit_price,
          reason: reason || 'Not specified'
        });

        // Create stock movement for return
        await supabase.from('stock_movements').insert({
          tenant_id: '00000000-0000-0000-0000-000000000001',
          product_id: item.product_id,
          warehouse_id: warehouseId,
          movement_type: 'return_in',
          quantity: qty,
          unit_cost: item.cost_price || item.unit_price,
          reference_type: 'sales_return',
          reference_id: salesReturn.id,
          reference_number: returnNumber,
          notes: reason || `Return from invoice ${selectedInvoice.invoice_number}`,
        });

        // Update inventory
        const { data: invItem } = await supabase
          .from('inventory_items')
          .select('id, quantity_on_hand')
          .eq('product_id', item.product_id)
          .eq('warehouse_id', warehouseId)
          .maybeSingle();

        if (invItem) {
          await supabase.from('inventory_items').update({
            quantity_on_hand: invItem.quantity_on_hand + qty,
            updated_at: new Date().toISOString(),
          }).eq('id', invItem.id);
        } else {
          await supabase.from('inventory_items').insert({
            tenant_id: '00000000-0000-0000-0000-000000000001',
            product_id: item.product_id,
            warehouse_id: warehouseId,
            quantity_on_hand: qty,
          });
        }
      }

      // Update invoice amount_paid
      const newAmountPaid = Math.max(0, selectedInvoice.amount_paid - totalRefundAmount);
      const newBalanceDue = selectedInvoice.total_amount - newAmountPaid;
      const newStatus = newBalanceDue <= 0 ? 'paid' :
                        newAmountPaid > 0 ? 'partially_paid' : 'sent';

      await supabase.from('invoices').update({
        amount_paid: newAmountPaid,
        balance_due: newBalanceDue,
        status: newStatus,
        updated_at: new Date().toISOString(),
      }).eq('id', selectedInvoice.id);

      // Update customer outstanding balance for store credit
      if (isStoreCredit && selectedInvoice.customer_id) {
        const { data: currentCustomer } = await supabase
          .from('customers')
          .select('outstanding_balance')
          .eq('id', selectedInvoice.customer_id)
          .maybeSingle();

        if (currentCustomer) {
          // Store credit increases what the customer is owed (negative balance or credit)
          await supabase
            .from('customers')
            .update({
              outstanding_balance: (currentCustomer.outstanding_balance || 0) - totalRefundAmount,
              updated_at: new Date().toISOString()
            })
            .eq('id', selectedInvoice.customer_id);
        }
      }

      toast({
        title: 'Return Processed Successfully',
        description: `Return ${returnNumber} created. Refund: ${formatCurrency(totalRefundAmount)}`
      });

      // Show success state briefly before closing
      setTimeout(() => {
        onSaved();
        onClose();
      }, 1500);

    } catch (err: any) {
      console.error('Return processing error:', err);
      setError(err.message || 'Failed to process return');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border sticky top-0 bg-white">
          <h2 className="text-base font-bold">Process Sales Return</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-6">
          {error && <div className="p-3 bg-red-50 text-red-600 rounded-lg text-sm mb-4">{error}</div>}

          {step === 1 && (
            <div className="space-y-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search invoices..."
                  className="w-full pl-8 pr-4 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                />
              </div>
              <div className="max-h-[400px] overflow-y-auto space-y-2">
                {filteredInvoices.map(inv => (
                  <div
                    key={inv.id}
                    onClick={() => selectInvoice(inv)}
                    className="p-4 border border-border rounded-lg cursor-pointer hover:border-blue-300 hover:bg-blue-50/50 transition"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-semibold text-foreground">{inv.invoice_number}</p>
                        <p className="text-sm text-muted-foreground">{inv.customer?.name || 'Walk-in Customer'}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-bold text-foreground">{formatCurrency(inv.total_amount)}</p>
                        <p className="text-xs text-muted-foreground">{formatDate(inv.invoice_date)}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {step === 2 && selectedInvoice && (
            <div className="space-y-4">
              <div className="p-3 bg-muted/50 rounded-lg">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-semibold text-foreground">{selectedInvoice.invoice_number}</p>
                    <p className="text-sm text-muted-foreground">{selectedInvoice.customer?.name || 'Walk-in Customer'}</p>
                  </div>
                  <p className="font-bold">{formatCurrency(selectedInvoice.total_amount)}</p>
                </div>
              </div>

              <div className="border-t border-border pt-4">
                <h4 className="text-sm font-medium mb-3">Select items to return:</h4>
                <div className="space-y-2">
                  {items.filter(item => (item.remaining_qty || item.quantity) > 0).map(item => {
                    const maxReturnable = item.remaining_qty ?? item.quantity;
                    return (
                    <div key={item.id} className="p-3 border border-border rounded-lg">
                      <div className="flex items-center justify-between mb-2">
                        <div>
                          <p className="font-medium text-foreground text-sm">{item.product?.name}</p>
                          <p className="text-xs text-muted-foreground">SKU: {item.product?.sku} | Unit: {item.product?.unit}</p>
                          {maxReturnable < item.quantity && (
                            <p className="text-xs text-amber-600">Already returned: {item.quantity - maxReturnable} | Remaining: {maxReturnable}</p>
                          )}
                        </div>
                        <div className="text-right">
                          <p className="font-semibold">{formatCurrency(item.unit_price)}/unit</p>
                          {item.cost_price > 0 && (
                            <p className="text-xs text-muted-foreground">Cost: {formatCurrency(item.cost_price)}</p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="flex-1">
                          <label className="text-xs text-muted-foreground">Return Qty (max: {maxReturnable})</label>
                          <input
                            type="number"
                            min="0"
                            max={maxReturnable}
                            value={returnItems[item.id]?.qty || 0}
                            onChange={e => setReturnItems({
                              ...returnItems,
                              [item.id]: { qty: Math.min(Number(e.target.value), maxReturnable), reason: returnItems[item.id]?.reason || '' }
                            })}
                            className="w-full border border-border rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                          />
                        </div>
                        <div className="flex-[2]">
                          <label className="text-xs text-muted-foreground">Reason</label>
                          <select
                            value={returnItems[item.id]?.reason || ''}
                            onChange={e => setReturnItems({
                              ...returnItems,
                              [item.id]: { qty: returnItems[item.id]?.qty || 0, reason: e.target.value }
                            })}
                            className="w-full border border-border rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                          >
                            <option value="">Select reason</option>
                            <option value="defective">Defective</option>
                            <option value="wrong_item">Wrong Item</option>
                            <option value="not_as_described">Not as Described</option>
                            <option value="changed_mind">Changed Mind</option>
                            <option value="other">Other</option>
                          </select>
                        </div>
                      </div>
                    </div>
                  )})}
                </div>
              </div>

              {/* Refund Method Selection */}
              <div className="border-t border-border pt-4">
                <h4 className="text-sm font-medium mb-3">Refund Method:</h4>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {paymentMethods.map(method => (
                    <button
                      key={method.id}
                      type="button"
                      onClick={() => setSelectedPaymentMethod(method.id)}
                      className={`flex items-center justify-center gap-2 p-3 rounded-lg border transition text-left ${
                        selectedPaymentMethod === method.id
                          ? 'border-blue-500 bg-blue-50 text-blue-700'
                          : 'border-border hover:border-blue-300'
                      }`}
                    >
                      {method.is_cash ? (
                        <Banknote className="w-4 h-4 shrink-0" />
                      ) : method.is_bank ? (
                        <Building2 className="w-4 h-4 shrink-0" />
                      ) : (
                        <Wallet className="w-4 h-4 shrink-0" />
                      )}
                      <span className="text-sm font-medium truncate">{method.name}</span>
                    </button>
                  ))}
                </div>
                {selectedPaymentMethod === 'store_credit' && (
                  <p className="text-xs text-muted-foreground mt-2">
                    Customer will receive store credit that can be used for future purchases.
                  </p>
                )}
              </div>

              {/* Summary */}
              {totalRefundAmount > 0 && (
                <div className="border-t border-border pt-4 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Total Refund Amount:</span>
                    <span className="font-bold">{formatCurrency(totalRefundAmount)}</span>
                  </div>
                  {totalCOGS > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">COGS Reversal:</span>
                      <span className="text-muted-foreground">{formatCurrency(totalCOGS)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-sm pt-2 border-t">
                    <span className="text-muted-foreground">Journal Entry Lines:</span>
                    <span className="text-muted-foreground">{totalCOGS > 0 ? 4 : 2} lines</span>
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between pt-4 border-t border-border">
                <button onClick={() => setStep(1)} className="px-4 py-2 border border-border rounded-lg text-sm hover:bg-muted transition">
                  Back
                </button>
                <button
                  onClick={handleReturn}
                  disabled={saving || totalRefundAmount === 0}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold transition disabled:opacity-60"
                >
                  {saving ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      Processing...
                    </>
                  ) : (
                    <>
                      <Package className="w-4 h-4" />
                      Process Return
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ViewReturnModal({ returnData, onClose }: {
  returnData: SalesReturn;
  onClose: () => void;
}) {
  const [journalEntry, setJournalEntry] = useState<any>(null);

  useEffect(() => {
    if (returnData.journal_entry_id) {
      supabase
        .from('journal_entries')
        .select('*, lines:journal_lines(*, account:accounts(name, code))')
        .eq('id', returnData.journal_entry_id)
        .single()
        .then(({ data }) => setJournalEntry(data));
    }
  }, [returnData.journal_entry_id]);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border sticky top-0 bg-white">
          <h2 className="text-base font-bold">Return Details</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="p-3 bg-muted/50 rounded-lg">
              <p className="text-xs text-muted-foreground">Return Number</p>
              <p className="font-bold text-foreground">{returnData.return_number}</p>
            </div>
            <div className="p-3 bg-muted/50 rounded-lg">
              <p className="text-xs text-muted-foreground">Status</p>
              <p className="font-bold text-green-600 capitalize">{returnData.status}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-muted-foreground">Date</p>
              <p className="text-foreground">{formatDate(returnData.created_at)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Refund Method</p>
              <p className="text-foreground capitalize">{returnData.refund_method?.replace('_', ' ')}</p>
            </div>
          </div>

          <div>
            <p className="text-xs text-muted-foreground">Total Refund Amount</p>
            <p className="font-bold text-foreground text-xl">{formatCurrency(returnData.total_refund_amount)}</p>
          </div>

          {returnData.items && returnData.items.length > 0 && (
            <div>
              <p className="text-xs text-muted-foreground mb-2">Returned Items</p>
              <div className="space-y-2">
                {returnData.items.map((item) => (
                  <div key={item.id} className="p-3 bg-muted/30 rounded-lg">
                    <div className="flex justify-between">
                      <div>
                        <p className="font-medium text-sm">{item.product?.name}</p>
                        <p className="text-xs text-muted-foreground">SKU: {item.product?.sku}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-medium">{formatCurrency(item.subtotal)}</p>
                        <p className="text-xs text-muted-foreground">Qty: {item.quantity_returned}</p>
                      </div>
                    </div>
                    {item.reason && (
                      <p className="text-xs text-muted-foreground mt-1">Reason: {item.reason}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {journalEntry && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs text-muted-foreground">Journal Entry</p>
                <Link
                  href={`/accounting/journal`}
                  className="text-xs text-blue-600 hover:underline flex items-center gap-1"
                >
                  View in Journal <ExternalLink className="w-3 h-3" />
                </Link>
              </div>
              <div className="p-3 bg-muted/30 rounded-lg space-y-2">
                <p className="text-sm font-medium">{journalEntry.entry_number}</p>
                <div className="text-xs space-y-1">
                  {journalEntry.lines?.map((line: any) => (
                    <div key={line.id} className="flex justify-between">
                      <span className="text-muted-foreground">{line.account?.name}</span>
                      <span className={Number(line.debit) > 0 ? 'text-green-600' : 'text-red-600'}>
                        {Number(line.debit) > 0 ? `Dr. ${formatCurrency(line.debit)}` : `Cr. ${formatCurrency(line.credit)}`}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          <button onClick={onClose} className="w-full px-4 py-2 border border-border rounded-lg text-sm hover:bg-muted transition">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
