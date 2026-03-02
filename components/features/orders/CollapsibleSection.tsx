'use client';

import React, { forwardRef } from 'react';
import { ChevronDown } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';

interface CollapsibleSectionProps {
  id: string;
  title: string;
  icon: React.ReactNode;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
  headerAction?: React.ReactNode;
  isActive?: boolean;
}

export const CollapsibleSection = forwardRef<HTMLDivElement, CollapsibleSectionProps>(
  ({ id, title, icon, defaultOpen, open, onOpenChange, children, headerAction, isActive }, ref) => {
    return (
      <div ref={ref} id={id}>
        <Collapsible open={open} defaultOpen={defaultOpen} onOpenChange={onOpenChange}>
          <div className={cn(
            'rounded-lg border bg-card transition-colors',
            isActive && 'border-primary/40 ring-1 ring-primary/20'
          )}>
            <CollapsibleTrigger asChild>
              <button className={cn(
                'flex w-full items-center justify-between p-4 transition-colors cursor-pointer rounded-t-lg',
                isActive
                  ? 'bg-primary/8 hover:bg-primary/12'
                  : 'bg-muted/40 hover:bg-muted/60'
              )}>
                <div className="flex items-center gap-2">
                  <span className={cn(
                    '[&>svg]:h-4 [&>svg]:w-4',
                    isActive ? '[&>svg]:text-primary' : '[&>svg]:text-muted-foreground'
                  )}>
                    {icon}
                  </span>
                  <span className={cn(
                    'font-semibold text-sm',
                    isActive ? 'text-primary' : 'text-foreground'
                  )}>{title}</span>
                </div>
                <div className="flex items-center gap-2">
                  {headerAction && (
                    <div onClick={(e) => e.stopPropagation()}>{headerAction}</div>
                  )}
                  <ChevronDown
                    className={cn(
                      'h-4 w-4 text-muted-foreground transition-transform duration-200',
                      open && 'rotate-180'
                    )}
                  />
                </div>
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="border-t p-4">{children}</div>
            </CollapsibleContent>
          </div>
        </Collapsible>
      </div>
    );
  }
);

CollapsibleSection.displayName = 'CollapsibleSection';
