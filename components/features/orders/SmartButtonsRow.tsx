'use client';

import React from 'react';
import { Package, Wrench, ClipboardList, FileText, ShoppingCart, Layers } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SmartButton {
  id: string;
  label: string;
  icon: React.ReactNode;
  count: number;
  variant?: 'default' | 'warning' | 'danger';
}

interface SmartButtonsRowProps {
  productCount: number;
  componentShortfallCount: number;
  jobCardCount: number;
  poCount: number;
  documentCount: number;
  issuedCount: number;
  onButtonClick: (sectionId: string) => void;
  activeSection?: string | null;
}

const variantStyles = {
  default: 'bg-muted/60 text-foreground hover:bg-muted',
  warning: 'bg-amber-500/15 text-amber-700 dark:text-amber-400 hover:bg-amber-500/25',
  danger: 'bg-red-500/15 text-red-700 dark:text-red-400 hover:bg-red-500/25',
};

export function SmartButtonsRow({
  productCount,
  componentShortfallCount,
  jobCardCount,
  poCount,
  documentCount,
  issuedCount,
  onButtonClick,
  activeSection,
}: SmartButtonsRowProps) {
  const buttons: SmartButton[] = [
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
      variant: componentShortfallCount > 0 ? 'danger' : 'default',
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
      variant: poCount > 0 ? 'warning' : 'default',
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
    <div className="flex items-center gap-2 flex-wrap">
      {buttons.map((btn) => {
        const isActive = activeSection === btn.id;
        const style = variantStyles[btn.variant || 'default'];

        return (
          <button
            key={btn.id}
            onClick={() => onButtonClick(btn.id)}
            className={cn(
              'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors cursor-pointer',
              style,
              isActive && 'ring-2 ring-primary ring-offset-1 ring-offset-background'
            )}
          >
            {btn.icon}
            {btn.label}
            <span className="ml-0.5 opacity-70">({btn.count})</span>
          </button>
        );
      })}
    </div>
  );
}
