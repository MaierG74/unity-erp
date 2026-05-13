'use client';

import { ChevronRight } from 'lucide-react';

import { cn } from '@/lib/utils';
import { formatQuantity } from '@/lib/format-utils';

interface OverviewSectionProps {
  ordered: number;
  reserved: number;
  toBuild: number;
  isOpen: boolean;
  onToggle: () => void;
}

export function OverviewSection({ ordered, reserved, toBuild, isOpen, onToggle }: OverviewSectionProps) {
  return (
    <section className="border-b border-border/60">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-5 py-3 text-left"
        aria-expanded={isOpen}
        aria-controls="setup-panel-overview-body"
      >
        <ChevronRight className={cn('h-3.5 w-3.5 text-muted-foreground/60 transition-transform', isOpen && 'rotate-90')} />
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Overview</h3>
      </button>

      {isOpen && (
        <div id="setup-panel-overview-body" className="px-5 pb-5 grid grid-cols-3 gap-4">
          <Metric label="Ordered" value={formatQuantity(ordered)} />
          <Metric label="Reserved" value={formatQuantity(reserved)} />
          <Metric label="To build" value={formatQuantity(toBuild)} emphasized />
        </div>
      )}
    </section>
  );
}

function Metric({ label, value, emphasized }: { label: string; value: string; emphasized?: boolean }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={cn('mt-1 tabular-nums', emphasized ? 'text-2xl font-semibold' : 'text-lg')}>
        {value}
      </p>
    </div>
  );
}
