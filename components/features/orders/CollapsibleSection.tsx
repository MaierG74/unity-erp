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
}

export const CollapsibleSection = forwardRef<HTMLDivElement, CollapsibleSectionProps>(
  ({ id, title, icon, defaultOpen, open, onOpenChange, children, headerAction }, ref) => {
    return (
      <div ref={ref} id={id}>
        <Collapsible open={open} defaultOpen={defaultOpen} onOpenChange={onOpenChange}>
          <div className="rounded-lg border bg-card">
            <CollapsibleTrigger asChild>
              <button className="flex w-full items-center justify-between p-4 hover:bg-muted/50 transition-colors cursor-pointer">
                <div className="flex items-center gap-2">
                  {icon}
                  <span className="font-semibold text-sm">{title}</span>
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
