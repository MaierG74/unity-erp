'use client';

import { useMemo, useState } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown } from 'lucide-react';
import { format, startOfWeek, startOfMonth } from 'date-fns';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import type { EnrichedTransaction, ComponentStockSummary } from '@/types/transaction-views';

type GroupByMode = 'none' | 'component' | 'supplier' | 'period_week' | 'period_month';

type TransactionGroup = {
  key: string;
  label: string;
  sublabel?: string;
  sumIn: number;
  sumOut: number;
  count: number;
  stockSummary?: ComponentStockSummary;
  transactions: EnrichedTransaction[];
};

type Props = {
  transactions: EnrichedTransaction[];
  groupBy: GroupByMode;
  stockSummaryMap?: Map<number, ComponentStockSummary>;
};

function getTransactionTypeBadge(typeName: string) {
  const styles: Record<string, string> = {
    PURCHASE: 'bg-green-500/10 text-green-600 border-green-500/20',
    ISSUE: 'bg-purple-500/10 text-purple-600 border-purple-500/20',
    RETURN: 'bg-orange-500/10 text-orange-600 border-orange-500/20',
    ADJUSTMENT: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
    SALE: 'bg-red-500/10 text-red-600 border-red-500/20',
  };
  return styles[typeName] || 'bg-muted text-muted-foreground';
}

function groupTransactions(
  transactions: EnrichedTransaction[],
  groupBy: GroupByMode,
  stockSummaryMap?: Map<number, ComponentStockSummary>
): TransactionGroup[] {
  if (groupBy === 'none') return [];

  const groupMap = new Map<string, TransactionGroup>();

  transactions.forEach((t) => {
    let key: string;
    let label: string;
    let sublabel: string | undefined;

    switch (groupBy) {
      case 'component':
        key = String(t.component_id);
        label = t.component?.internal_code || 'Unknown';
        sublabel = t.component?.description || undefined;
        break;
      case 'supplier': {
        const supplier = t.purchase_order?.supplier;
        key = supplier ? String(supplier.supplier_id) : 'none';
        label = supplier?.name || 'No Supplier';
        break;
      }
      case 'period_week': {
        const weekStart = startOfWeek(new Date(t.transaction_date), { weekStartsOn: 1 });
        key = format(weekStart, 'yyyy-MM-dd');
        label = `Week of ${format(weekStart, 'MMM dd, yyyy')}`;
        break;
      }
      case 'period_month': {
        const monthStart = startOfMonth(new Date(t.transaction_date));
        key = format(monthStart, 'yyyy-MM');
        label = format(monthStart, 'MMMM yyyy');
        break;
      }
      default:
        key = 'all';
        label = 'All';
    }

    const existing = groupMap.get(key);
    const qty = t.quantity || 0;

    if (existing) {
      existing.count++;
      if (qty > 0) existing.sumIn += qty;
      else existing.sumOut += Math.abs(qty);
      existing.transactions.push(t);
    } else {
      groupMap.set(key, {
        key,
        label,
        sublabel,
        sumIn: qty > 0 ? qty : 0,
        sumOut: qty < 0 ? Math.abs(qty) : 0,
        count: 1,
        stockSummary:
          groupBy === 'component' && stockSummaryMap
            ? stockSummaryMap.get(t.component_id)
            : undefined,
        transactions: [t],
      });
    }
  });

  // Sort groups
  const groups = Array.from(groupMap.values());
  groups.sort((a, b) => a.label.localeCompare(b.label));
  return groups;
}

