'use client';

import React from 'react';
import { Package, Wrench, ClipboardList, FileText, ShoppingCart, Layers } from 'lucide-react';
import { cn } from '@/lib/utils';

interface TabButton {
  id: string;
  label: string;
  icon: React.ReactNode;
  count: number;
  countVariant?: 'default' | 'warning' | 'danger';
}

interface SmartButtonsRowProps {
  productCount: number;
  componentShortfallCount: number;
  jobCardCount: number;
  poCount: number;
  documentCount: number;
  issuedCount: number;
  onTabChange: (tabId: string) => void;
  activeTab: string;
}

const countVariantStyles = {
  default: 'text-muted-foreground',
  warning: 'text-amber-600 dark:text-amber-400',
  danger: 'text-red-600 dark:text-red-400',
};

export function SmartButtonsRow({
  productCount,
  componentShortfallCount,
  jobCardCount,
  poCount,
  documentCount,
  issuedCount,
  onTabChange,
  activeTab,
}: SmartButtonsRowProps) {
  const tabs: TabButton[] = [
    {
      id: 'products',
      label: 'Products',
      icon: <Package className="h-3.5 w-3.5" />,
      count: productCount,
    },
    {
      id: 'components',
      label: 'Components',
      icon: <Layers className="h-3.5 w-3.5" />,
      count: componentShortfallCount,
      countVariant: componentShortfallCount > 0 ? 'danger' : 'default',
    },
    {
      id: 'job-cards',
      label: 'Job Cards',
      icon: <ClipboardList className="h-3.5 w-3.5" />,
      count: jobCardCount,
    },
    {
      id: 'procurement',
      label: 'Procurement',
      icon: <ShoppingCart className="h-3.5 w-3.5" />,
      count: poCount,
      countVariant: poCount > 0 ? 'warning' : 'default',
    },
    {
      id: 'documents',
      label: 'Documents',
      icon: <FileText className="h-3.5 w-3.5" />,
      count: documentCount,
    },
    {
      id: 'issue-stock',
      label: 'Issue Stock',
      icon: <Wrench className="h-3.5 w-3.5" />,
      count: issuedCount,
    },
  ];

  return (
    <div className="flex items-center gap-1 border-b overflow-x-auto">
      {tabs.map((tab) => {
        const isActive = activeTab === tab.id;
        const countStyle = countVariantStyles[tab.countVariant || 'default'];

        return (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={cn(
              'inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition-colors cursor-pointer whitespace-nowrap border-b-2 -mb-px',
              isActive
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/30'
            )}
          >
            {tab.icon}
            {tab.label}
            <span className={cn('ml-0.5 text-xs', isActive ? 'text-primary/70' : countStyle)}>
              ({tab.count})
            </span>
          </button>
        );
      })}
    </div>
  );
}
