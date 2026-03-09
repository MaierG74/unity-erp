'use client';

import Link from 'next/link';
import {
  ClipboardList,
  Factory,
  FileText,
  PackagePlus,
  ShoppingBasket,
  SquareCheckBig,
  Truck,
} from 'lucide-react';

import { type DashboardPresetId } from '@/app/dashboard/dashboard-config';

type QuickAction = {
  label: string;
  href: string;
  icon: typeof FileText;
  colorClass: string;
};

const QUICK_ACTIONS: Record<DashboardPresetId, QuickAction[]> = {
  purchasing_clerk: [
    {
      label: 'New Purchase Order',
      href: '/purchasing/purchase-orders/new',
      icon: ShoppingBasket,
      colorClass: 'text-primary bg-primary/10 group-hover:bg-primary/20',
    },
    {
      label: 'Receive Stock',
      href: '/purchasing?filter=approved',
      icon: Truck,
      colorClass: 'text-warning bg-warning/10 group-hover:bg-warning/20',
    },
    {
      label: 'All Purchase Orders',
      href: '/purchasing/purchase-orders',
      icon: ClipboardList,
      colorClass: 'text-info bg-info/10 group-hover:bg-info/20',
    },
    {
      label: 'Task Inbox',
      href: '/todos',
      icon: SquareCheckBig,
      colorClass: 'text-success bg-success/10 group-hover:bg-success/20',
    },
  ],
  general_manager: [
    {
      label: 'New Order',
      href: '/orders/new',
      icon: FileText,
      colorClass: 'text-primary bg-primary/10 group-hover:bg-primary/20',
    },
    {
      label: 'Purchasing',
      href: '/purchasing',
      icon: ShoppingBasket,
      colorClass: 'text-warning bg-warning/10 group-hover:bg-warning/20',
    },
    {
      label: 'Task Inbox',
      href: '/todos',
      icon: SquareCheckBig,
      colorClass: 'text-success bg-success/10 group-hover:bg-success/20',
    },
    {
      label: 'Production View',
      href: '/production',
      icon: Factory,
      colorClass: 'text-info bg-info/10 group-hover:bg-info/20',
    },
  ],
  operations_lead: [
    {
      label: 'Orders Board',
      href: '/orders',
      icon: FileText,
      colorClass: 'text-primary bg-primary/10 group-hover:bg-primary/20',
    },
    {
      label: 'Inventory Reports',
      href: '/inventory?tab=reports',
      icon: PackagePlus,
      colorClass: 'text-warning bg-warning/10 group-hover:bg-warning/20',
    },
    {
      label: 'Task Inbox',
      href: '/todos',
      icon: SquareCheckBig,
      colorClass: 'text-success bg-success/10 group-hover:bg-success/20',
    },
    {
      label: 'Purchasing',
      href: '/purchasing',
      icon: ShoppingBasket,
      colorClass: 'text-info bg-info/10 group-hover:bg-info/20',
    },
  ],
};

interface DashboardQuickActionsProps {
  presetId: DashboardPresetId;
}

export function DashboardQuickActions({ presetId }: DashboardQuickActionsProps) {
  const quickActions = QUICK_ACTIONS[presetId];

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {quickActions.map((action) => (
        <Link
          key={action.label}
          href={action.href}
          className="group flex items-center gap-3 rounded-xl border bg-card p-3 transition-all duration-200 hover:shadow-md hover:shadow-primary/5"
        >
          <div className={`rounded-lg p-2.5 transition-colors ${action.colorClass}`}>
            <action.icon className="h-4 w-4" />
          </div>
          <span className="text-sm font-medium">{action.label}</span>
        </Link>
      ))}
    </div>
  );
}
