'use client';

import * as React from 'react';
import { Bot, Loader2, Maximize2, Minimize2, SendHorizontal, Sparkles, X } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';

import { authorizedFetch } from '@/lib/client/auth-fetch';
import {
  getAssistantScopeLabel,
  getAssistantSuggestions,
  type AssistantCard,
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
  suggestions?: string[];
  card?: AssistantCard;
};

type PanelWidth = 'compact' | 'wide' | 'focus';

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const COMPACT_WIDTH = 380;
const WIDE_WIDTH = 540;
const FOCUS_WIDTH = 700;
const WIDE_WIDTH_SMALL_VIEWPORT = 440;
const FOCUS_WIDTH_SMALL_VIEWPORT = 560;
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
      shell: 'border-emerald-300/25 bg-emerald-950/20',
      header: 'border-emerald-300/15 bg-emerald-400/10',
      metric: 'border-emerald-300/15 bg-emerald-400/10',
      row: 'border-emerald-300/10 even:bg-emerald-400/5',
      footer: 'border-emerald-300/10 bg-emerald-400/5',
      tableHead: 'bg-emerald-400/8 text-muted-foreground',
      bar: 'bg-emerald-500/60',
      barHover: 'hover:bg-emerald-500/80',
    };
  }

  if (
    title.includes('supplier') ||
    title.includes('delivery') ||
    title.includes('eta') ||
    title.includes('purchase')
  ) {
    return {
      shell: 'border-amber-300/25 bg-amber-950/20',
      header: 'border-amber-300/15 bg-amber-400/10',
      metric: 'border-amber-300/15 bg-amber-400/10',
      row: 'border-amber-300/10 even:bg-amber-400/5',
      footer: 'border-amber-300/10 bg-amber-400/5',
      tableHead: 'bg-amber-400/8 text-muted-foreground',
      bar: 'bg-amber-500/60',
      barHover: 'hover:bg-amber-500/80',
    };
  }

  if (
    title.includes('production') ||
    title.includes('manufacturing') ||
    title.includes('job card')
  ) {
    return {
      shell: 'border-fuchsia-300/25 bg-fuchsia-950/20',
      header: 'border-fuchsia-300/15 bg-fuchsia-400/10',
      metric: 'border-fuchsia-300/15 bg-fuchsia-400/10',
      row: 'border-fuchsia-300/10 even:bg-fuchsia-400/5',
      footer: 'border-fuchsia-300/10 bg-fuchsia-400/5',
      tableHead: 'bg-fuchsia-400/8 text-muted-foreground',
      bar: 'bg-fuchsia-500/60',
      barHover: 'hover:bg-fuchsia-500/80',
    };
  }

  return {
    shell: 'border-cyan-300/25 bg-slate-950/45',
    header: 'border-cyan-300/15 bg-cyan-300/8',
    metric: 'border-cyan-300/10 bg-background/40',
    row: 'border-cyan-300/10 even:bg-background/20',
    footer: 'border-cyan-300/10 bg-background/20',
    tableHead: 'bg-background/35 text-muted-foreground',
    bar: 'bg-cyan-500/60',
    barHover: 'hover:bg-cyan-500/80',
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
      badgeClass = 'border-emerald-400/30 bg-emerald-500/15 text-emerald-100';
    } else if (
      normalizedValue.includes('in production') ||
      normalizedValue.includes('in progress') ||
      normalizedValue.includes('open')
    ) {
      badgeClass = 'border-sky-400/30 bg-sky-500/15 text-sky-100';
    } else if (
      normalizedValue.includes('late') ||
      normalizedValue.includes('unknown') ||
      normalizedValue.includes('no eta') ||
      normalizedValue.includes('unassigned')
    ) {
      badgeClass = 'border-amber-400/30 bg-amber-500/15 text-amber-100';
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
function findActionHref(card: AssistantCard, label: string): string | null {
  if (!card.actions) return null;
  const match = card.actions.find(a =>
    a.label.toLowerCase().includes(label.toLowerCase()) ||
    a.href.toLowerCase().includes(label.toLowerCase())
  );
  return match?.href ?? null;
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
  const tone = getCardTone(card);
  const metricColumnCount =
    card.metrics && card.metrics.length > 0
      ? Math.min(Math.max(card.metrics.length, 1), 4)
      : 0;

  return (
    <div className={cn('mt-3 overflow-hidden rounded-xl border shadow-[0_12px_32px_rgba(0,0,0,0.18)]', tone.shell)}>
      <div className={cn('border-b px-3 py-2', tone.header)}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs font-semibold text-foreground">{card.title}</div>
            {card.description ? (
              <div className="mt-0.5 text-[11px] text-muted-foreground">{card.description}</div>
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
          {card.metrics.map(metric => (
            <div key={metric.label} className={cn('rounded-lg border px-2 py-1.5', tone.metric)}>
              <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{metric.label}</div>
              <div className="mt-0.5 text-xs font-semibold tabular-nums text-foreground">{metric.value}</div>
            </div>
          ))}
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

function TableCardContent({
  card,
  onNavigate,
}: {
  card: AssistantTableCard;
  onNavigate: (href: string) => void;
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
            </tr>
          </thead>
          <tbody>
            {card.rows.map((row, rowIndex) => {
              const rowHref = card.actions?.[rowIndex]?.href;
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

              if (rowHref) {
                return (
                  <tr
                    key={`${card.title}-${rowIndex}`}
                    className={cn('border-t cursor-pointer transition-colors hover:bg-white/8', tone.row)}
                    onClick={() => onNavigate(rowHref)}
                  >
                    {rowContent}
                  </tr>
                );
              }

              return (
                <tr key={`${card.title}-${rowIndex}`} className={cn('border-t', tone.row)}>
                  {rowContent}
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
  onNavigate,
}: {
  card: AssistantChartCard;
  onNavigate: (href: string) => void;
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
              const actionHref = card.actions?.[idx]?.href ?? null;

              if (actionHref) {
                return (
                  <ClickableRow
                    key={`${card.title}-${detail.label}`}
                    href={actionHref}
                    onNavigate={onNavigate}
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
    </CardShell>
  );
}

function AssistantCardRenderer({
  card,
  onNavigate,
}: {
  card: AssistantCard;
  onNavigate: (href: string) => void;
}) {
  if (card.type === 'table') {
    return <TableCardContent card={card} onNavigate={onNavigate} />;
  }

  if (card.type === 'chart') {
    return <ChartCardContent card={card} onNavigate={onNavigate} />;
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
  const [viewportWidth, setViewportWidth] = React.useState(
    typeof window !== 'undefined' ? window.innerWidth : 1440
  );
  const lastAssistantMessageRef = React.useRef<HTMLDivElement | null>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);
  const navigatedFromPanel = React.useRef(false);

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
  }, [pathname]);

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
          body: JSON.stringify({ message: prompt, pathname }),
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
    [pathname, submitting]
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
                  'rounded-lg border px-2.5 py-2 text-xs shadow-xs',
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
                  <AssistantCardRenderer card={message.card} onNavigate={handleNavigate} />
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
