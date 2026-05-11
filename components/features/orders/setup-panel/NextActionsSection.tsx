'use client';

import { ChevronRight, Loader2 } from 'lucide-react';

import { cn } from '@/lib/utils';

interface NextActionsSectionProps {
  reservePending: boolean;
  onReserveOrderComponents: () => void | Promise<void>;
  onGenerateCuttingPlan: () => void;
  onIssueStock: () => void;
  onCreateJobCards: () => void;
}

export function NextActionsSection({
  reservePending,
  onReserveOrderComponents,
  onGenerateCuttingPlan,
  onIssueStock,
  onCreateJobCards,
}: NextActionsSectionProps) {
  return (
    <section className="px-5 py-5">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
        Next actions
      </h3>

      <div className="space-y-1">
        <ActionRow
          title="Reserve order components"
          description="Earmark on-hand stock across the entire order so other orders can't claim it."
          loading={reservePending}
          disabled={reservePending}
          onClick={onReserveOrderComponents}
        />
        <ActionRow
          title="Generate cutting plan"
          description="Open the Cutting Plan tab to nest sheet boards and edging."
          onClick={onGenerateCuttingPlan}
        />
        <ActionRow
          title="Issue stock"
          description="Pick components or boards from stock against this order."
          onClick={onIssueStock}
        />
        <ActionRow
          title="Create job cards"
          description="Issue work-pool jobs to staff."
          onClick={onCreateJobCards}
        />
      </div>
    </section>
  );
}

function ActionRow({
  title,
  description,
  disabled,
  loading,
  onClick,
}: {
  title: string;
  description: string;
  disabled?: boolean;
  loading?: boolean;
  onClick: () => void | Promise<void>;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onClick()}
      className={cn(
        'group flex w-full items-center gap-3 rounded-sm border border-transparent px-3 py-2.5 text-left transition-colors',
        disabled ? 'opacity-50 cursor-not-allowed' : 'hover:border-border/60 hover:bg-muted/40'
      )}
    >
      <div className="flex-1 min-w-0">
        <p className="text-sm text-foreground">{title}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      ) : (
        <ChevronRight className={cn('h-4 w-4 text-muted-foreground/60 group-hover:text-muted-foreground', disabled && 'opacity-0')} />
      )}
    </button>
  );
}
