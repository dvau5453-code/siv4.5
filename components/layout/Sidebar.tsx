'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { LayoutDashboard, Package, ShoppingCart, ShoppingBag, Users, FolderKanban, Truck, Calculator, Store, UserRound, ChartBar as BarChart3, Settings, Building2, ChevronDown, ChevronRight, FileText, Receipt, TrendingUp, Boxes, Shield, ArrowRightLeft, BookOpen } from 'lucide-react';

interface NavItem {
  title: string;
  href?: string;
  icon: React.ElementType;
  badge?: string;
  children?: { title: string; href: string }[];
}

const navItems: NavItem[] = [
  { title: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { title: 'Guide', href: '/guide', icon: BookOpen },
  {
    title: 'Inventory',
    icon: Package,
    children: [
      { title: 'Products', href: '/inventory' },
      { title: 'Stock Movements', href: '/inventory/movements' },
      { title: 'Stock Transfers', href: '/inventory/transfers' },
      { title: 'Warehouses', href: '/inventory/warehouses' },
    ],
  },
  {
    title: 'Sales',
    icon: ShoppingCart,
    children: [
      { title: 'Invoices', href: '/sales' },
      { title: 'POS', href: '/sales/pos' },
      { title: 'Returns', href: '/sales/returns' },
    ],
  },
  {
    title: 'Purchases',
    icon: ShoppingBag,
    children: [
      { title: 'Purchase Orders', href: '/purchases' },
      { title: 'Suppliers', href: '/suppliers' },
      { title: 'GRN', href: '/purchases/grn' },
      { title: 'Returns', href: '/purchases/returns' },
    ],
  },
  {
    title: 'CRM',
    icon: Users,
    children: [
      { title: 'Customers', href: '/crm' },
      { title: 'Quotations', href: '/quotations' },
    ],
  },
  { title: 'Projects', href: '/projects', icon: FolderKanban },
  { title: 'Delivery', href: '/delivery', icon: Truck },
  {
    title: 'Accounting',
    icon: Calculator,
    children: [
      { title: 'Overview', href: '/accounting' },
      { title: 'Chart of Accounts', href: '/accounting/accounts' },
      { title: 'Journal Entries', href: '/accounting/journal' },
      { title: 'Aging & Dues', href: '/accounting/aging' },
      { title: 'Payment Methods', href: '/accounting/payment-methods' },
      { title: 'JE Guide', href: '/accounting/journal-guide' },
    ],
  },
  { title: 'Expenses', href: '/expenses', icon: Receipt },
  { title: 'Online Store', href: '/online-store', icon: Store, badge: 'New' },
  { title: 'Employees', href: '/employees', icon: UserRound },
  {
    title: 'Reports',
    icon: BarChart3,
    children: [
      { title: 'Sales Report', href: '/reports' },
      { title: 'Inventory Report', href: '/reports/inventory' },
      { title: 'P&L Statement', href: '/reports/pl' },
    ],
  },
  { title: 'Settings', href: '/settings', icon: Settings },
];

export default function Sidebar() {
  const pathname = usePathname();
  const [openMenus, setOpenMenus] = useState<string[]>(['Inventory', 'Sales', 'Purchases', 'CRM']);

  function toggleMenu(title: string) {
    setOpenMenus((prev) =>
      prev.includes(title) ? prev.filter((t) => t !== title) : [...prev, title]
    );
  }

  function isActive(href: string) {
    return pathname === href || (href !== '/dashboard' && pathname.startsWith(href));
  }

  function isParentActive(item: NavItem) {
    if (item.href) return isActive(item.href);
    return item.children?.some((c) => isActive(c.href)) ?? false;
  }

  return (
    <aside className="w-[220px] min-h-screen flex flex-col sidebar-bg text-white shrink-0">
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-4 py-4 border-b border-white/10">
        <div className="w-8 h-8 bg-blue-500 rounded-lg flex items-center justify-center shrink-0">
          <Building2 className="w-4.5 h-4.5 text-white" />
        </div>
        <div className="min-w-0">
          <div className="text-white font-bold text-sm leading-tight truncate">SI Building</div>
          <div className="text-blue-300 text-[10px] font-medium">Solutions ERP</div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 py-3 overflow-y-auto sidebar-scroll px-2 space-y-0.5">
        {navItems.map((item) => {
          if (item.children) {
            const open = openMenus.includes(item.title);
            const parentActive = isParentActive(item);
            return (
              <div key={item.title}>
                <button
                  onClick={() => toggleMenu(item.title)}
                  className={cn(
                    'w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left transition-colors text-[13px] font-medium',
                    parentActive
                      ? 'text-white bg-white/10'
                      : 'text-slate-400 hover:text-white hover:bg-white/5'
                  )}
                >
                  <item.icon className="w-4 h-4 shrink-0" />
                  <span className="flex-1 truncate">{item.title}</span>
                  {open ? (
                    <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                  ) : (
                    <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
                  )}
                </button>
                {open && (
                  <div className="ml-7 mt-0.5 space-y-0.5 border-l border-white/10 pl-3">
                    {item.children.map((child) => (
                      <Link
                        key={child.href}
                        href={child.href}
                        className={cn(
                          'block px-2 py-1.5 rounded-md text-[12px] transition-colors truncate',
                          isActive(child.href)
                            ? 'text-white font-semibold bg-blue-600'
                            : 'text-slate-400 hover:text-white hover:bg-white/5'
                        )}
                      >
                        {child.title}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            );
          }

          return (
            <Link
              key={item.href}
              href={item.href!}
              className={cn(
                'flex items-center gap-2.5 px-2.5 py-2 rounded-lg transition-colors text-[13px] font-medium',
                isActive(item.href!)
                  ? 'text-white bg-blue-600'
                  : 'text-slate-400 hover:text-white hover:bg-white/5'
              )}
            >
              <item.icon className="w-4 h-4 shrink-0" />
              <span className="flex-1 truncate">{item.title}</span>
              {item.badge && (
                <span className="bg-blue-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full">
                  {item.badge}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Bottom promo */}
      <div className="p-3 border-t border-white/10">
        <div className="bg-blue-600/20 rounded-xl p-3 text-center">
          <p className="text-white text-[11px] font-semibold mb-0.5">Build More. Manage Better.</p>
          <p className="text-blue-300 text-[10px] leading-snug mb-2">
            Complete solution for your building materials business.
          </p>
          <Link
            href="/online-store"
            className="block bg-blue-500 hover:bg-blue-400 text-white text-[10px] font-semibold py-1.5 rounded-lg transition"
          >
            Go to Product Catalog →
          </Link>
        </div>
      </div>
    </aside>
  );
}
