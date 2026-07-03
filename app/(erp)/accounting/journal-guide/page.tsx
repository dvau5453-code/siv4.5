'use client';

import { useState, useMemo } from 'react';
import { BookOpen, Search, ChevronDown, ChevronRight, ArrowRight, ArrowLeftRight, ShoppingCart, Receipt, Package, CreditCard, RotateCcw, Truck, Banknote, Calculator, FileText, TrendingUp, CircleCheck, Info, Lightbulb, Zap } from 'lucide-react';

interface JournalScenario {
  id: string;
  title: string;
  category: string;
  icon: React.ElementType;
  iconColor: string;
  summary: string;
  trigger: string;
  entries: {
    description: string;
    debitAccount: string;
    debitCode: string;
    creditAccount: string;
    creditCode: string;
    amount: string;
    explanation: string;
  }[];
  example?: {
    context: string;
    lines: { account: string; code: string; debit: string; credit: string }[];
  };
  notes?: string[];
}

const scenarios: JournalScenario[] = [
  {
    id: 'sales-invoice',
    title: 'Sales Invoice Creation',
    category: 'Sales',
    icon: Receipt,
    iconColor: 'bg-blue-50 text-blue-600',
    summary: 'When an invoice is created with status sent, partially_paid, or paid, the system posts an Accounts Receivable + Sales Revenue entry.',
    trigger: 'AFTER INSERT or UPDATE on invoices (when status is not draft)',
    entries: [
      {
        description: 'Record the receivable and revenue',
        debitAccount: 'Accounts Receivable',
        debitCode: '1100',
        creditAccount: 'Sales Revenue',
        creditCode: '4000',
        amount: 'Invoice Total Amount',
        explanation: 'You are owed money by the customer (AR increases = debit), and you have earned revenue (Revenue increases = credit).',
      },
    ],
    example: {
      context: 'Invoice INV-001 for 10,000 BDT to customer "ABC Corp", status = sent',
      lines: [
        { account: 'Accounts Receivable (1100)', code: '1100', debit: '10,000', credit: '—' },
        { account: 'Sales Revenue (4000)', code: '4000', debit: '—', credit: '10,000' },
      ],
    },
    notes: [
      'This entry is skipped if the invoice status is "draft" — revenue is only recognized when the invoice is sent or paid.',
      'If an invoice is created as "paid" (e.g., POS sale), both this entry and the payment entry will be posted.',
    ],
  },
  {
    id: 'payment-received',
    title: 'Payment Received from Customer',
    category: 'Sales',
    icon: Banknote,
    iconColor: 'bg-green-50 text-green-600',
    summary: 'When a customer pays for an invoice, the system posts a Cash/Bank + Accounts Receivable entry. The cash/bank account is determined by the payment method used.',
    trigger: 'AFTER INSERT on payments (where payment_type = received)',
    entries: [
      {
        description: 'Record cash receipt and reduce receivable',
        debitAccount: 'Cash / Bank Account',
        debitCode: '1001–1024',
        creditAccount: 'Accounts Receivable',
        creditCode: '1100',
        amount: 'Payment Amount',
        explanation: 'Cash or bank balance increases (debit), and the customer owes you less (AR decreases = credit). The specific cash/bank account is pulled from the payment_methods table.',
      },
    ],
    example: {
      context: 'Customer pays 5,000 BDT via bKash for invoice INV-001',
      lines: [
        { account: 'bKash (1024)', code: '1024', debit: '5,000', credit: '—' },
        { account: 'Accounts Receivable (1100)', code: '1100', debit: '—', credit: '5,000' },
      ],
    },
    notes: [
      'The system automatically selects the correct cash/bank account based on the payment method (Cash → 1001, bKash → 1024, Bank Transfer → 1020, Card → 1021, etc.).',
      'If the payment method has no linked account, it defaults to "Cash in Hand" (1001).',
    ],
  },
  {
    id: 'cogs',
    title: 'Cost of Goods Sold (COGS)',
    category: 'Inventory',
    icon: Package,
    iconColor: 'bg-orange-50 text-orange-600',
    summary: 'When an invoice item is inserted for a non-draft invoice, the system posts a COGS entry to recognize the cost of the items sold and reduce inventory value.',
    trigger: 'AFTER INSERT on invoice_items (when invoice status is not draft)',
    entries: [
      {
        description: 'Record cost of goods sold and release inventory',
        debitAccount: 'Cost of Goods Sold',
        debitCode: '5000',
        creditAccount: 'Inventory Asset',
        creditCode: '1200',
        amount: 'Quantity × Cost Price (per item)',
        explanation: 'COGS is an expense that increases (debit). Inventory asset decreases because goods have left the warehouse (credit). The amount is calculated as base_quantity × cost_price for each item.',
      },
    ],
    example: {
      context: 'Sold 5 units of "Cement Bag" at cost price 400 BDT each (total COGS = 2,000 BDT)',
      lines: [
        { account: 'Cost of Goods Sold (5000)', code: '5000', debit: '2,000', credit: '—' },
        { account: 'Inventory Asset (1200)', code: '1200', debit: '—', credit: '2,000' },
      ],
    },
    notes: [
      'COGS is posted per invoice item, not per invoice — each line item generates its own COGS entry.',
      'For multi-unit products (e.g., selling 1 box = 12 units), the system uses base_quantity (12) not the sale quantity (1).',
      'If invoice is created as draft, COGS is deferred until the invoice status changes to sent/paid.',
    ],
  },
  {
    id: 'stock-deduction',
    title: 'Stock Deduction on Sale',
    category: 'Inventory',
    icon: Package,
    iconColor: 'bg-amber-50 text-amber-600',
    summary: 'When an invoice item is inserted, the system deducts the sold quantity from inventory_items.quantity_on_hand and records a stock_movements entry of type "sale".',
    trigger: 'AFTER INSERT on invoice_items',
    entries: [
      {
        description: 'Deduct stock from default warehouse',
        debitAccount: '— (inventory_items.quantity_on_hand decreased)',
        debitCode: 'N/A',
        creditAccount: '— (stock_movements row inserted)',
        creditCode: 'N/A',
        amount: 'Base Quantity (or Quantity if no base_quantity)',
        explanation: 'This is not a journal entry — it is a direct inventory update. The quantity_on_hand in the default warehouse is reduced, and a stock_movements row of type "sale" is created with a negative quantity for audit tracking.',
      },
    ],
    example: {
      context: 'Sold 2 boxes of "Screws" (1 box = 100 units, so base_quantity = 200)',
      lines: [
        { account: 'inventory_items.quantity_on_hand', code: '—', debit: '—', credit: '−200 (reduced)' },
        { account: 'stock_movements (type: sale)', code: '—', debit: '−200', credit: '—' },
      ],
    },
    notes: [
      'Stock is always deducted from the default warehouse. If the product has no inventory record, one is created with negative stock.',
      'The stock_movements row includes the product cost as unit_cost for valuation purposes.',
      'This runs alongside the COGS journal entry — stock deduction handles physical inventory, COGS handles the accounting value.',
    ],
  },
  {
    id: 'quotation-convert',
    title: 'Quotation to Invoice Conversion',
    category: 'Sales',
    icon: ArrowRight,
    iconColor: 'bg-purple-50 text-purple-600',
    summary: 'Converting a quotation to an invoice creates an invoice + invoice_items + optional payment. This triggers all the same automation as a direct invoice: AR + Revenue, COGS, stock deduction, and payment journal entries.',
    trigger: 'Client-side insert of invoices + invoice_items + payments (triggers fire automatically)',
    entries: [
      {
        description: '1. AR + Revenue (from invoice trigger)',
        debitAccount: 'Accounts Receivable',
        debitCode: '1100',
        creditAccount: 'Sales Revenue',
        creditCode: '4000',
        amount: 'Invoice Total',
        explanation: 'Same as direct invoice creation — the invoice trigger fires automatically.',
      },
      {
        description: '2. COGS + Inventory (from invoice_items trigger)',
        debitAccount: 'Cost of Goods Sold',
        debitCode: '5000',
        creditAccount: 'Inventory Asset',
        creditCode: '1200',
        amount: 'Sum of (base_quantity × cost_price) for all items',
        explanation: 'Fires per invoice item. The conversion includes base_quantity and unit info so multi-unit products deduct correctly.',
      },
      {
        description: '3. Stock deduction (from invoice_items trigger)',
        debitAccount: '— (inventory reduced)',
        debitCode: 'N/A',
        creditAccount: '— (stock_movements recorded)',
        creditCode: 'N/A',
        amount: 'Per item base_quantity',
        explanation: 'Physical stock is deducted from the default warehouse for each item.',
      },
      {
        description: '4. Cash + AR (from payment trigger, if payment received)',
        debitAccount: 'Cash / Bank',
        debitCode: '1001–1024',
        creditAccount: 'Accounts Receivable',
        creditCode: '1100',
        amount: 'Amount Paid',
        explanation: 'Only posted if a payment is recorded during conversion. Reduces AR by the amount received.',
      },
    ],
    example: {
      context: 'Quotation QT-001 for 15,000 BDT converted to invoice INV-002, 10,000 paid via cash',
      lines: [
        { account: 'Accounts Receivable (1100)', code: '1100', debit: '15,000', credit: '—' },
        { account: 'Sales Revenue (4000)', code: '4000', debit: '—', credit: '15,000' },
        { account: 'Cost of Goods Sold (5000)', code: '5000', debit: '8,000', credit: '—' },
        { account: 'Inventory Asset (1200)', code: '1200', debit: '—', credit: '8,000' },
        { account: 'Cash in Hand (1001)', code: '1001', debit: '10,000', credit: '—' },
        { account: 'Accounts Receivable (1100)', code: '1100', debit: '—', credit: '10,000' },
      ],
    },
    notes: [
      'The conversion now passes base_quantity, unit_name, and unit_conversion_factor so multi-unit products are handled correctly.',
      'The quotation status is updated to "converted" after the invoice is created.',
      'If partial payment is recorded, AR will show a remaining balance equal to invoice total minus amount paid.',
    ],
  },
  {
    id: 'pos-sale',
    title: 'POS Sale (Point of Sale)',
    category: 'Sales',
    icon: ShoppingCart,
    iconColor: 'bg-cyan-50 text-cyan-600',
    summary: 'A POS sale creates an invoice with status "paid" and is_pos=true, along with invoice_items and a payment. All triggers fire automatically: AR + Revenue, COGS, stock deduction, and payment entry.',
    trigger: 'Client-side insert (triggers fire automatically on invoice + items + payment)',
    entries: [
      {
        description: '1. AR + Revenue',
        debitAccount: 'Accounts Receivable',
        debitCode: '1100',
        creditAccount: 'Sales Revenue',
        creditCode: '4000',
        amount: 'Sale Total',
        explanation: 'Posted by the invoice accounting trigger.',
      },
      {
        description: '2. COGS + Inventory',
        debitAccount: 'Cost of Goods Sold',
        debitCode: '5000',
        creditAccount: 'Inventory Asset',
        creditCode: '1200',
        amount: 'Per item (qty × cost)',
        explanation: 'Posted by the COGS trigger for each item.',
      },
      {
        description: '3. Cash + AR (full payment)',
        debitAccount: 'Cash / Bank',
        debitCode: '1001–1024',
        creditAccount: 'Accounts Receivable',
        creditCode: '1100',
        amount: 'Full Sale Total',
        explanation: 'Since POS is always paid in full, the payment trigger clears the entire AR balance immediately. The cash account depends on the selected payment method.',
      },
    ],
    example: {
      context: 'POS sale for 3,000 BDT paid via Cash, selling 10 units at cost 150 each',
      lines: [
        { account: 'Accounts Receivable (1100)', code: '1100', debit: '3,000', credit: '—' },
        { account: 'Sales Revenue (4000)', code: '4000', debit: '—', credit: '3,000' },
        { account: 'Cost of Goods Sold (5000)', code: '5000', debit: '1,500', credit: '—' },
        { account: 'Inventory Asset (1200)', code: '1200', debit: '—', credit: '1,500' },
        { account: 'Cash in Hand (1001)', code: '1001', debit: '3,000', credit: '—' },
        { account: 'Accounts Receivable (1100)', code: '1100', debit: '—', credit: '3,000' },
      ],
    },
    notes: [
      'In POS, AR is momentarily created and then immediately cleared by the full payment — net AR effect is zero for cash POS sales.',
      'Stock is deducted from the default warehouse just like a regular invoice.',
    ],
  },
  {
    id: 'sales-return',
    title: 'Sales Return / Refund',
    category: 'Sales',
    icon: RotateCcw,
    iconColor: 'bg-red-50 text-red-600',
    summary: 'When a sales return is created, the system reverses the original sale: revenue is reduced, AR or cash is credited back, and inventory is restored.',
    trigger: 'Sales return creation (handled by return-specific triggers)',
    entries: [
      {
        description: 'Reverse revenue and restore receivable/cash',
        debitAccount: 'Sales Returns & Allowances',
        debitCode: '4050',
        creditAccount: 'Accounts Receivable or Cash',
        creditCode: '1100 / 1001',
        amount: 'Return Amount',
        explanation: 'Sales Returns is a contra-revenue account (debit increases the return). The customer is credited by reducing AR or refunding cash.',
      },
      {
        description: 'Reverse COGS and restore inventory',
        debitAccount: 'Inventory Asset',
        debitCode: '1200',
        creditAccount: 'Cost of Goods Sold',
        creditCode: '5000',
        amount: 'Returned Qty × Cost Price',
        explanation: 'Inventory goes back up (debit), and COGS is reduced (credit) since the goods are returned to stock.',
      },
    ],
    notes: [
      'Sales returns are processed through the Sales Returns page, which has its own trigger logic.',
      'The refund method determines whether AR is reduced (credit note) or cash is paid out.',
    ],
  },
  {
    id: 'grn-purchase',
    title: 'Goods Receipt (Purchase)',
    category: 'Purchases',
    icon: Truck,
    iconColor: 'bg-indigo-50 text-indigo-600',
    summary: 'When a Goods Receipt Note (GRN) is posted, the system records inventory received and creates an Accounts Payable liability to the supplier.',
    trigger: 'AFTER UPDATE on goods_receipt_notes (when status changes to posted)',
    entries: [
      {
        description: 'Record inventory received and payable to supplier',
        debitAccount: 'Inventory Asset',
        debitCode: '1200',
        creditAccount: 'Accounts Payable',
        creditCode: '2000',
        amount: 'Total GRN Value (qty × unit cost)',
        explanation: 'Inventory increases (debit) because goods have arrived. AP increases (credit) because you owe the supplier money.',
      },
    ],
    example: {
      context: 'GRN for 100 units at 500 BDT each = 50,000 BDT from supplier "XYZ Trading"',
      lines: [
        { account: 'Inventory Asset (1200)', code: '1200', debit: '50,000', credit: '—' },
        { account: 'Accounts Payable (2000)', code: '2000', debit: '—', credit: '50,000' },
      ],
    },
    notes: [
      'Stock is also added to inventory_items for the received warehouse.',
      'A stock_movements row of type "purchase" is created with positive quantity.',
    ],
  },
  {
    id: 'supplier-payment',
    title: 'Payment to Supplier',
    category: 'Purchases',
    icon: CreditCard,
    iconColor: 'bg-rose-50 text-rose-600',
    summary: 'When a payment is made to a supplier, the system reduces Accounts Payable and reduces the Cash/Bank account.',
    trigger: 'AFTER INSERT on payments (where payment_type = paid)',
    entries: [
      {
        description: 'Record payment to supplier',
        debitAccount: 'Accounts Payable',
        debitCode: '2000',
        creditAccount: 'Cash / Bank Account',
        creditCode: '1001–1024',
        amount: 'Payment Amount',
        explanation: 'AP decreases (debit) because you owe less. Cash decreases (credit) because money left your account.',
      },
    ],
    example: {
      context: 'Pay 20,000 BDT to supplier via Bank Transfer',
      lines: [
        { account: 'Accounts Payable (2000)', code: '2000', debit: '20,000', credit: '—' },
        { account: 'City Bank Account (1020)', code: '1020', debit: '—', credit: '20,000' },
      ],
    },
  },
  {
    id: 'opening-balance',
    title: 'Opening Balance / Initial Setup',
    category: 'Setup',
    icon: Calculator,
    iconColor: 'bg-slate-50 text-slate-600',
    summary: 'When the system is first set up, opening balances are posted to establish the starting state of all accounts. This typically involves recording initial inventory, cash, and owner equity.',
    trigger: 'Manual posting via inventory opening or accounting setup',
    entries: [
      {
        description: 'Record opening inventory and equity',
        debitAccount: 'Inventory Asset',
        debitCode: '1200',
        creditAccount: 'Owner Equity',
        creditCode: '3000',
        amount: 'Total Opening Inventory Value',
        explanation: 'Inventory is recognized as an asset (debit), and the corresponding capital is recorded as owner equity (credit). This balances the books from day one.',
      },
      {
        description: 'Record opening cash balance',
        debitAccount: 'Cash in Hand',
        debitCode: '1001',
        creditAccount: 'Owner Equity',
        creditCode: '3000',
        amount: 'Opening Cash Amount',
        explanation: 'Cash on hand is an asset (debit), funded by owner capital (credit).',
      },
    ],
    notes: [
      'Opening balances are posted once during system setup.',
      'The total of all asset debits must equal the total of all equity/liability credits for the books to balance.',
    ],
  },
];

