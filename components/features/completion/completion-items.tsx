'use client';

import { useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { AlertTriangle, Undo2, FileText, Trash2, PackageMinus } from 'lucide-react';
import { cn } from '@/lib/utils';

export type RemainderAction = 'return_to_pool' | 'follow_up_card' | 'scrap' | 'shortage';

export interface CompletionItem {
  item_id: number;
  job_name: string | null;
  product_name: string | null;
  quantity: number;
  completed_quantity: number;
  piece_rate: number | null;
  status: string;
}

export interface ItemCompletion {
  item_id: number;
  completed_quantity: number;
  remainder_action: RemainderAction | null;
  remainder_reason: string;
}

interface CompletionItemsListProps {
  items: CompletionItem[];
  completions: Record<number, ItemCompletion>;
  onUpdate: (itemId: number, update: Partial<ItemCompletion>) => void;
}

const remainderOptions: { value: RemainderAction; label: string; icon: React.ReactNode; description: string }[] = [
  { value: 'return_to_pool', label: 'Return to pool', icon: <Undo2 className="h-3.5 w-3.5" />, description: 'Make remainder available for re-issuance' },
  { value: 'follow_up_card', label: 'Follow-up card', icon: <FileText className="h-3.5 w-3.5" />, description: 'Create a new card for the remainder' },
  { value: 'scrap', label: 'Scrap / waste', icon: <Trash2 className="h-3.5 w-3.5" />, description: 'Units lost to waste (reason required)' },
  { value: 'shortage', label: 'Shortage', icon: <PackageMinus className="h-3.5 w-3.5" />, description: 'Upstream/material issue (reason required)' },
];

function formatRand(amount: number): string {
  return `R${amount.toFixed(2)}`;
}

export function CompletionItemsList({ items, completions, onUpdate }: CompletionItemsListProps) {
  const totalEarnings = useMemo(() => {
    return items.reduce((sum, item) => {
      const c = completions[item.item_id];
      const qty = c?.completed_quantity ?? item.quantity;
      return sum + qty * (item.piece_rate ?? 0);
    }, 0);
  }, [items, completions]);

  return (
    <div className="space-y-3">
      <Label className="text-sm font-medium">Items</Label>
      <div className="space-y-2">
        {items.map((item) => {
          const c = completions[item.item_id];
          const qty = c?.completed_quantity ?? item.quantity;
          const remainderQty = item.quantity - qty;
          const hasRemainder = remainderQty > 0;
          const earned = qty * (item.piece_rate ?? 0);
          const needsReason = c?.remainder_action === 'scrap' || c?.remainder_action === 'shortage';

          return (
            <div
              key={item.item_id}
              className={cn(
                'rounded-md border bg-card',
                hasRemainder && !c?.remainder_action && 'border-amber-500/50',
              )}
            >
              {/* Item row */}
              <div className="flex items-center gap-3 p-3">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">
                    {item.job_name ?? item.product_name ?? 'Item'}
                  </div>
                  {item.product_name && item.job_name && (
                    <div className="text-xs text-muted-foreground truncate">{item.product_name}</div>
                  )}
                  {item.piece_rate != null && item.piece_rate > 0 && (
                    <div className="text-xs text-muted-foreground">
                      {formatRand(item.piece_rate)}/pc = {formatRand(earned)}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={0}
                    max={item.quantity}
                    value={qty}
                    onChange={(e) => {
                      const val = Math.min(item.quantity, Math.max(0, parseInt(e.target.value) || 0));
                      onUpdate(item.item_id, {
                        completed_quantity: val,
                        // Clear remainder action if now fully complete
                        ...(val === item.quantity ? { remainder_action: null, remainder_reason: '' } : {}),
                      });
                    }}
                    className="w-20 text-center"
                  />
                  <span className="text-sm text-muted-foreground">/ {item.quantity}</span>
                </div>
              </div>

              {/* Remainder section — shown when completed_qty < issued_qty */}
              {hasRemainder && (
                <div className="border-t bg-muted/30 p-3 space-y-2">
                  <div className="flex items-center gap-2 text-sm text-amber-500">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    <span>{remainderQty} unit{remainderQty !== 1 ? 's' : ''} remaining — what happened?</span>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    {remainderOptions.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => onUpdate(item.item_id, {
                          remainder_action: opt.value,
                          // Clear reason when switching away from scrap/shortage
                          ...(opt.value !== 'scrap' && opt.value !== 'shortage' ? { remainder_reason: '' } : {}),
                        })}
                        className={cn(
                          'flex items-center gap-2 rounded-sm border p-2 text-xs text-left transition-colors',
                          c?.remainder_action === opt.value
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-border hover:border-muted-foreground/50',
                        )}
                      >
                        {opt.icon}
                        <span>{opt.label}</span>
                      </button>
                    ))}
                  </div>
                  {needsReason && (
                    <Textarea
                      value={c?.remainder_reason ?? ''}
                      onChange={(e) => onUpdate(item.item_id, { remainder_reason: e.target.value })}
                      placeholder={c?.remainder_action === 'scrap' ? 'What was the cause of waste?' : 'What caused the shortage?'}
                      rows={2}
                      className="text-sm"
                    />
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Total earnings */}
      {totalEarnings > 0 && (
        <div className="flex items-center justify-between text-sm font-medium pt-1">
          <span>Total Piecework</span>
          <span>{formatRand(totalEarnings)}</span>
        </div>
      )}
    </div>
  );
}

/** Check if all items have valid remainder decisions */
export function isCompletionValid(items: CompletionItem[], completions: Record<number, ItemCompletion>): boolean {
  for (const item of items) {
    const c = completions[item.item_id];
    if (!c) return false;
    const remainder = item.quantity - c.completed_quantity;
    if (remainder > 0) {
      if (!c.remainder_action) return false;
      if ((c.remainder_action === 'scrap' || c.remainder_action === 'shortage') && !c.remainder_reason.trim()) {
        return false;
      }
    }
  }
  return true;
}

/** Build the RPC payload from completions */
export function buildItemsPayload(items: CompletionItem[], completions: Record<number, ItemCompletion>) {
  return items.map((item) => {
    const c = completions[item.item_id];
    const qty = c?.completed_quantity ?? item.quantity;
    const remainder = item.quantity - qty;
    return {
      item_id: item.item_id,
      completed_quantity: qty,
      remainder_action: remainder > 0 ? (c?.remainder_action ?? null) : null,
      remainder_reason: remainder > 0 && (c?.remainder_action === 'scrap' || c?.remainder_action === 'shortage')
        ? (c?.remainder_reason ?? null)
        : null,
    };
  });
}

/** Get display label for a remainder action */
export function getRemainderLabel(action: string | null): string {
  if (!action) return '';
  return remainderOptions.find((o) => o.value === action)?.label ?? action;
}

/** Whether a remainder action is a loss type (needs visual warning) */
export function isLossAction(action: string | null): boolean {
  return action === 'scrap' || action === 'shortage';
}

/** Initialize completions from fetched items */
export function initCompletions(items: CompletionItem[]): Record<number, ItemCompletion> {
  const result: Record<number, ItemCompletion> = {};
  for (const item of items) {
    result[item.item_id] = {
      item_id: item.item_id,
      completed_quantity: item.completed_quantity > 0 ? item.completed_quantity : item.quantity,
      remainder_action: null,
      remainder_reason: '',
    };
  }
  return result;
}
