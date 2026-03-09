'use client';

import * as React from 'react';
import {
  ArrowLeft,
  Bot,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  Eye,
  ExternalLink,
  FileText,
  FolderOpen,
  Package,
  Loader2,
  Maximize2,
  Minimize2,
  SendHorizontal,
  Sparkles,
  X,
} from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';

import { authorizedFetch } from '@/lib/client/auth-fetch';
import {
  getAssistantScopeLabel,
  getAssistantSuggestions,
  type AssistantCard,
  type AssistantActionLink,
  type AssistantChartCard,
  type AssistantReply,
  type AssistantStatus,
  type AssistantTableCard,
} from '@/lib/assistant/prompt-suggestions';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type ChatMessage = {
  id: string;
  role: 'assistant' | 'user';
  content: string;
  status?: AssistantStatus;
  actions?: AssistantActionLink[];
  suggestions?: string[];
  card?: AssistantCard;
};

type AssistantOrderPreview = {
  orderId: number;
  orderNumber: string | null;
  customerName: string | null;
  orderDate: string | null;
  deliveryDate: string | null;
  statusName: string | null;
  quote: {
    id: string;
    quoteNumber: string | null;
  } | null;
  counts: {
    products: number;
    attachments: number;
    customerOrderDocs: number;
    jobCards: number;
    purchaseOrders: number;
    issuedItems: number;
  };
  products: Array<{
    name: string;
    quantity: number;
  }>;
  customerDocuments: Array<{
    id: number;
    name: string;
    uploadedAt: string | null;
    url: string | null;
  }>;
  recentDocuments: Array<{
    id: number;
    name: string;
    type: string | null;
    uploadedAt: string | null;
    url: string | null;
  }>;
};

type PanelWidth = 'compact' | 'wide' | 'focus';
type PreviewTransitionPhase = 'idle' | 'switching' | 'entering';

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const COMPACT_WIDTH = 480;
const WIDE_WIDTH = 672;
const FOCUS_WIDTH = 864;
const WIDE_WIDTH_SMALL_VIEWPORT = 552;
const FOCUS_WIDTH_SMALL_VIEWPORT = 696;
const SMALL_VIEWPORT_BREAKPOINT = 1400;
const MOBILE_BREAKPOINT = 768;
/** Auto-close if compact would exceed this fraction of viewport */
const CLOSE_PANEL_RATIO = 0.6;
/** Max fraction of viewport for focus mode */
const FOCUS_MAX_RATIO = 0.55;

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function buildWelcomeMessage(pathname: string | null): ChatMessage {
  const suggestions = getAssistantSuggestions(pathname);
  const scopeLabel = getAssistantScopeLabel(pathname);

  return {
    id: `assistant-welcome-${pathname ?? 'root'}`,
    role: 'assistant',
    status: 'welcome',
    content: `${scopeLabel}. Ask about Unity ERP data only. If I cannot verify an answer from trusted data, I will say "I don't know."`,
    suggestions,
  };
}

function getStatusTone(status?: AssistantStatus) {
  switch (status) {
    case 'out_of_scope':
      return 'border-amber-500/40 bg-amber-500/10';
    case 'tool_pending':
      return 'border-sky-500/40 bg-sky-500/10';
    case 'unknown':
      return 'border-muted bg-muted/50';
    default:
      return 'border-primary/20 bg-primary/10';
  }
}