const categories = ['All', 'Sales', 'Inventory', 'Purchases', 'Setup'];

export default function JournalGuidePage() {
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState('All');
  const [expandedId, setExpandedId] = useState<string | null>(scenarios[0]?.id || null);

  const filtered = useMemo(() => {
    return scenarios.filter(s =>
      (activeCategory === 'All' || s.category === activeCategory) &&
      (!search ||
        s.title.toLowerCase().includes(search.toLowerCase()) ||
        s.summary.toLowerCase().includes(search.toLowerCase()) ||
        s.entries.some(e => e.debitAccount.toLowerCase().includes(search.toLowerCase()) || e.creditAccount.toLowerCase().includes(search.toLowerCase())))
    );
  }, [search, activeCategory]);

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <BookOpen className="w-6 h-6 text-blue-600" />
            Journal Entry Guide
          </h1>
          <p className="text-muted-foreground text-sm mt-1 max-w-2xl">
            A complete reference for every journal entry the system automatically posts. Learn what triggers each entry, which accounts are debited and credited, and why.
          </p>
        </div>
      </div>

      {/* Info Banner */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-start gap-3">
        <Info className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
        <div className="text-sm text-blue-900">
          <p className="font-semibold mb-1">How double-entry accounting works in this system</p>
          <p className="text-blue-700">Every business event triggers a balanced journal entry: at least one <strong>debit</strong> and one <strong>credit</strong> of equal amount. Assets and expenses increase with debits; liabilities, equity, and revenue increase with credits. The system automates all entries below — you don&apos;t need to post them manually.</p>
        </div>
      </div>

      {/* Search + Filter */}
      <div className="bg-white rounded-xl border border-border p-4 shadow-sm flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by title, account name, or description..."
            className="w-full pl-8 pr-4 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          />
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {categories.map(cat => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`px-3 py-2 rounded-lg text-xs font-medium transition ${activeCategory === cat ? 'bg-blue-600 text-white' : 'bg-muted text-muted-foreground hover:bg-muted/80'}`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Quick Reference Table */}
      <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-border bg-muted/30">
          <h2 className="text-sm font-bold text-foreground flex items-center gap-2"><FileText className="w-4 h-4" />Quick Reference — All Entries at a Glance</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-muted/40 border-b border-border">
                <th className="text-left text-xs font-semibold text-muted-foreground px-4 py-2.5">Scenario</th>
                <th className="text-left text-xs font-semibold text-muted-foreground px-4 py-2.5">Debit Account</th>
                <th className="text-left text-xs font-semibold text-muted-foreground px-4 py-2.5">Credit Account</th>
                <th className="text-left text-xs font-semibold text-muted-foreground px-4 py-2.5">When</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {scenarios.flatMap(s => s.entries.map((e, i) => (
                <tr key={`${s.id}-${i}`} className="hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-2.5 text-xs font-semibold text-foreground">{s.title}{s.entries.length > 1 ? ` (${i + 1})` : ''}</td>
                  <td className="px-4 py-2.5 text-xs"><span className="font-mono text-blue-600">{e.debitCode}</span> <span className="text-foreground">{e.debitAccount}</span></td>
                  <td className="px-4 py-2.5 text-xs"><span className="font-mono text-green-600">{e.creditCode}</span> <span className="text-foreground">{e.creditAccount}</span></td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">{s.trigger}</td>
                </tr>
              )))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Detailed Scenarios */}
      <div className="space-y-3">
        {filtered.map((scenario) => {
          const Icon = scenario.icon;
          const isExpanded = expandedId === scenario.id;
          return (
            <div key={scenario.id} className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
              <button
                onClick={() => setExpandedId(isExpanded ? null : scenario.id)}
                className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-muted/30 transition-colors text-left"
              >
                <div className={`w-9 h-9 ${scenario.iconColor} rounded-lg flex items-center justify-center shrink-0`}>
                  <Icon className="w-4.5 h-4.5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-bold text-foreground">{scenario.title}</h3>
                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-muted text-muted-foreground uppercase tracking-wide">{scenario.category}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">{scenario.summary}</p>
                </div>
                {isExpanded ? <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />}
              </button>

              {isExpanded && (
                <div className="px-4 pb-4 space-y-4 border-t border-border pt-4">
                  {/* Trigger */}
                  <div className="flex items-start gap-2 text-xs">
                    <Zap className="w-3.5 h-3.5 text-amber-500 mt-0.5 shrink-0" />
                    <div>
                      <span className="font-semibold text-foreground">Trigger: </span>
                      <span className="text-muted-foreground font-mono">{scenario.trigger}</span>
                    </div>
                  </div>

                  {/* Journal Entries */}
                  {scenario.entries.map((entry, i) => (
                    <div key={i} className="border border-border rounded-lg p-3 bg-muted/20">
                      <p className="text-xs font-semibold text-foreground mb-2">{entry.description}</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-2">
                        <div className="bg-blue-50 border border-blue-200 rounded-lg p-2.5">
                          <p className="text-[10px] font-bold text-blue-600 uppercase tracking-wide mb-0.5">Debit</p>
                          <p className="text-xs font-semibold text-foreground">{entry.debitAccount}</p>
                          <p className="text-[10px] text-muted-foreground font-mono">Code: {entry.debitCode}</p>
                        </div>
                        <div className="bg-green-50 border border-green-200 rounded-lg p-2.5">
                          <p className="text-[10px] font-bold text-green-600 uppercase tracking-wide mb-0.5">Credit</p>
                          <p className="text-xs font-semibold text-foreground">{entry.creditAccount}</p>
                          <p className="text-[10px] text-muted-foreground font-mono">Code: {entry.creditCode}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 text-xs mb-2">
                        <span className="text-muted-foreground">Amount:</span>
                        <span className="font-semibold text-foreground bg-muted px-2 py-0.5 rounded">{entry.amount}</span>
                      </div>
                      <p className="text-xs text-muted-foreground italic">{entry.explanation}</p>
                    </div>
                  ))}

                  {/* Example */}
                  {scenario.example && (
                    <div className="border border-border rounded-lg overflow-hidden">
                      <div className="bg-slate-50 px-3 py-2 border-b border-border">
                        <p className="text-[10px] font-bold text-slate-600 uppercase tracking-wide flex items-center gap-1.5">
                          <Lightbulb className="w-3 h-3" /> Worked Example
                        </p>
                      </div>
                      <p className="text-xs text-muted-foreground px-3 py-2 bg-slate-50/50 border-b border-border">{scenario.example.context}</p>
                      <table className="w-full">
                        <thead>
                          <tr className="bg-muted/30">
                            <th className="text-left text-[10px] font-semibold text-muted-foreground px-3 py-1.5">Account</th>
                            <th className="text-right text-[10px] font-semibold text-muted-foreground px-3 py-1.5">Debit</th>
                            <th className="text-right text-[10px] font-semibold text-muted-foreground px-3 py-1.5">Credit</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {scenario.example.lines.map((line, i) => (
                            <tr key={i}>
                              <td className="px-3 py-1.5 text-xs text-foreground">{line.account}</td>
                              <td className="px-3 py-1.5 text-xs text-right font-mono text-blue-600 font-semibold">{line.debit}</td>
                              <td className="px-3 py-1.5 text-xs text-right font-mono text-green-600 font-semibold">{line.credit}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* Notes */}
                  {scenario.notes && scenario.notes.length > 0 && (
                    <div className="space-y-1.5">
                      {scenario.notes.map((note, i) => (
                        <div key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                          <CircleCheck className="w-3.5 h-3.5 text-green-500 mt-0.5 shrink-0" />
                          <span>{note}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div className="text-center py-12 text-muted-foreground text-sm">No scenarios found matching your search.</div>
        )}
      </div>

      {/* Footer Note */}
      <div className="bg-muted/30 rounded-xl p-4 text-center">
        <p className="text-xs text-muted-foreground">
          All journal entries are posted automatically by database triggers. You can view posted entries in the <span className="font-semibold text-foreground">Journal Entries</span> page under Accounting.
        </p>
      </div>
    </div>
  );
}
