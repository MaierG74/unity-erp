'use client';

import { ChevronRight, Loader2 } from 'lucide-react';

import { cn } from '@/lib/utils';

interface NextActionsSectionProps {
  reservePending: boolean;
  onReserveOrderComponents: () => void | Promise<void>;
  onGenerateCuttingPlan: () => void;
  onIssueStock: () => void;
  onCreateJobCards: () => void;
  isOpen: boolean;
  onToggle: () => void;
}

export function NextActionsSection({
  reservePending,
  onReserveOrderComponents,
  onGenerateCuttingPlan,
  onIssueStock,
  onCreateJobCards,
  isOpen,
  onToggle,
}: NextActionsSectionProps) {
  return (
    <section>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-5 py-3 text-left"
        aria-expanded={isOpen}
        aria-controls="setup-panel-actions-body"
      >
        <ChevronRight className={cn('h-3.5 w-3.5 text-muted-foreground/60 transition-transform', isOpen && 'rotate-90')} />
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Next actions</h3>
      </button>

      {isOpen && (
        <div id="setup-panel-actions-body" className="px-3 pb-3 space-y-1">
          <ActionRow
            title="Reserve order components"
            description="Earmark on-hand stock across the entire order so other orders can't claim it."
            loading={reservePending}
            disabled={reservePending}
            onClick={onReserveOrderComponents}
          />
          <ActionRow title="Generate cutting plan" description="Open the Cutting Plan tab to nest sheet boards and edging." onClick={onGenerateCuttingPlan} />
          <ActionRow title="Issue stock" description="Pick components or boards from stock against this order." onClick={onIssueStock} />
          <ActionRow title="Create job cards" description="Issue work-pool jobs to staff." onClick={onCreateJobCards} />
        </div>
      )}
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
