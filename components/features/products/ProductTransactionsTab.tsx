'use client';

import { useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { RefreshCw, Calendar, Link as LinkIcon } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';
import Link from 'next/link';

export type ProductTransaction = {
  id: number;
  product_id: number;
  quantity: number | null;
  type: string | null;
  occurred_at: string;
  order_id: number | null;
  reference: string | null;
  receipt_source?: 'draft_confirm' | 'manual' | null;
};

interface ProductTransactionsTabProps {
  productId: number;
}

type StockReceiptSource = 'draft_confirm' | 'manual';

function parseStockReceiptId(reference: string | null): number | null {
  if (!reference) return null;
  const [table, id] = reference.split(':');
  if (table !== 'stock_receipts' || !id) return null;
  const parsed = Number(id);
  return Number.isFinite(parsed) ? parsed : null;
}

export function ProductTransactionsTab({ productId }: ProductTransactionsTabProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const {
    data: transactions = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ['product', productId, 'transactions'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('product_inventory_transactions')
        .select(
          `
            id,
            product_id,
            quantity,
            type,
            occurred_at,
            order_id,
            reference
          `
        )
        .eq('product_id', productId)
        .order('occurred_at', { ascending: false })
        .limit(200);

      if (error) {
        console.error('[product-transactions] error', error);
        throw error;
      }

      const rows = (data || []) as ProductTransaction[];
      const receiptIds = Array.from(
        new Set(
          rows
            .map((row) => parseStockReceiptId(row.reference))
            .filter((id): id is number => id != null),
        ),
      );

      if (receiptIds.length === 0) return rows;

      const { data: receipts, error: receiptsError } = await supabase
        .from('stock_receipts')
        .select('stock_receipt_id, source')
        .in('stock_receipt_id', receiptIds);

      if (receiptsError) {
        console.error('[product-transactions] stock receipts lookup error', receiptsError);
        return rows;
      }

      const receiptSources = new Map<number, StockReceiptSource | null>();
      for (const receipt of (receipts || []) as Array<{ stock_receipt_id: number; source: StockReceiptSource | null }>) {
        receiptSources.set(receipt.stock_receipt_id, receipt.source);
      }

      return rows.map((row) => {
        const receiptId = parseStockReceiptId(row.reference);
        return {
          ...row,
          receipt_source: receiptId != null ? receiptSources.get(receiptId) ?? null : null,
        };
      });
    },
    enabled: Number.isFinite(productId),
    staleTime: 30 * 1000,
    refetchOnWindowFocus: true,
  });

  const summary = useMemo(() => {
    const additions = transactions.filter((t) => (t.quantity || 0) > 0).length;
    const removals = transactions.filter((t) => (t.quantity || 0) < 0).length;

    return {
      total: transactions.length,
      additions,
      removals,
    };
  }, [transactions]);

  const refreshData = () => {
    queryClient.invalidateQueries({ queryKey: ['product', productId, 'transactions'] });
    toast({
      title: 'Transactions refreshed',
      description: 'Finished-good activity is up to date.',
    });
  };

  if (isLoading) {
    return (
      <div className="flex min-h-[200px] items-center justify-center text-muted-foreground">
        Loading product transactions…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
        Unable to load product transactions: {(error as Error).message}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-xl font-semibold">Finished-Good Activity</h3>
          <p className="text-sm text-muted-foreground">
            Only events for this product. View the{' '}
            <Link href="/products#transactions" className="text-primary underline-offset-2 hover:underline">
              global feed
            </Link>{' '}
            for cross-product analysis.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={refreshData}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <SummaryCard label="Total" value={summary.total} />
        <SummaryCard label="Stock Added" value={summary.additions} accent="text-green-600" />
        <SummaryCard label="Stock Removed" value={summary.removals} accent="text-red-600" />
      </div>

      <div className="rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Type</TableHead>
              <TableHead className="text-right">Quantity</TableHead>
              <TableHead>Order</TableHead>
              <TableHead>Reference</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {transactions.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                  No finished-good transactions yet.
                </TableCell>
              </TableRow>
            ) : (
              transactions.map((transaction) => {
                const quantity = Number(transaction.quantity || 0);
                const isAddition = quantity > 0;
                const isManualReceipt = transaction.type === 'build' && transaction.receipt_source === 'manual';
                return (
                  <TableRow key={transaction.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Calendar className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm">
                          {format(new Date(transaction.occurred_at), 'MMM dd, yyyy HH:mm')}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={isManualReceipt ? 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300' : undefined}
                      >
                        {isManualReceipt ? 'Manual receipt' : transaction.type ?? 'Unknown'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <span
                        className={isAddition ? 'text-green-600 font-semibold' : 'text-red-600 font-semibold'}
                      >
                        {isAddition ? '+' : ''}
                        {quantity}
                      </span>
                    </TableCell>
                    <TableCell>
                      {transaction.order_id ? (
                        <Link
                          href={`/orders/${transaction.order_id}`}
                          className="inline-flex items-center gap-1 text-sm text-primary underline-offset-2 hover:underline"
                        >
                          <LinkIcon className="h-3.5 w-3.5" />
                          #{transaction.order_id}
                        </Link>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell className="max-w-[220px] text-sm text-muted-foreground">
                      {transaction.reference || '—'}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function SummaryCard({ label, value, accent }: { label: string; value: number; accent?: string }) {
  return (
    <div className="rounded-xl border bg-muted/30 p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`text-3xl font-semibold ${accent ?? 'text-foreground'}`}>{value}</p>
    </div>
  );
}
