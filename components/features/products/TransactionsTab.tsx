'use client';

import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { RefreshCw, Search, X, Calendar, Link2 } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { format } from 'date-fns';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type ProductTransaction = {
  id: number;
  product_id: number;
  quantity: number | null;
  type: string | null;
  occurred_at: string;
  order_id: number | null;
  reference: string | null;
  product: {
    internal_code: string;
    name: string;
  } | null;
};

export function ProductsTransactionsTab() {
  const [searchText, setSearchText] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const {
    data: transactions = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ['products', 'transactions'],
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
            reference,
            product:products (
              internal_code,
              name
            )
          `
        )
        .order('occurred_at', { ascending: false })
        .limit(500);

      if (error) {
        console.error('Error fetching product transactions:', error);
        throw error;
      }

      return data as ProductTransaction[];
    },
    staleTime: 30 * 1000,
    refetchOnWindowFocus: true,
  });

  const transactionTypes = useMemo(() => {
    const values = new Set<string>();
    transactions.forEach((trx) => {
      if (trx.type) {
        values.add(trx.type);
      }
    });
    return Array.from(values).sort((a, b) => a.localeCompare(b));
  }, [transactions]);

  const filteredTransactions = useMemo(() => {
    return transactions.filter((transaction) => {
      const matchesSearch =
        !searchText ||
        transaction.product?.internal_code
          ?.toLowerCase()
          .includes(searchText.toLowerCase()) ||
        transaction.product?.name?.toLowerCase().includes(searchText.toLowerCase());

      const matchesType = typeFilter === 'all' || transaction.type === typeFilter;

      return matchesSearch && matchesType;
    });
  }, [transactions, searchText, typeFilter]);

  const refreshData = () => {
    queryClient.invalidateQueries({ queryKey: ['products', 'transactions'] });
    toast({
      title: 'Data refreshed',
      description: 'Product transaction feed has been refreshed.',
    });
  };

  const additions = filteredTransactions.filter((t) => (t.quantity || 0) > 0).length;
  const removals = filteredTransactions.filter((t) => (t.quantity || 0) < 0).length;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-lg">Loading product transactions...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4">
        <div className="text-destructive">
          Error loading product transactions: {(error as Error).message}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold">Finished-Good Transactions</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Track builds, shipments, reservations, and manual adjustments across every product.
          </p>
        </div>
        <Button onClick={refreshData} className="h-9" variant="outline">
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search by product code or name..."
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            className="pl-9 pr-10"
          />
          {searchText && (
            <button
              type="button"
              onClick={() => setSearchText('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex h-6 w-6 items-center justify-center rounded hover:bg-muted"
              aria-label="Clear search"
            >
              <X className="h-4 w-4 text-muted-foreground" />
            </button>
          )}
        </div>

        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-full sm:w-[220px]">
            <SelectValue placeholder="Transaction type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            {transactionTypes.map((type) => (
              <SelectItem key={type} value={type}>
                {type}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rounded-xl border bg-card p-4 shadow-sm">
          <p className="text-sm font-medium text-muted-foreground">Total Transactions</p>
          <p className="text-2xl font-bold mt-2">{filteredTransactions.length}</p>
        </div>
        <div className="rounded-xl border bg-card p-4 shadow-sm">
          <p className="text-sm font-medium text-muted-foreground">Stock Added</p>
          <p className="text-2xl font-bold mt-2 text-green-600">{additions}</p>
        </div>
        <div className="rounded-xl border bg-card p-4 shadow-sm">
          <p className="text-sm font-medium text-muted-foreground">Stock Removed</p>
          <p className="text-2xl font-bold mt-2 text-red-600">{removals}</p>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl border bg-card shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Product</TableHead>
              <TableHead>Type</TableHead>
              <TableHead className="text-right">Quantity</TableHead>
              <TableHead>Order</TableHead>
              <TableHead>Reference</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredTransactions.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                  {searchText || typeFilter !== 'all'
                    ? 'No product transactions match your filters.'
                    : 'No product transactions have been recorded yet.'}
                </TableCell>
              </TableRow>
            ) : (
              filteredTransactions.map((transaction) => {
                const quantity = Number(transaction.quantity || 0);
                const isAddition = quantity > 0;

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
                    <TableCell className="space-y-0.5">
                      <div className="font-medium">{transaction.product?.internal_code || '—'}</div>
                      <div className="text-xs text-muted-foreground">
                        {transaction.product?.name || 'Unnamed product'}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{transaction.type || 'Unknown'}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <span
                        className={
                          isAddition ? 'text-green-600 font-semibold' : 'text-red-600 font-semibold'
                        }
                      >
                        {isAddition ? '+' : ''}
                        {quantity}
                      </span>
                    </TableCell>
                    <TableCell>
                      {transaction.order_id ? (
                        <Badge variant="secondary" className="inline-flex items-center gap-1">
                          <Link2 className="h-3 w-3" />
                          Order #{transaction.order_id}
                        </Badge>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell className="max-w-[200px] truncate text-sm">
                      {transaction.reference || '—'}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {filteredTransactions.length === 500 && (
        <p className="text-sm text-muted-foreground text-center">
          Showing the most recent 500 finished-good transactions
        </p>
      )}
    </div>
  );
}
