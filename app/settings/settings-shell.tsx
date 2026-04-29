'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import {
  Building2,
  Ruler,
  Scissors,
  FileText,
  DollarSign,
  Clock,
  Package,
  BadgeDollarSign,
} from 'lucide-react';

const NAV_GROUPS = [
  {
    label: 'GENERAL',
    items: [
      { href: '/settings/company', label: 'Company Details', icon: Building2 },
    ],
  },
  {
    label: 'PRODUCTION',
    items: [
      { href: '/settings/configurator', label: 'Configurator', icon: Ruler },
      { href: '/settings/cutlist', label: 'Cutlist', icon: Scissors },
    ],
  },
  {
    label: 'DOCUMENTS',
    items: [
      { href: '/settings/documents', label: 'Templates', icon: FileText },
    ],
  },
  {
    label: 'WORKFORCE',
    items: [
      { href: '/settings/payroll', label: 'Payroll', icon: DollarSign },
      { href: '/settings/piecework', label: 'Piecework', icon: BadgeDollarSign },
      { href: '/settings/schedules', label: 'Work Schedules', icon: Clock },
    ],
  },
  {
    label: 'INVENTORY',
    items: [
      { href: '/settings/finished-goods', label: 'Finished Goods', icon: Package },
    ],
  },
];

export default function SettingsShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="w-56 shrink-0 border-r bg-card py-6 px-3 space-y-6">
        <h2 className="px-3 text-sm font-semibold text-foreground">Settings</h2>
        {NAV_GROUPS.map((group) => (
          <div key={group.label}>
            <div className="px-3 mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {group.label}
            </div>
            <nav className="space-y-0.5">
              {group.items.map((item) => {
                const isActive = pathname === item.href || pathname?.startsWith(item.href + '/');
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      'flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors',
                      isActive
                        ? 'bg-accent text-accent-foreground font-medium'
                        : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                    )}
                  >
                    <item.icon className="h-4 w-4 shrink-0" />
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </div>
        ))}
      </aside>

      {/* Content */}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-6 py-8">
          {children}
        </div>
      </main>
    </div>
  );
}
