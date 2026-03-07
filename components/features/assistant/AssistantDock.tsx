'use client';

import * as React from 'react';
import { Bot, Loader2, SendHorizontal, Sparkles, X } from 'lucide-react';
import { usePathname } from 'next/navigation';

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
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';

type ChatMessage = {
  id: string;
  role: 'assistant' | 'user';
  content: string;
  status?: AssistantStatus;
  suggestions?: string[];
  card?: AssistantCard;
};

const DEFAULT_DOCK_WIDTH = 416;
const DEFAULT_DOCK_HEIGHT = 544;
const MIN_DOCK_WIDTH = 384;
const MIN_DOCK_HEIGHT = 448;
const VIEWPORT_MARGIN = 48;

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
    };
  }

  return {
    shell: 'border-cyan-300/25 bg-slate-950/45',
    header: 'border-cyan-300/15 bg-cyan-300/8',
    metric: 'border-cyan-300/10 bg-background/40',
    row: 'border-cyan-300/10 even:bg-background/20',
    footer: 'border-cyan-300/10 bg-background/20',
    tableHead: 'bg-background/35 text-muted-foreground',
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

function renderCardShell(
  card: AssistantCard,
  body: React.ReactNode
) {
  const tone = getCardTone(card);
  const metricColumnCount =
    card.metrics && card.metrics.length > 0
      ? Math.min(Math.max(card.metrics.length, 1), 4)
      : 0;

  return (
    <div className={cn('mt-3 overflow-hidden rounded-xl border shadow-[0_12px_32px_rgba(0,0,0,0.18)]', tone.shell)}>
      <div className={cn('border-b px-3 py-2.5', tone.header)}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-foreground">{card.title}</div>
            {card.description ? (
              <div className="mt-1 text-xs text-muted-foreground">{card.description}</div>
            ) : null}
          </div>
          <Badge variant="outline" className="border-white/10 bg-black/10 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            Live Data
          </Badge>
        </div>
      </div>

      {card.metrics && card.metrics.length > 0 ? (
        <div
          className="grid gap-2 border-b px-3 py-3"
          style={{ gridTemplateColumns: `repeat(${metricColumnCount}, minmax(0, 1fr))` }}
        >
          {card.metrics.map(metric => (
            <div key={metric.label} className={cn('rounded-lg border px-2.5 py-2', tone.metric)}>
              <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">{metric.label}</div>
              <div className="mt-1 text-sm font-semibold tabular-nums text-foreground">{metric.value}</div>
            </div>
          ))}
        </div>
      ) : null}

      {body}

      {card.actions && card.actions.length > 0 ? (
        <div className="flex flex-wrap gap-2 border-t px-3 py-3">
          {card.actions.slice(0, 3).map(action => (
            <a
              key={`${card.title}-${action.href}-${action.label}`}
              href={action.href}
              className="inline-flex items-center rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-medium text-foreground transition-colors hover:border-primary/50 hover:bg-primary/15"
            >
              {action.label}
            </a>
          ))}
        </div>
      ) : null}

      {card.footer ? (
        <div className={cn('border-t px-3 py-2 text-xs text-muted-foreground', tone.footer)}>
          {card.footer}
        </div>
      ) : null}
    </div>
  );
}

function renderTableCard(card: AssistantTableCard) {
  const tone = getCardTone(card);

  return renderCardShell(
    card,
    <div className="overflow-x-auto">
      <table className="min-w-full text-left text-xs">
        <thead className={tone.tableHead}>
          <tr>
            {card.columns.map(column => (
              <th
                key={column.key}
                className={cn(
                  'px-3 py-2 font-medium',
                  column.align === 'right' ? 'text-right' : 'text-left'
                )}
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {card.rows.map((row, rowIndex) => (
            <tr key={`${card.title}-${rowIndex}`} className={cn('border-t transition-colors hover:bg-white/5', tone.row)}>
              {card.columns.map(column => (
                <td
                  key={column.key}
                  className={cn(
                    'px-3 py-2 text-foreground/90',
                    column.align === 'right' ? 'text-right tabular-nums' : 'text-left'
                  )}
                >
                  {renderCellValue(column.key, row[column.key] ?? '—')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function renderChartCard(card: AssistantChartCard) {
  const tone = getCardTone(card);
  const maxValue = Math.max(...card.points.map(point => point.value), 1);

  return renderCardShell(
    card,
    <div className="px-3 py-3">
      <div className={cn('rounded-xl border px-3 py-4', tone.metric)}>
        <div className="flex h-40 items-end gap-2">
          {card.points.map(point => {
            const hasValue = point.value > 0;
            const heightPercent = hasValue ? Math.max((point.value / maxValue) * 100, 12) : 4;

            return (
              <div key={`${card.title}-${point.label}`} className="flex min-w-0 flex-1 flex-col items-center gap-2">
                <div className="text-[11px] font-medium tabular-nums text-foreground/90">
                  {point.value}
                </div>
                <div className="flex h-24 w-full items-end rounded-md bg-background/40 px-1.5 py-1">
                  <div
                    className={cn(
                      'w-full rounded-md transition-all',
                      tone.header,
                      hasValue ? 'opacity-100' : 'opacity-50'
                    )}
                    style={{ height: `${heightPercent}%` }}
                  />
                </div>
                <div className="text-center text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                  {point.label}
                </div>
              </div>
            );
          })}
        </div>

        {card.details && card.details.length > 0 ? (
          <div className="mt-4 space-y-2 border-t border-border/60 pt-3">
            {card.details.map(detail => (
              <div key={`${card.title}-${detail.label}`} className="flex items-start justify-between gap-3 text-xs">
                <div className="uppercase tracking-[0.1em] text-muted-foreground">{detail.label}</div>
                <div className="text-right text-foreground/90">{detail.value}</div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function renderAssistantCard(card: AssistantCard) {
  if (card.type === 'table') {
    return renderTableCard(card);
  }

  if (card.type === 'chart') {
    return renderChartCard(card);
  }

  return null;
}

export function AssistantDock({ enabled }: { enabled: boolean }) {
  const pathname = usePathname();
  const [open, setOpen] = React.useState(false);
  const [input, setInput] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [messages, setMessages] = React.useState<ChatMessage[]>(() => [buildWelcomeMessage(null)]);
  const [desktopSize, setDesktopSize] = React.useState({
    width: DEFAULT_DOCK_WIDTH,
    height: DEFAULT_DOCK_HEIGHT,
  });
  const [isResizing, setIsResizing] = React.useState(false);
  const lastAssistantMessageRef = React.useRef<HTMLDivElement | null>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);
  const dockPositionClass =
    process.env.NODE_ENV === 'development'
      ? 'bottom-20 right-4 md:bottom-24 md:right-6'
      : 'bottom-4 right-4 md:bottom-6 md:right-6';

  React.useEffect(() => {
    setMessages([buildWelcomeMessage(pathname)]);
    setInput('');
  }, [pathname]);

  React.useEffect(() => {
    if (!enabled) {
      setOpen(false);
    }
  }, [enabled]);

  React.useEffect(() => {
    if (!open) {
      setDesktopSize({
        width: DEFAULT_DOCK_WIDTH,
        height: DEFAULT_DOCK_HEIGHT,
      });
    }
  }, [open]);

  React.useEffect(() => {
    const lastMessage = messages[messages.length - 1];
    if (!open || !lastMessage || lastMessage.role !== 'assistant') {
      return;
    }

    lastAssistantMessageRef.current?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    });
  }, [messages, open]);

  React.useEffect(() => {
    if (!enabled) return;

    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'j') {
        event.preventDefault();
        setOpen(prev => !prev);
      }

      if (event.key === 'Escape') {
        setOpen(false);
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled]);

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
          suggestions: payload.suggestions,
          card: payload.card,
        };

        setMessages(prev => [...prev, assistantMessage]);
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

  if (!enabled) {
    return null;
  }

  const isDesktop = typeof window !== 'undefined' && window.innerWidth >= 768;
  const maxDockWidth =
    typeof window === 'undefined'
      ? DEFAULT_DOCK_WIDTH
      : Math.max(MIN_DOCK_WIDTH, window.innerWidth - VIEWPORT_MARGIN);
  const maxDockHeight =
    typeof window === 'undefined'
      ? DEFAULT_DOCK_HEIGHT
      : Math.max(MIN_DOCK_HEIGHT, window.innerHeight - VIEWPORT_MARGIN);

  const startResize = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (typeof window === 'undefined' || window.innerWidth < 768) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsResizing(true);

    const startX = event.clientX;
    const startY = event.clientY;
    const startWidth = desktopSize.width;
    const startHeight = desktopSize.height;

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const nextWidth = Math.min(
        maxDockWidth,
        Math.max(MIN_DOCK_WIDTH, startWidth + (startX - moveEvent.clientX))
      );
      const nextHeight = Math.min(
        maxDockHeight,
        Math.max(MIN_DOCK_HEIGHT, startHeight + (startY - moveEvent.clientY))
      );

      setDesktopSize({
        width: nextWidth,
        height: nextHeight,
      });
    };

    const handlePointerUp = () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      setIsResizing(false);
    };

    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'nwse-resize';
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp, { once: true });
  };

  return (
    <>
      {open ? (
        <div className="fixed inset-0 z-40 bg-background/30 backdrop-blur-[1px] md:hidden" onClick={() => setOpen(false)} />
      ) : null}

      <div className={cn('fixed z-50 flex flex-col items-end gap-3', dockPositionClass)}>
        {open ? (
          <Card
            className="relative flex w-[calc(100vw-2rem)] max-w-[26rem] flex-col overflow-hidden border-slate-300 bg-white shadow-[0_8px_40px_rgba(0,0,0,0.12)] dark:border-slate-600/50 dark:bg-slate-800/95 dark:shadow-[0_8px_40px_rgba(0,0,0,0.45),0_0_0_1px_rgba(100,116,139,0.15)] md:max-w-none md:min-w-[24rem] md:min-h-[28rem]"
            style={{
              width: isDesktop ? `${desktopSize.width}px` : undefined,
              height: isDesktop ? `${desktopSize.height}px` : undefined,
              maxWidth: isDesktop ? `${maxDockWidth}px` : undefined,
              maxHeight: isDesktop ? `${maxDockHeight}px` : undefined,
            }}
          >
            {/* Corner resize handle — top-left since dock is anchored bottom-right */}
            <button
              type="button"
              aria-label="Resize assistant"
              onPointerDown={startResize}
              className="absolute left-0 top-0 z-10 hidden h-5 w-5 cursor-nwse-resize touch-none select-none items-center justify-center md:flex"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" className="text-muted-foreground/50 hover:text-muted-foreground transition-colors">
                <path d="M0 0L10 0L0 10Z" fill="currentColor" />
              </svg>
            </button>
            <div className="shrink-0 space-y-3 px-4 pb-3 pt-4">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-base">Unity Assistant</CardTitle>
                    <Badge variant="secondary" className="gap-1">
                      <Sparkles className="h-3 w-3" />
                      Prototype
                    </Badge>
                  </div>
                  <CardDescription>{getAssistantScopeLabel(pathname)}</CardDescription>
                </div>
                <Button variant="ghost" size="icon" onClick={() => setOpen(false)} aria-label="Close assistant">
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <div className="rounded-md border border-dashed border-primary/30 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
                Unity-only scope. No verified data, no answer. Shortcut: <span className="font-medium">Ctrl/Cmd + J</span>
              </div>
            </div>

            <div className="shrink-0 border-t border-border/80" />

            <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
              <div className="flex-1 space-y-3 overflow-y-auto pr-1">
                {messages.map((message, index) => (
                  <div
                    key={message.id}
                    ref={index === messages.length - 1 && message.role === 'assistant' ? lastAssistantMessageRef : null}
                    className={cn(
                      'rounded-xl border px-3 py-2 text-sm shadow-sm',
                      message.role === 'user'
                        ? 'ml-8 border-primary/20 bg-primary/15 text-foreground'
                        : cn('mr-4', getStatusTone(message.status))
                    )}
                  >
                    <div className="mb-1 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                      {message.role === 'user' ? 'You' : 'Assistant'}
                    </div>
                    <p className="whitespace-pre-wrap leading-6">{message.content}</p>
                    {message.role === 'assistant' && message.card ? renderAssistantCard(message.card) : null}
                    {message.role === 'assistant' && message.suggestions && message.suggestions.length > 0 ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {message.suggestions.slice(0, 3).map(suggestion => (
                          <button
                            key={suggestion}
                            type="button"
                            onClick={() => { setInput(suggestion); textareaRef.current?.focus(); }}
                            className="rounded-full border border-border bg-background px-3 py-1 text-left text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                          >
                            {suggestion}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>

              <div className="space-y-2">
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
                  placeholder="Ask about stock, supplier orders, quotes, or tasks..."
                  className="min-h-[88px] resize-none"
                  disabled={submitting}
                />
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs text-muted-foreground">
                    This prototype refuses out-of-scope questions and will say &quot;I don&apos;t know&quot; when data is not verified.
                  </p>
                  <Button
                    onClick={() => void submitPrompt(input)}
                    disabled={submitting || input.trim().length === 0}
                    className="shrink-0 gap-2"
                  >
                    {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <SendHorizontal className="h-4 w-4" />}
                    Ask
                  </Button>
                </div>
              </div>
            </div>
          </Card>
        ) : null}

        <Button
          size="icon"
          onClick={() => setOpen(prev => !prev)}
          className="h-14 w-14 rounded-full shadow-xl"
          aria-label={open ? 'Close assistant' : 'Open assistant'}
        >
          <Bot className="h-6 w-6" />
        </Button>
      </div>
    </>
  );
}