function getCardTone(card: AssistantCard) {
  const title = card.title.toLowerCase();

  if (title.includes('inventory') || title.includes('stock')) {
    return {
      shell: 'border-emerald-200 bg-white shadow-[0_10px_28px_rgba(16,24,40,0.08)] dark:border-emerald-500/30 dark:bg-slate-900/80 dark:shadow-[0_12px_32px_rgba(0,0,0,0.18)]',
      header: 'border-emerald-200 bg-emerald-50 dark:border-emerald-500/25 dark:bg-emerald-500/20',
      metric: 'border-emerald-200/80 bg-white dark:border-emerald-500/20 dark:bg-emerald-500/10',
      row: 'border-emerald-100 even:bg-emerald-50/70 dark:border-emerald-500/10 dark:even:bg-emerald-500/5',
      footer: 'border-emerald-200 bg-emerald-50/80 dark:border-emerald-500/15 dark:bg-emerald-500/5',
      tableHead: 'bg-emerald-100/85 text-slate-600 dark:bg-emerald-500/12 dark:text-slate-300',
      bar: 'bg-emerald-500/70 dark:bg-emerald-500/60',
      barHover: 'hover:bg-emerald-500/85 dark:hover:bg-emerald-500/80',
    };
  }

  if (
    title.includes('supplier') ||
    title.includes('delivery') ||
    title.includes('eta') ||
    title.includes('purchase')
  ) {
    return {
      shell: 'border-amber-200 bg-white shadow-[0_10px_28px_rgba(16,24,40,0.08)] dark:border-amber-500/30 dark:bg-slate-900/80 dark:shadow-[0_12px_32px_rgba(0,0,0,0.18)]',
      header: 'border-amber-200 bg-amber-50 dark:border-amber-500/25 dark:bg-amber-500/20',
      metric: 'border-amber-200/80 bg-white dark:border-amber-500/20 dark:bg-amber-500/10',
      row: 'border-amber-100 even:bg-amber-50/70 dark:border-amber-500/10 dark:even:bg-amber-500/5',
      footer: 'border-amber-200 bg-amber-50/80 dark:border-amber-500/15 dark:bg-amber-500/5',
      tableHead: 'bg-amber-100/85 text-slate-600 dark:bg-amber-500/12 dark:text-slate-300',
      bar: 'bg-amber-500/70 dark:bg-amber-500/60',
      barHover: 'hover:bg-amber-500/85 dark:hover:bg-amber-500/80',
    };
  }

  if (
    title.includes('production') ||
    title.includes('manufacturing') ||
    title.includes('job card')
  ) {
    return {
      shell: 'border-fuchsia-200 bg-white shadow-[0_10px_28px_rgba(16,24,40,0.08)] dark:border-fuchsia-500/30 dark:bg-slate-900/80 dark:shadow-[0_12px_32px_rgba(0,0,0,0.18)]',
      header: 'border-fuchsia-200 bg-fuchsia-50 dark:border-fuchsia-500/25 dark:bg-fuchsia-500/20',
      metric: 'border-fuchsia-200/80 bg-white dark:border-fuchsia-500/20 dark:bg-fuchsia-500/10',
      row: 'border-fuchsia-100 even:bg-fuchsia-50/75 dark:border-fuchsia-500/10 dark:even:bg-fuchsia-500/5',
      footer: 'border-fuchsia-200 bg-fuchsia-50/80 dark:border-fuchsia-500/15 dark:bg-fuchsia-500/5',
      tableHead: 'bg-fuchsia-100/85 text-slate-600 dark:bg-fuchsia-500/12 dark:text-slate-300',
      bar: 'bg-fuchsia-500/70 dark:bg-fuchsia-500/60',
      barHover: 'hover:bg-fuchsia-500/85 dark:hover:bg-fuchsia-500/80',
    };
  }

  return {
    shell: 'border-slate-200 bg-white shadow-[0_10px_28px_rgba(16,24,40,0.08)] dark:border-cyan-500/30 dark:bg-slate-900/80 dark:shadow-[0_12px_32px_rgba(0,0,0,0.18)]',
    header: 'border-cyan-100 bg-cyan-50/75 dark:border-cyan-500/25 dark:bg-cyan-500/20',
    metric: 'border-slate-200 bg-slate-50 dark:border-cyan-500/20 dark:bg-cyan-500/10',
    row: 'border-slate-200 even:bg-slate-50/80 dark:border-slate-600/40 dark:even:bg-slate-700/20',
    footer: 'border-slate-200 bg-slate-50/90 dark:border-slate-600/40 dark:bg-slate-700/20',
    tableHead: 'bg-slate-100/90 text-slate-600 dark:bg-slate-700/30 dark:text-slate-300',
    bar: 'bg-cyan-500/70 dark:bg-cyan-500/60',
    barHover: 'hover:bg-cyan-500/85 dark:hover:bg-cyan-500/80',
  };
}

function renderCellValue(columnKey: string, value: string) {
  const normalizedKey = columnKey.toLowerCase();
  const normalizedValue = value.trim().toLowerCase();

  if (
    normalizedKey.includes('status') ||
    normalizedKey.includes('progress')
  ) {
    let badgeClass = 'border-border/60 bg-background/70 text-foreground';

    if (
      normalizedValue.includes('manufactured') ||
      normalizedValue.includes('completed') ||
      normalizedValue.includes('approved') ||
      normalizedValue.includes('on time')
    ) {
      badgeClass = 'border-emerald-400/30 bg-emerald-500/15 text-emerald-700 dark:text-emerald-100';
    } else if (
      normalizedValue.includes('in production') ||
      normalizedValue.includes('in progress') ||
      normalizedValue.includes('open')
    ) {
      badgeClass = 'border-sky-400/30 bg-sky-500/15 text-sky-700 dark:text-sky-100';
    } else if (
      normalizedValue.includes('late') ||
      normalizedValue.includes('unknown') ||
      normalizedValue.includes('no eta') ||
      normalizedValue.includes('unassigned')
    ) {
      badgeClass = 'border-amber-400/30 bg-amber-500/15 text-amber-700 dark:text-amber-100';
    }

    return (
      <Badge variant="outline" className={cn('font-normal', badgeClass)}>
        {value}
      </Badge>
    );
  }

  return value;
}

/** Extract an href from a card's actions or detail rows if the label matches */
function getPrimaryTableRowAction(
  card: AssistantTableCard,
  rowIndex: number
) {
  const rowActions = card.rowActions?.[rowIndex] ?? [];
  return rowActions[0] ?? null;
}

function getInlineTableRowActions(rowActions: AssistantActionLink[]) {
  const nonPreviewActions = rowActions.filter(action => action.kind !== 'preview_order');
  return nonPreviewActions.slice(0, 2);
}

function getActionVisual(action: AssistantActionLink) {
  const href = action.href ?? '';

  if (action.kind === 'ask') {
    return {
      icon: Bot,
      className: 'border-emerald-300/40 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/15 dark:border-emerald-300/25 dark:text-emerald-50',
    };
  }

  if (action.kind === 'preview_order') {
    return {
      icon: Eye,
      className: 'border-violet-300/40 bg-violet-500/10 text-violet-700 hover:bg-violet-500/15 dark:border-violet-300/25 dark:text-violet-50',
    };
  }

  if (href.startsWith('/quotes/')) {
    return {
      icon: FileText,
      className: 'border-amber-300/40 bg-amber-500/10 text-amber-700 hover:bg-amber-500/15 dark:border-amber-300/25 dark:text-amber-50',
    };
  }

  if (href.includes('tab=documents')) {
    return {
      icon: FolderOpen,
      className: 'border-sky-300/40 bg-sky-500/10 text-sky-700 hover:bg-sky-500/15 dark:border-sky-300/25 dark:text-sky-50',
    };
  }

  return {
    icon: ExternalLink,
    className: 'border-slate-300/40 bg-slate-500/5 text-slate-600 hover:bg-slate-500/10 dark:border-white/15 dark:bg-white/5 dark:text-foreground dark:hover:bg-white/10',
  };
}