export function TransactionsGroupedTable({ transactions, groupBy, stockSummaryMap }: Props) {
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(['__all__']));
  const [allExpanded, setAllExpanded] = useState(true);

  const groups = useMemo(
    () => groupTransactions(transactions, groupBy, stockSummaryMap),
    [transactions, groupBy, stockSummaryMap]
  );

  // Initialize all groups as expanded when groups change
  useMemo(() => {
    if (groups.length > 0 && allExpanded) {
      setExpandedGroups(new Set(groups.map((g) => g.key)));
    }
  }, [groups.length]);

  const toggleGroup = (key: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleAll = () => {
    if (allExpanded) {
      setExpandedGroups(new Set());
      setAllExpanded(false);
    } else {
      setExpandedGroups(new Set(groups.map((g) => g.key)));
      setAllExpanded(true);
    }
  };

  // Flat mode (no grouping)
  if (groupBy === 'none') {
    return (
      <div className="rounded-xl border bg-card shadow-xs">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Component</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Type</TableHead>
              <TableHead className="text-right">Quantity</TableHead>
              <TableHead>Order Ref</TableHead>
              <TableHead>Reason</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {transactions.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                  No transactions found matching your filters.
                </TableCell>
              </TableRow>
            ) : (
              transactions.map((t) => (
                <TransactionRowContent key={t.transaction_id} transaction={t} showComponent />
              ))
            )}
          </TableBody>
        </Table>
      </div>
    );
  }

  // Grouped mode
  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <Button variant="ghost" size="sm" onClick={toggleAll} className="text-xs">
          {allExpanded ? (
            <>
              <ChevronsDownUp className="h-3.5 w-3.5 mr-1" />
              Collapse All
            </>
          ) : (
            <>
              <ChevronsUpDown className="h-3.5 w-3.5 mr-1" />
              Expand All
            </>
          )}
        </Button>
      </div>

      {groups.length === 0 ? (
        <div className="rounded-xl border bg-card p-8 text-center text-muted-foreground shadow-xs">
          No transactions found matching your filters.
        </div>
      ) : (
        groups.map((group) => {
          const isExpanded = expandedGroups.has(group.key);
          return (
            <div key={group.key} className="rounded-xl border bg-card shadow-xs overflow-hidden">
              {/* Group Header */}
              <button
                type="button"
                onClick={() => toggleGroup(group.key)}
                className="w-full flex items-center gap-3 px-4 py-3 bg-muted/30 hover:bg-muted/50 transition-colors text-left"
              >
                {isExpanded ? (
                  <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                )}
                <div className="flex-1 min-w-0">
                  <span className="font-semibold">{group.label}</span>
                  {group.sublabel && (
                    <span className="text-sm text-muted-foreground ml-2">
                      — {group.sublabel}
                    </span>
                  )}
                  <span className="text-xs text-muted-foreground ml-2">
                    ({group.count} transactions)
                  </span>
                </div>
                <div className="flex items-center gap-4 text-sm shrink-0">
                  <span className="text-green-600 font-medium">
                    In: +{group.sumIn.toLocaleString()}
                  </span>
                  <span className="text-red-600 font-medium">
                    Out: -{group.sumOut.toLocaleString()}
                  </span>
                  {group.stockSummary && (
                    <>
                      <span className="font-medium">
                        Stock: {group.stockSummary.quantityOnHand.toLocaleString()}
                      </span>
                      <span className="text-blue-500 text-xs">
                        On Order: {group.stockSummary.onOrder.toLocaleString()}
                      </span>
                      <span className="text-amber-500 text-xs">
                        Reserved: {group.stockSummary.reserved.toLocaleString()}
                      </span>
                    </>
                  )}
                </div>
              </button>

              {/* Group Body */}
              {isExpanded && (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      {groupBy !== 'component' && <TableHead>Component</TableHead>}
                      <TableHead>Description</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead className="text-right">Quantity</TableHead>
                      <TableHead>Order Ref</TableHead>
                      <TableHead>Reason</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {group.transactions.map((t) => (
                      <TransactionRowContent
                        key={t.transaction_id}
                        transaction={t}
                        showComponent={groupBy !== 'component'}
                      />
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}

function TransactionRowContent({
  transaction: t,
  showComponent,
}: {
  transaction: EnrichedTransaction;
  showComponent: boolean;
}) {
  const qty = t.quantity || 0;
  const isAddition = qty > 0;

  return (
    <TableRow>
      <TableCell className="text-sm whitespace-nowrap">
        {format(new Date(t.transaction_date), 'MMM dd, yyyy HH:mm')}
      </TableCell>
      {showComponent && (
        <TableCell>
          <Link
            href={`/inventory/components/${t.component_id}`}
            target="_blank"
            className="text-primary hover:underline font-medium"
            onClick={(e) => e.stopPropagation()}
          >
            {t.component?.internal_code || 'Unknown'}
          </Link>
        </TableCell>
      )}
      <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">
        {t.component?.description || '-'}
      </TableCell>
      <TableCell>
        <Badge
          variant="outline"
          className={cn(
            'text-xs',
            getTransactionTypeBadge(t.transaction_type?.type_name || '')
          )}
        >
          {t.transaction_type?.type_name || 'Unknown'}
        </Badge>
      </TableCell>
      <TableCell className="text-right">
        <span className={cn('font-semibold', isAddition ? 'text-green-600' : 'text-red-600')}>
          {isAddition ? '+' : ''}
          {qty}
        </span>
      </TableCell>
      <TableCell>
        {t.order?.order_number ? (
          <Link
            href={`/orders/${t.order_id}`}
            target="_blank"
            className="text-primary hover:underline text-sm"
            onClick={(e) => e.stopPropagation()}
          >
            {t.order.order_number}
          </Link>
        ) : t.purchase_order?.q_number ? (
          <Link
            href={`/purchasing/purchase-orders/${t.purchase_order_id}`}
            target="_blank"
            className="text-primary hover:underline text-sm"
            onClick={(e) => e.stopPropagation()}
          >
            {t.purchase_order.q_number}
          </Link>
        ) : (
          <span className="text-muted-foreground">-</span>
        )}
      </TableCell>
      <TableCell className="text-sm text-muted-foreground max-w-[150px] truncate" title={t.reason || undefined}>
        {t.reason || '-'}
      </TableCell>
    </TableRow>
  );
}