/* ------------------------------------------------------------------ */
/*  Resolve panel width from preference + viewport                     */
/* ------------------------------------------------------------------ */

function resolveWidth(preference: PanelWidth, viewportWidth: number): number | 'closed' {
  const compactPx = COMPACT_WIDTH;
  const widePx = viewportWidth < SMALL_VIEWPORT_BREAKPOINT ? WIDE_WIDTH_SMALL_VIEWPORT : WIDE_WIDTH;
  const focusPx = viewportWidth < SMALL_VIEWPORT_BREAKPOINT ? FOCUS_WIDTH_SMALL_VIEWPORT : FOCUS_WIDTH;
  const maxFocusPx = Math.floor(viewportWidth * FOCUS_MAX_RATIO);

  if (compactPx > viewportWidth * CLOSE_PANEL_RATIO) {
    return 'closed';
  }

  if (preference === 'focus') {
    return Math.min(focusPx, maxFocusPx);
  }

  if (preference === 'wide') {
    return Math.min(widePx, maxFocusPx);
  }

  return compactPx;
}

/* ------------------------------------------------------------------ */
/*  Card renderers                                                     */
/* ------------------------------------------------------------------ */

function CardShell({
  card,
  children,
}: {
  card: AssistantCard;
  children: React.ReactNode;
}) {
  const [expandedMetricLabel, setExpandedMetricLabel] = React.useState<string | null>(null);
  const tone = getCardTone(card);
  const metricColumnCount =
    card.metrics && card.metrics.length > 0
      ? Math.min(Math.max(card.metrics.length, 1), 4)
      : 0;
  const expandedMetric =
    card.metrics?.find(metric => metric.label === expandedMetricLabel && metric.details?.length) ?? null;

  return (
    <div className={cn('mt-3 overflow-hidden rounded-xl border shadow-[0_12px_32px_rgba(0,0,0,0.18)]', tone.shell)}>
      <div className={cn('border-b px-3 py-2', tone.header)}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs font-semibold text-foreground dark:text-white">{card.title}</div>
            {card.description ? (
              <div className="mt-0.5 text-[11px] text-muted-foreground dark:text-slate-400">{card.description}</div>
            ) : null}
          </div>
          <Badge variant="outline" className="border-white/10 bg-black/10 text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
            Live
          </Badge>
        </div>
      </div>

      {card.metrics && card.metrics.length > 0 ? (
        <div
          className="grid gap-1.5 border-b px-2.5 py-2"
          style={{ gridTemplateColumns: `repeat(${metricColumnCount}, minmax(0, 1fr))` }}
        >
          {card.metrics.map(metric => {
            const isInteractive = Boolean(metric.details?.length);
            const isExpanded = expandedMetricLabel === metric.label && isInteractive;
            const Icon = isExpanded ? ChevronUp : ChevronDown;

            if (isInteractive) {
              return (
                <button
                  key={metric.label}
                  type="button"
                  onClick={() => {
                    setExpandedMetricLabel(current => (current === metric.label ? null : metric.label));
                  }}
                  className={cn(
                    'rounded-lg border px-2 py-1.5 text-left transition-colors hover:bg-white/10',
                    tone.metric,
                    isExpanded ? 'ring-1 ring-white/20' : null
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{metric.label}</div>
                    <Icon className="mt-0.5 h-3 w-3 text-muted-foreground" />
                  </div>
                  <div className="mt-0.5 text-xs font-semibold tabular-nums text-foreground">{metric.value}</div>
                  <div className="mt-1 text-[10px] text-muted-foreground">
                    {isExpanded ? 'Hide details' : 'View details'}
                  </div>
                </button>
              );
            }

            return (
              <div key={metric.label} className={cn('rounded-lg border px-2 py-1.5', tone.metric)}>
                <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{metric.label}</div>
                <div className="mt-0.5 text-xs font-semibold tabular-nums text-foreground">{metric.value}</div>
              </div>
            );
          })}
        </div>
      ) : null}

      {expandedMetric ? (
        <div className="border-b px-3 py-2">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {expandedMetric.detailTitle ?? `${expandedMetric.label} details`}
          </div>
          <div className="space-y-1">
            {expandedMetric.details?.map(detail => (
              <div
                key={`${card.title}-${expandedMetric.label}-${detail.label}`}
                className="flex items-center justify-between gap-3 rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-[11px]"
              >
                <span className="text-foreground/90">{detail.label}</span>
                <span className="tabular-nums text-muted-foreground">{detail.value}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {children}

      {card.footer ? (
        <div className={cn('border-t px-3 py-1.5 text-[10px] text-muted-foreground', tone.footer)}>
          {card.footer}
        </div>
      ) : null}
    </div>
  );
}

function ClickableRow({
  href,
  children,
  className,
  onNavigate,
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
  onNavigate: (href: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onNavigate(href)}
      className={cn(
        'w-full text-left transition-colors hover:bg-white/8 cursor-pointer',
        className
      )}
    >
      {children}
    </button>
  );
}

function CardActions({
  actions,
  onAction,
}: {
  actions: AssistantActionLink[];
  onAction: (action: AssistantActionLink) => void;
}) {
  if (actions.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-1.5 border-t border-border/40 px-2.5 py-2">
      {actions.map(action => {
        const visual = getActionVisual(action);
        const Icon = visual.icon;

        return (
          <button
            key={`card-action-${action.label}-${action.href ?? action.prompt ?? action.orderId ?? ''}`}
            type="button"
            onClick={() => onAction(action)}
            className={cn(
              'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-medium transition-colors',
              visual.className
            )}
          >
            <Icon className="h-2.5 w-2.5" />
            <span>{action.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function MessageActions({
  actions,
  onAction,
}: {
  actions: AssistantActionLink[];
  onAction: (action: AssistantActionLink) => void;
}) {
  if (actions.length === 0) {
    return null;
  }

  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {actions.map(action => {
        const visual = getActionVisual(action);
        const Icon = visual.icon;

        return (
          <button
            key={`message-action-${action.label}-${action.href ?? action.prompt ?? action.orderId ?? ''}`}
            type="button"
            onClick={() => onAction(action)}
            className={cn(
              'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-medium transition-colors',
              visual.className
            )}
          >
            <Icon className="h-2.5 w-2.5" />
            <span>{action.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function TableCardContent({
  card,
  onAction,
}: {
  card: AssistantTableCard;
  onAction: (action: AssistantActionLink) => void;
}) {
  const tone = getCardTone(card);

  return (
    <CardShell card={card}>
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-xs">
          <thead className={tone.tableHead}>
            <tr>
              {card.columns.map(column => (
                <th
                  key={column.key}
                  className={cn(
                    'px-2.5 py-1.5 text-[10px] font-medium',
                    column.align === 'right' ? 'text-right' : 'text-left'
                  )}
                >
                  {column.label}
                </th>
              ))}
              {card.rowActions?.some(actions => actions.length > 0) ? (
                <th className="px-2.5 py-1.5 text-left text-[10px] font-medium">Actions</th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {card.rows.map((row, rowIndex) => {
              const rowAction = getPrimaryTableRowAction(card, rowIndex);
              const rowActions = card.rowActions?.[rowIndex] ?? [];
              const inlineActions = getInlineTableRowActions(rowActions);
              const hiddenActionCount = Math.max(rowActions.length - inlineActions.length - (rowActions.some(action => action.kind === 'preview_order') ? 1 : 0), 0);
              const rowContent = card.columns.map(column => (
                <td
                  key={column.key}
                  className={cn(
                    'px-2.5 py-1.5 text-foreground/90',
                    column.align === 'right' ? 'text-right tabular-nums' : 'text-left'
                  )}
                >
                  {renderCellValue(column.key, row[column.key] ?? '—')}
                </td>
              ));
              const actionCell =
                card.rowActions?.some(actions => actions.length > 0) ? (
                  <td className="px-2.5 py-1.5">
                    <div className="flex flex-wrap items-center gap-1">
                      {inlineActions.map(action => {
                        const visual = getActionVisual(action);
                        const Icon = visual.icon;

                        return (
                          <button
                            key={`${card.title}-${rowIndex}-${action.label}`}
                            type="button"
                            onClick={event => {
                              event.stopPropagation();
                              onAction(action);
                            }}
                            className={cn(
                              'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors',
                              visual.className
                            )}
                          >
                            <Icon className="h-2.5 w-2.5" />
                            <span>{action.label}</span>
                          </button>
                        );
                      })}
                      {hiddenActionCount > 0 && rowAction ? (
                        <button
                          type="button"
                          onClick={event => {
                            event.stopPropagation();
                            onAction(rowAction);
                          }}
                          className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground"
                        >
                          <span>+{hiddenActionCount} more</span>
                        </button>
                      ) : null}
                    </div>
                  </td>
                ) : null;

              if (rowAction) {
                return (
                  <tr
                    key={`${card.title}-${rowIndex}`}
                    className={cn('border-t cursor-pointer transition-colors hover:bg-white/8', tone.row)}
                    onClick={() => onAction(rowAction)}
                  >
                    {rowContent}
                    {actionCell}
                  </tr>
                );
              }

              return (
                <tr key={`${card.title}-${rowIndex}`} className={cn('border-t', tone.row)}>
                  {rowContent}
                  {actionCell}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </CardShell>
  );
}

function ChartCardContent({
  card,
  onAction,
}: {
  card: AssistantChartCard;
  onAction: (action: AssistantActionLink) => void;
}) {
  const tone = getCardTone(card);
  const maxValue = Math.max(...card.points.map(point => point.value), 1);

  return (
    <CardShell card={card}>
      <div className="px-2.5 py-2">
        {/* Bar chart — compact */}
        <div className="flex h-20 items-end gap-1">
          {card.points.map(point => {
            const hasValue = point.value > 0;
            const heightPercent = hasValue ? Math.max((point.value / maxValue) * 100, 15) : 6;

            return (
              <div key={`${card.title}-${point.label}`} className="flex min-w-0 flex-1 flex-col items-center gap-1">
                <div className="text-[10px] font-medium tabular-nums text-foreground/80">
                  {hasValue ? point.value : ''}
                </div>
                <div
                  className={cn(
                    'w-full rounded-sm transition-all',
                    hasValue ? tone.bar : 'bg-white/5'
                  )}
                  style={{ height: `${heightPercent}%` }}
                />
                <div className="text-[9px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
                  {point.label}
                </div>
              </div>
            );
          })}
        </div>

        {/* Detail rows — clickable */}
        {card.details && card.details.length > 0 ? (
          <div className="mt-2 space-y-0.5 border-t border-border/40 pt-2">
            {card.details.map((detail, idx) => {
              const action = card.actions?.[idx] ?? null;

              if (action) {
                return (
                  <ClickableRow
                    key={`${card.title}-${detail.label}`}
                    href={action.href ?? '#'}
                    onNavigate={() => onAction(action)}
                    className="flex items-center justify-between gap-2 rounded px-1.5 py-1 text-[11px]"
                  >
                    <span className="font-medium text-foreground">{detail.label}</span>
                    <span className="text-right text-muted-foreground truncate">{detail.value}</span>
                  </ClickableRow>
                );
              }

              return (
                <div key={`${card.title}-${detail.label}`} className="flex items-center justify-between gap-2 px-1.5 py-1 text-[11px]">
                  <span className="text-muted-foreground">{detail.label}</span>
                  <span className="text-right text-foreground/90">{detail.value}</span>
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
      {card.actions ? <CardActions actions={card.actions} onAction={onAction} /> : null}
    </CardShell>
  );
}

function AssistantCardRenderer({
  card,
  onAction,
}: {
  card: AssistantCard;
  onAction: (action: AssistantActionLink) => void;
}) {
  if (card.type === 'table') {
    return <TableCardContent card={card} onAction={onAction} />;
  }

  if (card.type === 'chart') {
    return <ChartCardContent card={card} onAction={onAction} />;
  }

  return null;
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export function AssistantDock({ enabled }: { enabled: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [input, setInput] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [messages, setMessages] = React.useState<ChatMessage[]>(() => [buildWelcomeMessage(null)]);
  const [widthPreference, setWidthPreference] = React.useState<PanelWidth>('compact');
  const [userOverrodeWidth, setUserOverrodeWidth] = React.useState(false);
  const [orderPreview, setOrderPreview] = React.useState<AssistantOrderPreview | null>(null);
  const [previewLoading, setPreviewLoading] = React.useState(false);
  const [previewError, setPreviewError] = React.useState<string | null>(null);
  const [previewTransitionPhase, setPreviewTransitionPhase] =
    React.useState<PreviewTransitionPhase>('idle');
  const [viewportWidth, setViewportWidth] = React.useState(
    typeof window !== 'undefined' ? window.innerWidth : 1440
  );
  const lastAssistantMessageRef = React.useRef<HTMLDivElement | null>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);
  const navigatedFromPanel = React.useRef(false);
  const previewTransitionTimerRef = React.useRef<number | null>(null);

  // Track viewport width
  React.useEffect(() => {
    function onResize() {
      setViewportWidth(window.innerWidth);
    }
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Auto-close when viewport is too narrow
  React.useEffect(() => {
    if (!open) return;
    const resolved = resolveWidth(widthPreference, viewportWidth);
    if (resolved === 'closed') {
      setOpen(false);
    }
  }, [viewportWidth, open, widthPreference]);

  // Reset messages when pathname changes — unless we navigated from inside the panel
  React.useEffect(() => {
    if (navigatedFromPanel.current) {
      navigatedFromPanel.current = false;
      return;
    }
    setMessages([buildWelcomeMessage(pathname)]);
    setInput('');
    setWidthPreference('compact');
    setUserOverrodeWidth(false);
    setOrderPreview(null);
    setPreviewLoading(false);
    setPreviewError(null);
    setPreviewTransitionPhase('idle');
  }, [pathname]);

  React.useEffect(() => {
    return () => {
      if (previewTransitionTimerRef.current != null) {
        window.clearTimeout(previewTransitionTimerRef.current);
      }
    };
  }, []);

  // Close when disabled
  React.useEffect(() => {
    if (!enabled) setOpen(false);
  }, [enabled]);

  // Auto-scroll to latest assistant message
  React.useEffect(() => {
    const lastMessage = messages[messages.length - 1];
    if (!open || !lastMessage || lastMessage.role !== 'assistant') return;
    lastAssistantMessageRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [messages, open]);

  // Keyboard shortcuts
  React.useEffect(() => {
    if (!enabled) return;

    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'j') {
        event.preventDefault();
        setOpen(prev => !prev);
      }
      if (event.key === 'Escape' && open) {
        setOpen(false);
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled, open]);

  // Focus textarea when panel opens
  React.useEffect(() => {
    if (open) {
      setTimeout(() => textareaRef.current?.focus(), 250);
    }
  }, [open]);

  const handleNavigate = React.useCallback(
    (href: string) => {
      navigatedFromPanel.current = true;
      router.push(href);
    },
    [router]
  );

  const openOrderPreview = React.useCallback(
    async (orderId: number) => {
      if (orderPreview?.orderId === orderId && !previewLoading) {
        return;
      }

      const switchingFromExistingPreview =
        Boolean(orderPreview) && orderPreview?.orderId !== orderId;

      if (previewTransitionTimerRef.current != null) {
        window.clearTimeout(previewTransitionTimerRef.current);
        previewTransitionTimerRef.current = null;
      }

      setPreviewError(null);
      setPreviewLoading(true);
      setPreviewTransitionPhase(switchingFromExistingPreview ? 'switching' : 'idle');

      try {
        const res = await authorizedFetch(`/api/assistant/tools/orders/preview?orderId=${orderId}`);
        const payload = (await res.json().catch(() => null)) as AssistantOrderPreview | { error?: string } | null;

        if (!res.ok || !payload || !('orderId' in payload)) {
          throw new Error(
            payload && 'error' in payload && typeof payload.error === 'string'
              ? payload.error
              : 'Failed to load order preview'
          );
        }

        setOrderPreview(payload);
        if (switchingFromExistingPreview) {
          setPreviewTransitionPhase('entering');
          previewTransitionTimerRef.current = window.setTimeout(() => {
            setPreviewTransitionPhase('idle');
            previewTransitionTimerRef.current = null;
          }, 30);
        } else {
          setPreviewTransitionPhase('idle');
        }
      } catch (error) {
        setPreviewError(error instanceof Error ? error.message : 'Failed to load order preview');
        setPreviewTransitionPhase('idle');
      } finally {
        setPreviewLoading(false);
      }
    },
    [orderPreview, previewLoading]
  );

  const submitPrompt = React.useCallback(
    async (rawPrompt: string) => {
      const prompt = rawPrompt.trim();
      if (!prompt || submitting) return;

      const userMessage: ChatMessage = {
        id: `user-${Date.now()}`,
        role: 'user',
        content: prompt,
      };

      setMessages(prev => [...prev, userMessage]);
      setInput('');
      setSubmitting(true);

      try {
        const res = await authorizedFetch('/api/assistant', {
          method: 'POST',
          body: JSON.stringify({
            message: prompt,
            pathname,
            history: messages.slice(-8).map(message => ({
              role: message.role,
              content: message.content,
              cardTitle: message.card?.title,
            })),
            context: orderPreview
              ? {
                  activeOrder: {
                    orderId: orderPreview.orderId,
                    orderNumber: orderPreview.orderNumber,
                    customerName: orderPreview.customerName,
                  },
                }
              : undefined,
          }),
        });

        const payload = (await res.json().catch(() => null)) as AssistantReply | { error?: string } | null;

        if (!res.ok || !payload || !('message' in payload)) {
          throw new Error(
            payload && 'error' in payload && typeof payload.error === 'string'
              ? payload.error
              : 'Assistant request failed'
          );
        }

        const assistantMessage: ChatMessage = {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: payload.message,
          status: payload.status,
          actions: payload.actions,
          suggestions: payload.suggestions,
          card: payload.card,
        };

        setMessages(prev => [...prev, assistantMessage]);

        // Auto-expand panel when a card with data arrives
        if (payload.card && !userOverrodeWidth) {
          setWidthPreference('wide');
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Assistant request failed';
        setMessages(prev => [
          ...prev,
          {
            id: `assistant-error-${Date.now()}`,
            role: 'assistant',
            status: 'unknown',
            content: `I don't know right now because the assistant request failed. ${message}`,
            suggestions: getAssistantSuggestions(pathname),
          },
        ]);
      } finally {
        setSubmitting(false);
      }
    },
    [messages, orderPreview, pathname, submitting]
  );

  const handleAssistantAction = React.useCallback(
    (action: AssistantActionLink) => {
      if (action.kind === 'ask' && action.prompt) {
        void submitPrompt(action.prompt);
        return;
      }

      if (action.kind === 'preview_order' && action.orderId) {
        void openOrderPreview(action.orderId);
        return;
      }

      if (action.href) {
        handleNavigate(action.href);
      }
    },
    [handleNavigate, openOrderPreview, submitPrompt]
  );

  if (!enabled) return null;

  const isMobile = viewportWidth < MOBILE_BREAKPOINT;
  const resolvedWidth = resolveWidth(widthPreference, viewportWidth);
  const panelPx = resolvedWidth === 'closed' ? COMPACT_WIDTH : resolvedWidth;

  const fabPositionClass =
    process.env.NODE_ENV === 'development'
      ? 'bottom-20 right-4 md:bottom-24 md:right-6'
      : 'bottom-4 right-4 md:bottom-6 md:right-6';

  return (
    <>
      {/* Mobile backdrop */}
      {open && isMobile ? (
        <div
          className="fixed inset-0 z-40 bg-black/50"
          onClick={() => setOpen(false)}
        />
      ) : null}

      {/* Side panel */}
      <div
        className={cn(
          'fixed top-0 right-0 z-50 flex h-full flex-col border-l bg-slate-50 shadow-[-4px_0_24px_rgba(0,0,0,0.08)] transition-transform duration-200 ease-out dark:border-slate-600/50 dark:bg-slate-800 dark:shadow-[-4px_0_24px_rgba(0,0,0,0.35)]',
          open ? 'translate-x-0' : 'translate-x-full',
          isMobile && 'w-full'
        )}
        style={!isMobile ? { width: `${panelPx}px` } : undefined}
      >
        {/* Header */}
        <div className="shrink-0 border-b border-border/60 px-3 py-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <Bot className="h-4 w-4 shrink-0 text-primary" />
                <span className="text-sm font-semibold text-foreground truncate">Unity Assistant</span>
                <Badge variant="secondary" className="gap-0.5 text-[10px] px-1.5 py-0">
                  <Sparkles className="h-2.5 w-2.5" />
                  Proto
                </Badge>
              </div>
              <div className="mt-0.5 text-[11px] text-muted-foreground truncate">
                {getAssistantScopeLabel(pathname)}
                <span className="ml-2 text-muted-foreground/60">Cmd+J</span>
              </div>
            </div>
            <div className="flex items-center gap-1">
              {!isMobile ? (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => {
                    setUserOverrodeWidth(true);
                    setWidthPreference(prev => {
                      if (prev === 'compact') return 'wide';
                      if (prev === 'wide') return 'focus';
                      return 'compact';
                    });
                  }}
                  aria-label={
                    widthPreference === 'compact' ? 'Expand panel' :
                    widthPreference === 'wide' ? 'Focus mode' : 'Compact panel'
                  }
                >
                  {widthPreference === 'focus' ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
                </Button>
              ) : null}
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => setOpen(false)}
                aria-label="Close assistant"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </div>

        {/* Messages */}
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 space-y-2.5 overflow-y-auto p-3 pb-2">
            {messages.map((message, index) => (
              <div
                key={message.id}
                ref={index === messages.length - 1 && message.role === 'assistant' ? lastAssistantMessageRef : null}
                className={cn(
                  'rounded-lg border px-2.5 py-2 text-xs shadow-sm',
                  message.role === 'user'
                    ? 'ml-6 border-primary/20 bg-primary/15 text-foreground'
                    : cn('mr-2', getStatusTone(message.status))
                )}
              >
                <div className="mb-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                  {message.role === 'user' ? 'You' : 'Assistant'}
                </div>
                <p className="whitespace-pre-wrap leading-5">{message.content}</p>

                {message.role === 'assistant' && message.card ? (
                  <AssistantCardRenderer card={message.card} onAction={handleAssistantAction} />
                ) : null}

                {message.role === 'assistant' && message.actions && message.actions.length > 0 ? (
                  <MessageActions actions={message.actions} onAction={handleAssistantAction} />
                ) : null}

                {message.role === 'assistant' && message.suggestions && message.suggestions.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {message.suggestions.slice(0, 3).map(suggestion => (
                      <button
                        key={suggestion}
                        type="button"
                        onClick={() => { setInput(suggestion); textareaRef.current?.focus(); }}
                        className="rounded-full border border-border bg-background px-2.5 py-0.5 text-left text-[11px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}

            {submitting ? (
              <div className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Thinking...
              </div>
            ) : null}
          </div>

          {/* Input area */}
          <div className="shrink-0 border-t border-border/60 p-3 pt-2.5">
            {orderPreview || previewLoading || previewError ? (
              <div className="mb-2 overflow-hidden rounded-xl border border-violet-300/20 bg-violet-500/8">
                <div className="flex items-center justify-between border-b border-violet-300/15 px-3 py-2">
                  <div className="min-w-0">
                    <div className="text-[11px] font-semibold text-foreground">
                      {orderPreview
                        ? orderPreview.orderNumber || `Order ${orderPreview.orderId}`
                        : 'Order preview'}
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      {orderPreview?.customerName || 'Loading order context'}
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-[10px]"
                    onClick={() => {
                      if (previewTransitionTimerRef.current != null) {
                        window.clearTimeout(previewTransitionTimerRef.current);
                        previewTransitionTimerRef.current = null;
                      }
                      setOrderPreview(null);
                      setPreviewError(null);
                      setPreviewLoading(false);
                      setPreviewTransitionPhase('idle');
                    }}
                  >
                    <ArrowLeft className="mr-1 h-3 w-3" />
                    Back
                  </Button>
                </div>

                {!orderPreview && previewLoading ? (
                  <div className="flex items-center gap-2 px-3 py-3 text-xs text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Loading order preview...
                  </div>
                ) : previewError && !orderPreview ? (
                  <div className="px-3 py-3 text-xs text-amber-100">{previewError}</div>
                ) : orderPreview ? (
                  <div className="relative">
                    {previewLoading ? (
                      <div className="absolute inset-0 z-10 flex items-center justify-center rounded-b-xl bg-slate-950/18 backdrop-blur-[1px]">
                        <div className="inline-flex items-center gap-2 rounded-full border border-violet-300/20 bg-slate-950/75 px-3 py-1.5 text-[11px] text-violet-50 shadow-lg">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          Loading next order…
                        </div>
                      </div>
                    ) : null}
                    {previewError ? (
                      <div className="border-b border-violet-300/15 px-3 py-2 text-[11px] text-amber-100">
                        {previewError}
                      </div>
                    ) : null}
                    <div
                      className={cn(
                        'space-y-2 p-3 text-xs transition-all duration-200 ease-out',
                        previewTransitionPhase === 'idle'
                          ? 'translate-y-0 scale-100 opacity-100'
                          : 'translate-y-1 scale-[0.995] opacity-60'
                      )}
                    >
                    <div className="grid grid-cols-3 gap-1.5">
                      <div className="rounded-lg border border-violet-300/15 bg-background/35 px-2 py-1.5">
                        <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Status</div>
                        <div className="mt-0.5 font-semibold text-foreground">{orderPreview.statusName || 'Not set'}</div>
                      </div>
                      <div className="rounded-lg border border-violet-300/15 bg-background/35 px-2 py-1.5">
                        <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Delivery</div>
                        <div className="mt-0.5 font-semibold text-foreground">{orderPreview.deliveryDate || 'No date'}</div>
                      </div>
                      <div className="rounded-lg border border-violet-300/15 bg-background/35 px-2 py-1.5">
                        <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Quote</div>
                        <div className="mt-0.5 font-semibold text-foreground">{orderPreview.quote?.quoteNumber || 'No linked quote'}</div>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-1.5">
                      <Button
                        type="button"
                        size="sm"
                        className="h-7 px-2 text-[10px]"
                        onClick={() => handleNavigate(`/orders/${orderPreview.orderId}`)}
                      >
                        <ExternalLink className="mr-1 h-3 w-3" />
                        Open order
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-[10px]"
                        onClick={() => handleNavigate(`/orders/${orderPreview.orderId}?tab=documents`)}
                      >
                        <FolderOpen className="mr-1 h-3 w-3" />
                        Documents
                      </Button>
                      {orderPreview.quote ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 text-[10px]"
                          onClick={() => handleNavigate(`/quotes/${orderPreview.quote?.id}`)}
                        >
                          <FileText className="mr-1 h-3 w-3" />
                          Quote
                        </Button>
                      ) : null}
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-[10px]"
                        onClick={() =>
                          void submitPrompt(
                            `What products are on order ${orderPreview.orderNumber || orderPreview.orderId}?`
                          )
                        }
                      >
                        <Package className="mr-1 h-3 w-3" />
                        Products
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-[10px]"
                        onClick={() =>
                          void submitPrompt(
                            `What job cards are on order ${orderPreview.orderNumber || orderPreview.orderId}?`
                          )
                        }
                      >
                        <ClipboardList className="mr-1 h-3 w-3" />
                        Job cards
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-[10px]"
                        onClick={() =>
                          void submitPrompt(
                            `What is blocking order ${orderPreview.orderNumber || orderPreview.orderId}?`
                          )
                        }
                      >
                        <FolderOpen className="mr-1 h-3 w-3" />
                        Outstanding parts
                      </Button>
                    </div>

                    <div className="grid grid-cols-4 gap-1.5">
                      <div className="rounded-lg border border-violet-300/15 bg-background/35 px-2 py-1.5">
                        <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Products</div>
                        <div className="mt-0.5 font-semibold text-foreground">{orderPreview.counts.products}</div>
                      </div>
                      <div className="rounded-lg border border-violet-300/15 bg-background/35 px-2 py-1.5">
                        <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Client docs</div>
                        <div className="mt-0.5 font-semibold text-foreground">{orderPreview.counts.customerOrderDocs}</div>
                      </div>
                      <div className="rounded-lg border border-violet-300/15 bg-background/35 px-2 py-1.5">
                        <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Job cards</div>
                        <div className="mt-0.5 font-semibold text-foreground">{orderPreview.counts.jobCards}</div>
                      </div>
                      <div className="rounded-lg border border-violet-300/15 bg-background/35 px-2 py-1.5">
                        <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">PO links</div>
                        <div className="mt-0.5 font-semibold text-foreground">{orderPreview.counts.purchaseOrders}</div>
                      </div>
                    </div>

                    <div className="grid gap-2 md:grid-cols-2">
                      <div className="rounded-lg border border-violet-300/15 bg-background/30 p-2">
                        <div className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                          <Package className="h-3 w-3" />
                          Products
                        </div>
                        <div className="space-y-1">
                          {orderPreview.products.length > 0 ? orderPreview.products.map(product => (
                            <div key={`${orderPreview.orderId}-${product.name}`} className="flex items-center justify-between gap-2 text-[11px]">
                              <span className="truncate text-foreground">{product.name}</span>
                              <span className="tabular-nums text-muted-foreground">x{product.quantity}</span>
                            </div>
                          )) : (
                            <div className="text-[11px] text-muted-foreground">No product lines loaded.</div>
                          )}
                        </div>
                      </div>

                      <div className="rounded-lg border border-violet-300/15 bg-background/30 p-2">
                        <div className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                          <ClipboardList className="h-3 w-3" />
                          Client docs
                        </div>
                        <div className="space-y-1">
                          {orderPreview.customerDocuments.length > 0 ? orderPreview.customerDocuments.map(document => (
                            <button
                              key={document.id}
                              type="button"
                              onClick={() => document.url ? window.open(document.url, '_blank', 'noopener,noreferrer') : undefined}
                              className="flex w-full items-center justify-between gap-2 rounded px-1.5 py-1 text-left text-[11px] transition-colors hover:bg-white/8"
                            >
                              <span className="truncate text-foreground">{document.name}</span>
                              <span className="shrink-0 text-muted-foreground">{document.uploadedAt || 'Date unknown'}</span>
                            </button>
                          )) : (
                            <div className="text-[11px] text-muted-foreground">No client-order documents linked yet.</div>
                          )}
                        </div>
                      </div>
                    </div>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="flex gap-2">
              <Textarea
                ref={textareaRef}
                value={input}
                onChange={event => setInput(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    void submitPrompt(input);
                  }
                }}
                placeholder="Ask about stock, orders, quotes..."
                className="min-h-[60px] max-h-[100px] resize-none text-xs"
                disabled={submitting}
                rows={2}
              />
              <Button
                onClick={() => void submitPrompt(input)}
                disabled={submitting || input.trim().length === 0}
                size="icon"
                className="h-[60px] w-10 shrink-0"
              >
                <SendHorizontal className="h-4 w-4" />
              </Button>
            </div>
            <p className="mt-1.5 text-[10px] text-muted-foreground/70">
              Unity-only scope. Refuses out-of-scope questions.
            </p>
          </div>
        </div>
      </div>

      {/* FAB toggle button */}
      {!open ? (
        <div className={cn('fixed z-50', fabPositionClass)}>
          <Button
            size="icon"
            onClick={() => setOpen(true)}
            className="h-12 w-12 rounded-full shadow-xl"
            aria-label="Open assistant"
          >
            <Bot className="h-5 w-5" />
          </Button>
        </div>
      ) : null}
    </>
  );
}
